package searchindex

import "strings"

// Tier says whether a kind is followed as soon as anyone searches, or only
// once a query names it.
type Tier int

const (
	// TierDefault kinds are cheap and commonly wanted.
	TierDefault Tier = iota
	// TierOnDemand kinds are high-churn or bulky (Events, Leases, report CRDs):
	// they are followed when a query names them, `events crashloop`.
	TierOnDemand
)

// Kind is something that can be searched.
type Kind struct {
	// GVR is how the pool names it: "networking.k8s.io/v1/ingresses".
	GVR string `json:"gvr"`
	// Slug is the UI's route key: "ingresses", or "ext--group--version--plural" for a custom resource.
	Slug  string `json:"slug"`
	Label string `json:"label"`
	// Aliases are the words that name the kind in a query, lower case.
	Aliases []string `json:"aliases"`
	Tier    Tier     `json:"tier"`
	// Synthetic kinds have entries from the catalogue (CRD definitions), not an informer.
	Synthetic bool `json:"synthetic"`
	// ClusterScoped marks a custom resource kind with no namespace, which the UI
	// must say in the route it opens.
	ClusterScoped bool `json:"clusterScoped"`
	// Local kinds are ones the app already holds in memory and searches itself.
	// The index knows their words, so "deploy api" is read as a kind and a
	// word, but it never follows them.
	Local bool `json:"local"`
}

// CRD is what the catalogue needs to know about a CustomResourceDefinition.
type CRD struct {
	Name       string
	Group      string
	Version    string
	Plural     string
	Singular   string
	Kind       string
	ShortNames []string
	Namespaced bool
}

// b is a built-in kind: the UI's route slug, label and resource path, and the
// words that name it in a query. The slugs, labels and paths are the UI's own
// (web/apps/shell/src/lib/resources.ts). The kinds the app already holds in
// memory (pods, deployments, statefulsets, daemonsets, jobs, nodes,
// namespaces) are left out: the palette searches those itself.
func b(slug, label, gvr string, tier Tier, aliases ...string) Kind {
	return Kind{Slug: slug, Label: label, GVR: gvr, Tier: tier, Aliases: aliases}
}

