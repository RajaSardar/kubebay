package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync/atomic"
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/RajaSardar/kubebay/engine/internal/sigcheck"
)

const sigDigest = "sha256:ab0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd"

func sigPod(ns, name, image, imageID string) corev1.Pod {
	return corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: name},
		Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "c", Image: image}}},
		Status:     corev1.PodStatus{ContainerStatuses: []corev1.ContainerStatus{{Name: "c", Image: image, ImageID: imageID}}},
	}
}

func TestImageSignatureReportDedupesByDigestAndCountsPods(t *testing.T) {
	pods := []corev1.Pod{
		sigPod("shop", "web-1", "ghcr.io/org/web:1", "ghcr.io/org/web@"+sigDigest),
		sigPod("shop", "web-2", "ghcr.io/org/web:1", "ghcr.io/org/web@"+sigDigest),
		sigPod("ops", "web-3", "ghcr.io/org/web:1", "ghcr.io/org/web@"+sigDigest),
		sigPod("shop", "local", "my-app:dev", "sha256:deadbeef"),
	}
	var calls int32
	check := func(_ context.Context, r sigcheck.Ref, _ string, _ *sigcheck.Credentials) sigcheck.Result {
		atomic.AddInt32(&calls, 1)
		return sigcheck.Result{Status: sigcheck.StatusSigned, Method: "cosign tag"}
	}
	got := imageSignatureReport(context.Background(), pods, check, nil, 10)
	if calls != 1 {
		t.Errorf("registry checks = %d, want 1 (one unique digest)", calls)
	}
	if len(got) != 2 {
		t.Fatalf("rows = %d, want 2: %+v", len(got), got)
	}
	web := got[0]
	if web.Image != "ghcr.io/org/web:1" || web.Status != sigcheck.StatusSigned || web.Pods != 3 || len(web.Namespaces) != 2 {
		t.Errorf("web row = %+v", web)
	}
	local := got[1]
	if local.Status != sigcheck.StatusUnknown || local.Reason == "" {
		t.Errorf("an image with no repo digest should be unknown with a reason: %+v", local)
	}
}

func TestImageSignatureReportStopsAtLimit(t *testing.T) {
	pods := []corev1.Pod{
		sigPod("a", "p1", "ghcr.io/org/one:1", "ghcr.io/org/one@"+sigDigest),
		sigPod("a", "p2", "ghcr.io/org/two:1", "ghcr.io/org/two@"+sigDigest),
	}
	check := func(context.Context, sigcheck.Ref, string, *sigcheck.Credentials) sigcheck.Result {
		return sigcheck.Result{Status: sigcheck.StatusUnsigned}
	}
	got := imageSignatureReport(context.Background(), pods, check, nil, 1)
	unchecked := 0
	for _, r := range got {
		if r.Status == sigcheck.StatusUnknown && r.Reason == "not checked: too many images in one pass" {
			unchecked++
		}
	}
	if unchecked != 1 {
		t.Errorf("unchecked rows = %d, want 1: %+v", unchecked, got)
	}
}

func TestImageSignaturesRequiresCluster(t *testing.T) {
	a := &ImageSignatureAPI{}
	rr := httptest.NewRecorder()
	a.Handle(rr, httptest.NewRequest(http.MethodGet, "/api/image-signatures", nil))
	if rr.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rr.Code)
	}
}

// The workload and pod drawers check only their own pods, which also lets a
// user whose access stops at one namespace use it.
func TestImageSignaturePodScope(t *testing.T) {
	for _, tc := range []struct {
		query, ns, labels, fields string
	}{
		{"", "", "", ""},
		{"ns=shop&selector=app%3Dweb", "shop", "app=web", ""},
		{"ns=shop&selector=app+in+(web,api),!canary", "shop", "app in (api,web),!canary", ""}, // canonical form
		{"ns=shop&pod=api-1", "shop", "", "metadata.name=api-1"},
	} {
		q, _ := url.ParseQuery(tc.query)
		ns, opts, err := podScope(q)
		if err != nil {
			t.Errorf("%q: %v", tc.query, err)
			continue
		}
		if ns != tc.ns || opts.LabelSelector != tc.labels || opts.FieldSelector != tc.fields {
			t.Errorf("%q: ns=%q labels=%q fields=%q", tc.query, ns, opts.LabelSelector, opts.FieldSelector)
		}
	}
	for _, bad := range []string{"selector=app%3D%3D%3Dweb", "ns=shop&selector=app+in+(", "pod=api-1", "ns=shop&pod=a,b"} {
		q, _ := url.ParseQuery(bad)
		if _, _, err := podScope(q); err == nil {
			t.Errorf("%q: want an error", bad)
		}
	}
}

func TestImageSignaturesRejectsABadSelectorBeforeContactingTheCluster(t *testing.T) {
	a := &ImageSignatureAPI{}
	rr := httptest.NewRecorder()
	a.Handle(rr, httptest.NewRequest(http.MethodGet, "/api/image-signatures?cluster=c&ns=shop&selector=app+in+(", nil))
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400", rr.Code)
	}
}
