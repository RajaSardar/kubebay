package httpapi

import (
	"context"
	"net/http"
	"sort"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
	"github.com/RajaSardar/kubebay/engine/internal/sigcheck"
)

// ImageSignatureAPI reports, per running image digest, whether a signature
// is published in its registry (Intelligence roadmap Tier 2 #17). It only
// runs when asked, since it contacts each image's registry.
type ImageSignatureAPI struct {
	Clusters *clusters.Manager
	Checker  *sigcheck.Checker
}

type ImageSignature struct {
	Image      string          `json:"image"`
	Registry   string          `json:"registry,omitempty"`
	Repo       string          `json:"repo,omitempty"`
	Digest     string          `json:"digest,omitempty"`
	Status     sigcheck.Status `json:"status"`
	Method     string          `json:"method,omitempty"`
	Reason     string          `json:"reason,omitempty"`
	Pods       int             `json:"pods"`
	Namespaces []string        `json:"namespaces"`
}

const maxImagesPerPass = 300

func imageSignatureReport(ctx context.Context, pods []corev1.Pod, check func(context.Context, sigcheck.Ref) sigcheck.Result, limit int) []ImageSignature {
	type agg struct {
		row  ImageSignature
		ref  sigcheck.Ref
		ok   bool
		nss  map[string]bool
		pods map[string]bool
	}
	rows := map[string]*agg{}
	for _, p := range pods {
		specImage := map[string]string{}
		for _, c := range append(append([]corev1.Container{}, p.Spec.InitContainers...), p.Spec.Containers...) {
			specImage[c.Name] = c.Image
		}
		for _, st := range append(append([]corev1.ContainerStatus{}, p.Status.InitContainerStatuses...), p.Status.ContainerStatuses...) {
			image := specImage[st.Name]
			if image == "" {
				image = st.Image
			}
			ref, ok := sigcheck.ParseRef(image, st.ImageID)
			key := "image:" + image
			if ok {
				key = ref.Registry + "/" + ref.Repo + "@" + ref.Digest
			}
			a := rows[key]
			if a == nil {
				a = &agg{row: ImageSignature{Image: image}, ref: ref, ok: ok, nss: map[string]bool{}, pods: map[string]bool{}}
				if ok {
					a.row.Registry, a.row.Repo, a.row.Digest = ref.Registry, ref.Repo, ref.Digest
				}
				rows[key] = a
			}
			a.nss[p.Namespace] = true
			a.pods[p.Namespace+"/"+p.Name] = true
		}
	}

	list := make([]*agg, 0, len(rows))
	for _, a := range rows {
		a.row.Pods = len(a.pods)
		for ns := range a.nss {
			a.row.Namespaces = append(a.row.Namespaces, ns)
		}
		sort.Strings(a.row.Namespaces)
		list = append(list, a)
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].row.Image != list[j].row.Image {
			return list[i].row.Image < list[j].row.Image
		}
		return list[i].row.Digest < list[j].row.Digest
	})

	var wg sync.WaitGroup
	sem := make(chan struct{}, 6)
	checked := 0
	for _, a := range list {
		if !a.ok {
			a.row.Status = sigcheck.StatusUnknown
			a.row.Reason = "the runtime reported no repository digest for this image"
			continue
		}
		if checked >= limit {
			a.row.Status = sigcheck.StatusUnknown
			a.row.Reason = "not checked: too many images in one pass"
			continue
		}
		checked++
		wg.Add(1)
		go func(a *agg) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			r := check(ctx, a.ref)
			a.row.Status, a.row.Method, a.row.Reason = r.Status, r.Method, r.Reason
		}(a)
	}
	wg.Wait()

	out := make([]ImageSignature, 0, len(list))
	for _, a := range list {
		out = append(out, a.row)
	}
	return out
}

func (a *ImageSignatureAPI) Handle(w http.ResponseWriter, r *http.Request) {
	cluster := r.URL.Query().Get("cluster")
	if cluster == "" {
		http.Error(w, "cluster required", http.StatusBadRequest)
		return
	}
	cfg, err := a.Clusters.RestConfigWithIdentity(cluster, clusters.IdentityFromContext(r.Context()))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	cs, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	pods, err := cs.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	checker := a.Checker
	if checker == nil {
		checker = &sigcheck.Checker{}
	}
	writeJSON(w, imageSignatureReport(ctx, pods.Items, checker.Check, maxImagesPerPass))
}
