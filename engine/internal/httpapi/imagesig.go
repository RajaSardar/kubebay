package httpapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
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
	Image    string          `json:"image"`
	Registry string          `json:"registry,omitempty"`
	Repo     string          `json:"repo,omitempty"`
	Digest   string          `json:"digest,omitempty"`
	Status   sigcheck.Status `json:"status"`
	Method   string          `json:"method,omitempty"`
	Reason   string          `json:"reason,omitempty"`
	// Verification is the check against the cluster's own policy keys.
	Verification sigcheck.Verification `json:"verification,omitempty"`
	VerifiedBy   string                `json:"verifiedBy,omitempty"`
	Pods         int                   `json:"pods"`
	Namespaces   []string              `json:"namespaces"`
}

const maxImagesPerPass = 300

type sigCheckFunc func(ctx context.Context, ref sigcheck.Ref, image string, creds *sigcheck.Credentials) sigcheck.Result

// credsFor returns a pod's pull-secret credentials for registry, or nil;
// a nil credsFor means every check is anonymous.
func imageSignatureReport(ctx context.Context, pods []corev1.Pod, check sigCheckFunc, credsFor func(corev1.Pod, string) *sigcheck.Credentials, limit int) []ImageSignature {
	type agg struct {
		row   ImageSignature
		ref   sigcheck.Ref
		ok    bool
		nss   map[string]bool
		pods  map[string]bool
		creds *sigcheck.Credentials
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
			if a.creds == nil && ok && credsFor != nil {
				a.creds = credsFor(p, ref.Registry)
			}
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
			r := check(ctx, a.ref, a.row.Image, a.creds)
			a.row.Status, a.row.Method, a.row.Reason = r.Status, r.Method, r.Reason
			a.row.Verification, a.row.VerifiedBy = r.Verification, r.VerifiedBy
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
	// Keys come from the admission policies this user can read; none is fine.
	var keys []sigcheck.PublicKey
	if dyn, err := dynamic.NewForConfig(cfg); err == nil {
		keys = policyKeys(listPolicies(ctx, dyn))
	}
	// Pull secrets are read only when the user asks, with their own identity,
	// and each credential goes only to the registry it is for.
	var credsFor func(corev1.Pod, string) *sigcheck.Credentials
	if r.URL.Query().Get("pullSecrets") == "1" {
		credsFor = podPullCredentials(ctx, cs)
	}
	check := func(ctx context.Context, ref sigcheck.Ref, image string, creds *sigcheck.Credentials) sigcheck.Result {
		var applicable []sigcheck.PublicKey
		for _, k := range keys {
			if k.AppliesTo(image) || k.AppliesTo(ref.Registry+"/"+ref.Repo) {
				applicable = append(applicable, k)
			}
		}
		return checker.CheckWith(ctx, ref, sigcheck.Options{Keys: applicable, Creds: creds})
	}
	writeJSON(w, imageSignatureReport(ctx, pods.Items, check, credsFor, maxImagesPerPass))
}

var policyGVRs = []schema.GroupVersionResource{
	{Group: "kyverno.io", Version: "v1", Resource: "clusterpolicies"},
	{Group: "kyverno.io", Version: "v1", Resource: "policies"},
	{Group: "policy.sigstore.dev", Version: "v1beta1", Resource: "clusterimagepolicies"},
	{Group: "policy.sigstore.dev", Version: "v1alpha1", Resource: "clusterimagepolicies"},
}

// listPolicies returns the signature policies the user can read; an engine
// that isn't installed (or a version it doesn't serve) is skipped.
func listPolicies(ctx context.Context, dyn dynamic.Interface) []*unstructured.Unstructured {
	var out []*unstructured.Unstructured
	seenSigstore := false
	for _, g := range policyGVRs {
		if g.Group == "policy.sigstore.dev" && seenSigstore {
			continue
		}
		list, err := dyn.Resource(g).List(ctx, metav1.ListOptions{})
		if err != nil {
			continue
		}
		if g.Group == "policy.sigstore.dev" {
			seenSigstore = true
		}
		for i := range list.Items {
			out = append(out, &list.Items[i])
		}
	}
	return out
}

// policyKeys extracts public keys and the images they apply to from Kyverno
// verifyImages attestors (and the older per-entry key field) and Sigstore
// ClusterImagePolicy key authorities. Unparseable keys are skipped.
func policyKeys(objs []*unstructured.Unstructured) []sigcheck.PublicKey {
	var out []sigcheck.PublicKey
	strs := func(v any) []string {
		var r []string
		if l, ok := v.([]any); ok {
			for _, x := range l {
				if s, ok := x.(string); ok && s != "" {
					r = append(r, s)
				}
			}
		}
		return r
	}
	add := func(pemText, source string, images []string) {
		if keys, err := sigcheck.ParsePublicKeys(pemText, source, images); err == nil {
			out = append(out, keys...)
		}
	}
	for _, o := range objs {
		source := o.GetKind() + " " + o.GetName()
		if o.GetNamespace() != "" {
			source = o.GetKind() + " " + o.GetNamespace() + "/" + o.GetName()
		}
		switch o.GetKind() {
		case "ClusterPolicy", "Policy":
			rules, _, _ := unstructured.NestedSlice(o.Object, "spec", "rules")
			for _, r := range rules {
				vis, _, _ := unstructured.NestedSlice(asMap(r), "verifyImages")
				for _, vi := range vis {
					m := asMap(vi)
					images := strs(m["imageReferences"])
					if img, ok := m["image"].(string); ok && img != "" {
						images = append(images, img)
					}
					if k, ok := m["key"].(string); ok {
						add(k, "Kyverno "+source, images)
					}
					attestors, _, _ := unstructured.NestedSlice(m, "attestors")
					for _, at := range attestors {
						entries, _, _ := unstructured.NestedSlice(asMap(at), "entries")
						for _, e := range entries {
							if pk, ok, _ := unstructured.NestedString(asMap(e), "keys", "publicKeys"); ok {
								add(pk, "Kyverno "+source, images)
							}
						}
					}
				}
			}
		case "ClusterImagePolicy":
			var images []string
			globs, _, _ := unstructured.NestedSlice(o.Object, "spec", "images")
			for _, g := range globs {
				if s, ok := asMap(g)["glob"].(string); ok && s != "" {
					images = append(images, s)
				}
			}
			auths, _, _ := unstructured.NestedSlice(o.Object, "spec", "authorities")
			for _, a := range auths {
				if data, ok, _ := unstructured.NestedString(asMap(a), "key", "data"); ok {
					add(data, "Sigstore "+source, images)
				}
			}
		}
	}
	return out
}

func asMap(v any) map[string]any {
	m, _ := v.(map[string]any)
	return m
}

// pullCredentials reads registry credentials from dockerconfigjson and
// dockercfg secrets, keyed by registry host as ParseRef names it.
func pullCredentials(secrets []corev1.Secret) map[string]sigcheck.Credentials {
	out := map[string]sigcheck.Credentials{}
	for _, s := range secrets {
		var auths map[string]struct {
			Auth     string `json:"auth"`
			Username string `json:"username"`
			Password string `json:"password"`
		}
		switch s.Type {
		case corev1.SecretTypeDockerConfigJson:
			var cfg struct {
				Auths json.RawMessage `json:"auths"`
			}
			if json.Unmarshal(s.Data[corev1.DockerConfigJsonKey], &cfg) != nil || json.Unmarshal(cfg.Auths, &auths) != nil {
				continue
			}
		case corev1.SecretTypeDockercfg:
			if json.Unmarshal(s.Data[corev1.DockerConfigKey], &auths) != nil {
				continue
			}
		default:
			continue
		}
		for host, a := range auths {
			user, pass := a.Username, a.Password
			if a.Auth != "" {
				if raw, err := base64.StdEncoding.DecodeString(a.Auth); err == nil {
					if u, p, ok := strings.Cut(string(raw), ":"); ok {
						user, pass = u, p
					}
				}
			}
			if user == "" {
				continue
			}
			out[registryHost(host)] = sigcheck.Credentials{Username: user, Password: pass}
		}
	}
	return out
}

func registryHost(key string) string {
	h := key
	if i := strings.Index(h, "://"); i >= 0 {
		h = h[i+3:]
	}
	if i := strings.Index(h, "/"); i >= 0 {
		h = h[:i]
	}
	switch h {
	case "index.docker.io", "docker.io":
		return "registry-1.docker.io"
	}
	return h
}

// podPullCredentials resolves a pod's credentials for a registry from its
// own imagePullSecrets and its ServiceAccount's, read with the caller's
// identity. Secrets are fetched once per namespace/name.
func podPullCredentials(ctx context.Context, cs kubernetes.Interface) func(corev1.Pod, string) *sigcheck.Credentials {
	var mu sync.Mutex
	secretCache := map[string]map[string]sigcheck.Credentials{}
	saCache := map[string][]corev1.LocalObjectReference{}
	secretCreds := func(ns, name string) map[string]sigcheck.Credentials {
		key := ns + "/" + name
		if c, ok := secretCache[key]; ok {
			return c
		}
		var c map[string]sigcheck.Credentials
		if s, err := cs.CoreV1().Secrets(ns).Get(ctx, name, metav1.GetOptions{}); err == nil {
			c = pullCredentials([]corev1.Secret{*s})
		}
		secretCache[key] = c
		return c
	}
	return func(p corev1.Pod, registry string) *sigcheck.Credentials {
		mu.Lock()
		defer mu.Unlock()
		refs := append([]corev1.LocalObjectReference{}, p.Spec.ImagePullSecrets...)
		sa := p.Spec.ServiceAccountName
		if sa == "" {
			sa = "default"
		}
		saKey := p.Namespace + "/" + sa
		saRefs, ok := saCache[saKey]
		if !ok {
			if obj, err := cs.CoreV1().ServiceAccounts(p.Namespace).Get(ctx, sa, metav1.GetOptions{}); err == nil {
				saRefs = obj.ImagePullSecrets
			}
			saCache[saKey] = saRefs
		}
		for _, ref := range append(refs, saRefs...) {
			if c, ok := secretCreds(p.Namespace, ref.Name)[registry]; ok {
				return &c
			}
		}
		return nil
	}
}