// BuiltinKinds is every other built-in kind. Cheap ones are followed as soon as
// anyone searches. High-churn or bulky ones (Events, Leases, Endpoints, report
// objects) are followed when a query names them: `events crashloop`.
func BuiltinKinds() []Kind {
	d, o := TierDefault, TierOnDemand
	return []Kind{
		b("services", "Services", "v1/services", d, "service", "services", "svc"),
		b("ingresses", "Ingresses", "networking.k8s.io/v1/ingresses", d, "ingress", "ingresses", "ing"),
		b("configmaps", "ConfigMaps", "v1/configmaps", d, "configmap", "configmaps", "cm"),
		b("secrets", "Secrets", "v1/secrets", d, "secret", "secrets"),
		b("persistentvolumeclaims", "PVCs", "v1/persistentvolumeclaims", d, "persistentvolumeclaim", "persistentvolumeclaims", "pvc", "pvcs"),
		b("persistentvolumes", "PVs", "v1/persistentvolumes", d, "persistentvolume", "persistentvolumes", "pv", "pvs"),
		b("storageclasses", "StorageClasses", "storage.k8s.io/v1/storageclasses", d, "storageclass", "storageclasses", "sc"),
		b("networkpolicies", "NetworkPolicies", "networking.k8s.io/v1/networkpolicies", d, "networkpolicy", "networkpolicies", "netpol", "netpols"),
		b("horizontalpodautoscalers", "HPAs", "autoscaling/v2/horizontalpodautoscalers", d, "horizontalpodautoscaler", "horizontalpodautoscalers", "hpa", "hpas"),
		b("verticalpodautoscalers", "VerticalPodAutoscalers", "autoscaling.k8s.io/v1/verticalpodautoscalers", d, "verticalpodautoscaler", "verticalpodautoscalers", "vpa", "vpas"),
		b("poddisruptionbudgets", "PDBs", "policy/v1/poddisruptionbudgets", d, "poddisruptionbudget", "poddisruptionbudgets", "pdb", "pdbs"),
		b("resourcequotas", "ResourceQuotas", "v1/resourcequotas", d, "resourcequota", "resourcequotas", "quota", "quotas", "rq"),
		b("limitranges", "LimitRanges", "v1/limitranges", d, "limitrange", "limitranges", "limits"),
		b("serviceaccounts", "ServiceAccounts", "v1/serviceaccounts", d, "serviceaccount", "serviceaccounts", "sa"),
		b("roles", "Roles", "rbac.authorization.k8s.io/v1/roles", d, "role", "roles"),
		b("clusterroles", "ClusterRoles", "rbac.authorization.k8s.io/v1/clusterroles", d, "clusterrole", "clusterroles", "cr"),
		b("rolebindings", "RoleBindings", "rbac.authorization.k8s.io/v1/rolebindings", d, "rolebinding", "rolebindings", "rb"),
		b("clusterrolebindings", "ClusterRoleBindings", "rbac.authorization.k8s.io/v1/clusterrolebindings", d, "clusterrolebinding", "clusterrolebindings", "crb"),
		b("ingressclasses", "IngressClasses", "networking.k8s.io/v1/ingressclasses", d, "ingressclass", "ingressclasses"),
		b("priorityclasses", "PriorityClasses", "scheduling.k8s.io/v1/priorityclasses", d, "priorityclass", "priorityclasses", "pc"),
		b("runtimeclasses", "RuntimeClasses", "node.k8s.io/v1/runtimeclasses", d, "runtimeclass", "runtimeclasses"),
		b("volumeattachments", "VolumeAttachments", "storage.k8s.io/v1/volumeattachments", d, "volumeattachment", "volumeattachments"),
		b("csidrivers", "CSI Drivers", "storage.k8s.io/v1/csidrivers", d, "csidriver", "csidrivers"),
		b("csinodes", "CSI Nodes", "storage.k8s.io/v1/csinodes", d, "csinode", "csinodes"),
		b("mutatingwebhookconfigurations", "Mutating Webhooks", "admissionregistration.k8s.io/v1/mutatingwebhookconfigurations", d, "mutatingwebhookconfiguration", "mutatingwebhookconfigurations", "mutatingwebhook", "mutatingwebhooks"),
		b("validatingwebhookconfigurations", "Validating Webhooks", "admissionregistration.k8s.io/v1/validatingwebhookconfigurations", d, "validatingwebhookconfiguration", "validatingwebhookconfigurations", "validatingwebhook", "validatingwebhooks"),
		b("validatingadmissionpolicies", "Admission Policies", "admissionregistration.k8s.io/v1/validatingadmissionpolicies", d, "validatingadmissionpolicy", "validatingadmissionpolicies", "vap"),
		b("validatingadmissionpolicybindings", "Policy Bindings", "admissionregistration.k8s.io/v1/validatingadmissionpolicybindings", d, "validatingadmissionpolicybinding", "validatingadmissionpolicybindings", "vapb"),
		b("replicasets", "ReplicaSets", "apps/v1/replicasets", d, "replicaset", "replicasets", "rs"),
		b("replicationcontrollers", "ReplicationControllers", "v1/replicationcontrollers", d, "replicationcontroller", "replicationcontrollers", "rc"),
		b("cronjobs", "CronJobs", "batch/v1/cronjobs", d, "cronjob", "cronjobs", "cj"),
		b("certificatesigningrequests", "CertSigningRequests", "certificates.k8s.io/v1/certificatesigningrequests", d, "certificatesigningrequest", "certificatesigningrequests", "csr"),
		b("apiservices", "API Services", "apiregistration.k8s.io/v1/apiservices", d, "apiservice", "apiservices"),
		b("resourceclaims", "ResourceClaims", "resource.k8s.io/v1/resourceclaims", d, "resourceclaim", "resourceclaims"),
		b("resourceclaimtemplates", "ResourceClaimTemplates", "resource.k8s.io/v1/resourceclaimtemplates", d, "resourceclaimtemplate", "resourceclaimtemplates"),
		b("deviceclasses", "DeviceClasses", "resource.k8s.io/v1/deviceclasses", d, "deviceclass", "deviceclasses"),

		b("events", "Events", "v1/events", o, "event", "events", "ev"),
		b("leases", "Leases", "coordination.k8s.io/v1/leases", o, "lease", "leases"),
		b("endpoints", "Endpoints", "v1/endpoints", o, "endpoint", "endpoints", "ep"),
		b("endpointslices", "EndpointSlices", "discovery.k8s.io/v1/endpointslices", o, "endpointslice", "endpointslices"),
		b("controllerrevisions", "ControllerRevisions", "apps/v1/controllerrevisions", o, "controllerrevision", "controllerrevisions"),
		b("csistoragecapacities", "CSI Capacities", "storage.k8s.io/v1/csistoragecapacities", o, "csistoragecapacity", "csistoragecapacities"),
		b("flowschemas", "FlowSchemas", "flowcontrol.apiserver.k8s.io/v1/flowschemas", o, "flowschema", "flowschemas"),
		b("prioritylevelconfigurations", "Priority Levels", "flowcontrol.apiserver.k8s.io/v1/prioritylevelconfigurations", o, "prioritylevelconfiguration", "prioritylevelconfigurations"),
		b("resourceslices", "ResourceSlices", "resource.k8s.io/v1/resourceslices", o, "resourceslice", "resourceslices"),
		b("policyreports", "Policy Reports", "wgpolicyk8s.io/v1alpha2/policyreports", o, "policyreport", "policyreports"),
		b("clusterpolicyreports", "Cluster Policy Reports", "wgpolicyk8s.io/v1alpha2/clusterpolicyreports", o, "clusterpolicyreport", "clusterpolicyreports"),
		b("vulnerabilityreports", "Vulnerability Reports", "aquasecurity.github.io/v1alpha1/vulnerabilityreports", o, "vulnerabilityreport", "vulnerabilityreports", "vuln", "vulns"),
		b("clustervulnerabilityreports", "Cluster Vulnerability Reports", "aquasecurity.github.io/v1alpha1/clustervulnerabilityreports", o, "clustervulnerabilityreport", "clustervulnerabilityreports"),
	}
}

