package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"

	authorizationv1 "k8s.io/api/authorization/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"

	"github.com/RajaSardar/kubebay/engine/internal/clusters"
)

type Rule struct {
	Verbs     []string `json:"verbs"`
	APIGroups []string `json:"apiGroups"`
	Resources []string `json:"resources"`
}

type RoleSummary struct {
	Name  string `json:"name"`
	NS    string `json:"ns,omitempty"`
	Kind  string `json:"kind"`
	Rules []Rule `json:"rules"`
}

type BindingSummary struct {
	Name     string `json:"name"`
	NS       string `json:"ns,omitempty"`
	Kind     string `json:"kind"`
	RoleRef  string `json:"roleRef"`
	Subjects []struct {
		Kind      string `json:"kind"`
		Name      string `json:"name"`
		Namespace string `json:"ns,omitempty"`
	} `json:"subjects"`
}

type RBACSnapshot struct {
	Roles               []RoleSummary    `json:"roles"`
	ClusterRoles        []RoleSummary    `json:"clusterRoles"`
	RoleBindings        []BindingSummary `json:"roleBindings"`
	ClusterRoleBindings []BindingSummary `json:"clusterRoleBindings"`
}

type RBAC struct {
	Clusters *clusters.Manager
}

func (rb *RBAC) clientset(cluster string) (*kubernetes.Clientset, error) {
	cfg, err := rb.Clusters.RestConfig(cluster)
	if err != nil {
		return nil, err
	}
	return kubernetes.NewForConfig(cfg)
}

func rulesFrom(rules interface{}) []Rule {
	raw, err := json.Marshal(rules)
	if err != nil {
		return nil
	}
	var out []Rule
	_ = json.Unmarshal(raw, &out)
	return out
}

func (rb *RBAC) HandleAll(w http.ResponseWriter, r *http.Request) {
	cluster := r.URL.Query().Get("cluster")
	if cluster == "" {
		http.Error(w, "cluster required", http.StatusBadRequest)
		return
	}
	cs, err := rb.clientset(cluster)
	if err != nil {
		http.Error(w, fmt.Sprintf("client: %v", err), http.StatusInternalServerError)
		return
	}
	ctx := r.Context()

	crs, err := cs.RbacV1().ClusterRoles().List(ctx, metav1.ListOptions{})
	if err != nil {
		http.Error(w, fmt.Sprintf("clusterroles: %v", err), http.StatusBadGateway)
		return
	}
	roles, err := cs.RbacV1().Roles(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
	if err != nil {
		http.Error(w, fmt.Sprintf("roles: %v", err), http.StatusBadGateway)
		return
	}
	crbs, err := cs.RbacV1().ClusterRoleBindings().List(ctx, metav1.ListOptions{})
	if err != nil {
		http.Error(w, fmt.Sprintf("clusterrolebindings: %v", err), http.StatusBadGateway)
		return
	}
	rbs, err := cs.RbacV1().RoleBindings(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
	if err != nil {
		http.Error(w, fmt.Sprintf("rolebindings: %v", err), http.StatusBadGateway)
		return
	}

	snap := RBACSnapshot{}
	for _, cr := range crs.Items {
		snap.ClusterRoles = append(snap.ClusterRoles, RoleSummary{Name: cr.Name, Kind: "ClusterRole", Rules: rulesFrom(cr.Rules)})
	}
	for _, ro := range roles.Items {
		snap.Roles = append(snap.Roles, RoleSummary{Name: ro.Name, NS: ro.Namespace, Kind: "Role", Rules: rulesFrom(ro.Rules)})
	}
	for _, b := range crbs.Items {
		bb := BindingSummary{Name: b.Name, Kind: "ClusterRoleBinding", RoleRef: b.RoleRef.Kind + ":" + b.RoleRef.Name}
		for _, s := range b.Subjects {
			bb.Subjects = append(bb.Subjects, struct {
				Kind      string `json:"kind"`
				Name      string `json:"name"`
				Namespace string `json:"ns,omitempty"`
			}{s.Kind, s.Name, s.Namespace})
		}
		snap.ClusterRoleBindings = append(snap.ClusterRoleBindings, bb)
	}
	for _, b := range rbs.Items {
		bb := BindingSummary{Name: b.Name, NS: b.Namespace, Kind: "RoleBinding", RoleRef: b.RoleRef.Kind + ":" + b.RoleRef.Name}
		for _, s := range b.Subjects {
			bb.Subjects = append(bb.Subjects, struct {
				Kind      string `json:"kind"`
				Name      string `json:"name"`
				Namespace string `json:"ns,omitempty"`
			}{s.Kind, s.Name, s.Namespace})
		}
		snap.RoleBindings = append(snap.RoleBindings, bb)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(snap)
}

type SSARRequest struct {
	Cluster   string `json:"cluster"`
	Verb      string `json:"verb"`
	Group     string `json:"group"`
	Resource  string `json:"resource"`
	Namespace string `json:"ns"`
}

func (rb *RBAC) HandleSelfCheck(w http.ResponseWriter, r *http.Request) {
	var req SSARRequest
	if err := decodeBody(r, &req); err != nil || req.Cluster == "" || req.Verb == "" || req.Resource == "" {
		http.Error(w, "cluster, verb, resource required", http.StatusBadRequest)
		return
	}
	cs, err := rb.clientset(req.Cluster)
	if err != nil {
		http.Error(w, fmt.Sprintf("client: %v", err), http.StatusInternalServerError)
		return
	}
	review, err := cs.AuthorizationV1().SelfSubjectAccessReviews().Create(r.Context(), &authorizationv1.SelfSubjectAccessReview{
		Spec: authorizationv1.SelfSubjectAccessReviewSpec{
			ResourceAttributes: &authorizationv1.ResourceAttributes{
				Verb:      req.Verb,
				Group:     req.Group,
				Resource:  req.Resource,
				Namespace: req.Namespace,
			},
		},
	}, metav1.CreateOptions{})
	if err != nil {
		http.Error(w, fmt.Sprintf("ssar: %v", err), http.StatusBadGateway)
		return
	}
	st := review.Status
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"allowed": st.Allowed,
		"denied":  st.Denied,
		"reason":  st.Reason,
	})
}
