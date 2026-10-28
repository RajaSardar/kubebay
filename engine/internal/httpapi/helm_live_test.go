package httpapi

import (
	"context"
	"errors"
	"fmt"
	"io"
	"reflect"
	"sort"
	"testing"

	"helm.sh/helm/v4/pkg/action"
	"helm.sh/helm/v4/pkg/chart/common"
	chartv2 "helm.sh/helm/v4/pkg/chart/v2"
	kubefake "helm.sh/helm/v4/pkg/kube/fake"
	rcommon "helm.sh/helm/v4/pkg/release/common"
	releasev1 "helm.sh/helm/v4/pkg/release/v1"
	"helm.sh/helm/v4/pkg/storage"
	"helm.sh/helm/v4/pkg/storage/driver"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
	corev1client "k8s.io/client-go/kubernetes/typed/core/v1"
)

// ADR 0004 S4: Helm's list decodes every revision of every release and then
// keeps the newest. Asking the API server only for revisions Helm hasn't
// marked superseded gives the same rows from a fraction of the Secrets.

func revision(name, ns string, v int, st rcommon.Status) *releasev1.Release {
	r := webRelease(v, st)
	r.Name, r.Namespace = name, ns
	return r
}

// countingSecrets counts the release Secrets a LIST brings back.
type countingSecrets struct {
	corev1client.SecretInterface
	items *int
}

func (c countingSecrets) List(ctx context.Context, opts metav1.ListOptions) (*corev1.SecretList, error) {
	l, err := c.SecretInterface.List(ctx, opts)
	if err == nil {
		*c.items += len(l.Items)
	}
	return l, err
}

func rows(t *testing.T, store *storage.Storage) []ReleaseSummary {
	t.Helper()
	cfg := &action.Configuration{Releases: store, KubeClient: &kubefake.PrintingKubeClient{Out: io.Discard}, Capabilities: common.DefaultCapabilities}
	l := action.NewList(cfg)
	l.AllNamespaces = true
	l.StateMask = action.ListAll
	rels, err := l.Run()
	if err != nil {
		t.Fatal(err)
	}
	var out []ReleaseSummary
	for _, r := range rels {
		out = append(out, listRow(r))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Namespace+"/"+out[i].Name < out[j].Namespace+"/"+out[j].Name })
	return out
}

func TestListingOnlyLiveRevisionsGivesTheSameRows(t *testing.T) {
	cs := fake.NewClientset()
	superseded := 0
	seed := func(name, ns string, statuses ...rcommon.Status) {
		for i, st := range statuses {
			r := revision(name, ns, i+1, st)
			if err := driver.NewSecrets(cs.CoreV1().Secrets(ns)).Create(fmt.Sprintf("sh.helm.release.v1.%s.v%d", name, i+1), r); err != nil {
				t.Fatal(err)
			}
			if st == rcommon.StatusSuperseded {
				superseded++
			}
		}
	}
	S, D, F, P, U := rcommon.StatusSuperseded, rcommon.StatusDeployed, rcommon.StatusFailed, rcommon.StatusPendingUpgrade, rcommon.StatusUninstalled
	seed("web", "shop", S, S, S, S, S, S, S, S, S, D)
	seed("failed-upgrade", "shop", D, F)
	seed("failed-twice", "payments", D, F, F)
	seed("upgrading", "payments", S, D, P)
	seed("rolled-back", "data", S, S, D)
	seed("kept-history", "data", S, U)
	total := 10 + 2 + 3 + 3 + 3 + 2

	want := rows(t, storage.Init(driver.NewSecrets(cs.CoreV1().Secrets(""))))
	fetched := 0
	got := rows(t, liveReleaseStore(countingSecrets{cs.CoreV1().Secrets(""), &fetched}))
	if !reflect.DeepEqual(got, want) {
		t.Errorf("live revisions only:\n%+v\nevery revision:\n%+v", got, want)
	}
	all, err := liveReleaseStore(cs.CoreV1().Secrets("")).ListReleases()
	if err != nil {
		t.Fatal(err)
	}
	if got := newestRows(all); !reflect.DeepEqual(got, want) {
		t.Errorf("the list's newest revisions:\n%+v\nhelm list:\n%+v", got, want)
	}
	if fetched != total-superseded {
		t.Errorf("fetched %d release Secrets, want the %d not superseded (of %d)", fetched, total-superseded, total)
	}
}

// The filter is right only while Helm never marks a release's newest
// revision superseded. This drives Helm's own actions to hold it to that.
func TestHelmNeverSupersedesTheNewestRevision(t *testing.T) {
	cfg := &action.Configuration{
		Releases:     storage.Init(driver.NewMemory()),
		KubeClient:   &kubefake.PrintingKubeClient{Out: io.Discard},
		Capabilities: common.DefaultCapabilities,
	}
	ch := &chartv2.Chart{
		Metadata:  &chartv2.Metadata{APIVersion: "v2", Name: "web", Version: "1.0.0"},
		Templates: []*common.File{{Name: "templates/cm.yaml", Data: []byte("apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: web\n")}},
	}
	req := HelmUpgradeRequest{Cluster: "c", NS: "shop", Name: "web"}
	newest := func(step string) {
		t.Helper()
		hist, err := cfg.Releases.History("web")
		if err != nil {
			t.Fatalf("%s: %v", step, err)
		}
		top := 0
		var status rcommon.Status
		for _, rr := range hist {
			r := rr.(*releasev1.Release)
			if r.Version > top {
				top, status = r.Version, r.Info.Status
			}
		}
		if status == rcommon.StatusSuperseded {
			t.Errorf("after %s the newest revision (%d) is superseded", step, top)
		}
	}

	if _, err := helmInstall(cfg, req, action.ChartPathOptions{}).Run(ch, nil); err != nil {
		t.Fatal(err)
	}
	newest("install")
	if _, err := helmUpgrade(cfg, req, action.ChartPathOptions{}).Run("web", ch, nil); err != nil {
		t.Fatal(err)
	}
	newest("upgrade")
	cfg.KubeClient = &kubefake.FailingKubeClient{PrintingKubeClient: kubefake.PrintingKubeClient{Out: io.Discard}, UpdateError: errors.New("boom")}
	if _, err := helmUpgrade(cfg, req, action.ChartPathOptions{}).Run("web", ch, nil); err == nil {
		t.Fatal("the failing upgrade succeeded")
	}
	newest("a failed upgrade")
	cfg.KubeClient = &kubefake.PrintingKubeClient{Out: io.Discard}
	if err := helmRollback(cfg, HelmActionRequest{Name: "web", Revision: 1}).Run("web"); err != nil {
		t.Fatal(err)
	}
	newest("rollback")
	un := helmUninstall(cfg)
	un.KeepHistory = true
	if _, err := un.Run("web"); err != nil {
		t.Fatal(err)
	}
	newest("uninstall keeping history")
}

// Upgrades from Kubebay keep as many revisions as the helm CLI does.
func TestUpgradesKeepTenRevisions(t *testing.T) {
	if got := helmUpgrade(action.NewConfiguration(), HelmUpgradeRequest{}, action.ChartPathOptions{}).MaxHistory; got != 10 {
		t.Errorf("MaxHistory = %d, want 10", got)
	}
}