// CRDDefinitionsKind is the CRDs themselves, searchable by name. Its entries
// come from the catalogue, so it opens no watch.
func CRDDefinitionsKind() Kind {
	return Kind{
		Slug:      "crds",
		Label:     "CRDs",
		Aliases:   []string{"crd", "crds", "customresourcedefinition", "customresourcedefinitions"},
		Synthetic: true,
	}
}

// CRDNames are the names a definitions search matches: "rollouts.argoproj.io".
func CRDNames(crds []CRD) []string {
	out := make([]string, 0, len(crds))
	for _, c := range crds {
		out = append(out, c.Name)
	}
	return out
}

// Groups whose custom resources are commonly looked for and modest in number.
// Any other group's kinds are on demand: the engine follows them when a query
// names one, so nothing is out of reach and nothing is watched in advance.
var defaultGroups = []string{
	"argoproj.io", "fluxcd.io", "keda.sh", "karpenter.sh", "karpenter.k8s.aws",
	"gateway.networking.k8s.io", "cert-manager.io", "external-secrets.io",
	"monitoring.coreos.com", "kyverno.io", "velero.io", "istio.io", "traefik.io",
}

// Groups that hold one object per container or per resource: always on demand.
var reportGroups = []string{"aquasecurity.github.io", "wgpolicyk8s.io", "reports.kyverno.io", "openreports.io"}

func groupIn(group string, list []string) bool {
	for _, g := range list {
		if group == g || strings.HasSuffix(group, "."+g) {
			return true
		}
	}
	return false
}

func pluralLabel(kind, plural string) string {
	switch {
	case strings.EqualFold(plural, kind+"s"):
		return kind + "s"
	case strings.EqualFold(plural, kind+"es"):
		return kind + "es"
	case strings.HasSuffix(kind, "y") && strings.EqualFold(plural, kind[:len(kind)-1]+"ies"):
		return kind[:len(kind)-1] + "ies"
	}
	return kind
}

// CRDKinds makes a searchable kind of each custom resource. taken holds the
// kind words already in use (core's win over a CRD named alike), and covered the
// resource paths another kind already follows.
func CRDKinds(crds []CRD, taken map[string]string, covered map[string]bool) []Kind {
	used := map[string]bool{}
	for a := range taken {
		used[a] = true
	}
	var out []Kind
	for _, c := range crds {
		gvr := c.Group + "/" + c.Version + "/" + c.Plural
		if covered[gvr] || c.Plural == "" || c.Version == "" {
			continue
		}
		tier := TierOnDemand
		if groupIn(c.Group, defaultGroups) && !groupIn(c.Group, reportGroups) {
			tier = TierDefault
		}
		var aliases []string
		add := func(a string) {
			a = strings.ToLower(a)
			if a != "" && !used[a] {
				used[a] = true
				aliases = append(aliases, a)
			}
		}
		add(c.Plural)
		add(c.Singular)
		add(c.Kind)
		for _, s := range c.ShortNames {
			add(s)
		}
		add(c.Name)
		out = append(out, Kind{
			GVR:     gvr,
			Slug:    "ext--" + strings.ReplaceAll(gvr, "/", "--"),
			Label:   pluralLabel(c.Kind, c.Plural),
			Aliases: aliases,
			Tier:    tier,

			ClusterScoped: !c.Namespaced,
		})
	}
	return out
}

// LocalKinds are the kinds the palette searches from memory: it follows them in
// the background for every connected cluster, so the engine need not.
func LocalKinds() []Kind {
	l := func(slug, label, gvr string, aliases ...string) Kind {
		return Kind{Slug: slug, Label: label, GVR: gvr, Aliases: aliases, Local: true}
	}
	return []Kind{
		l("pods", "Pods", "v1/pods", "pod", "pods", "po"),
		l("deployments", "Deployments", "apps/v1/deployments", "deployment", "deployments", "deploy", "dep"),
		l("statefulsets", "StatefulSets", "apps/v1/statefulsets", "statefulset", "statefulsets", "sts"),
		l("daemonsets", "DaemonSets", "apps/v1/daemonsets", "daemonset", "daemonsets", "ds"),
		l("jobs", "Jobs", "batch/v1/jobs", "job", "jobs"),
		l("nodes", "Nodes", "v1/nodes", "node", "nodes", "no"),
		l("namespaces", "Namespaces", "v1/namespaces", "namespace", "namespaces", "ns"),
	}
}

// Reserved are the kind words and resource paths already taken, by the local
// kinds and the built-in ones, so a custom resource neither steals a word from
// core nor is followed twice.
func Reserved() (aliases map[string]string, covered map[string]bool) {
	aliases, covered = map[string]string{}, map[string]bool{}
	all := append(LocalKinds(), BuiltinKinds()...)
	all = append(all, CRDDefinitionsKind())
	for _, k := range all {
		for _, a := range k.Aliases {
			aliases[a] = k.Slug
		}
		if k.GVR != "" {
			covered[k.GVR] = true
		}
	}
	return aliases, covered
}
