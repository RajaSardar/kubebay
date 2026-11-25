// Package perffixture builds synthetic Kubernetes objects shaped like the ones
// a real cluster sends, for the engine's scale benchmarks and heap tests. It
// is imported only from _test.go files.
package perffixture

import (
	"fmt"
	"strconv"
)

// Pod is a running pod as an informer caches it (managedFields already
// trimmed of fieldsV1): two containers, env, probes, volumes, five
// conditions, two container statuses and four managedFields entries.
func Pod(i int) map[string]any {
	ns := fmt.Sprintf("ns-%d", i%20)
	name := fmt.Sprintf("web-%d-7d9f8c6b5-%05d", i%50, i)
	containers := []any{container("app", i), container("sidecar", i)}
	return map[string]any{
		"apiVersion": "v1",
		"kind":       "Pod",
		"metadata": map[string]any{
			"name":              name,
			"namespace":         ns,
			"uid":               fmt.Sprintf("00000000-0000-4000-8000-%012d", i),
			"resourceVersion":   "1000",
			"generateName":      fmt.Sprintf("web-%d-7d9f8c6b5-", i%50),
			"creationTimestamp": "2026-11-01T10:00:00Z",
			"labels": map[string]any{
				"app": fmt.Sprintf("web-%d", i%50), "pod-template-hash": "7d9f8c6b5",
				"app.kubernetes.io/part-of": "shop", "team": "payments", "tier": "backend",
			},
			"annotations": map[string]any{
				"kubectl.kubernetes.io/restartedAt": "2026-11-01T09:59:00Z",
				"prometheus.io/scrape":              "true",
				"prometheus.io/port":                "9090",
			},
			"ownerReferences": []any{map[string]any{
				"apiVersion": "apps/v1", "kind": "ReplicaSet", "name": fmt.Sprintf("web-%d-7d9f8c6b5", i%50),
				"uid": "11111111-0000-4000-8000-000000000000", "controller": true, "blockOwnerDeletion": true,
			}},
			"managedFields": []any{
				mf("kube-controller-manager", "Update", "", "2026-11-01T10:00:00Z"),
				mf("kube-scheduler", "Update", "status", "2026-11-01T10:00:01Z"),
				mf("kubelet", "Update", "status", "2026-11-01T10:00:05Z"),
				mf("istio-proxy", "Update", "", "2026-11-01T10:00:02Z"),
			},
		},
		"spec": map[string]any{
			"containers":                    containers,
			"restartPolicy":                 "Always",
			"terminationGracePeriodSeconds": int64(30),
			"dnsPolicy":                     "ClusterFirst",
			"serviceAccountName":            "web",
			"serviceAccount":                "web",
			"nodeName":                      fmt.Sprintf("ip-10-0-%d-%d.ec2.internal", i%8, i%200),
			"securityContext":               map[string]any{"runAsNonRoot": true, "fsGroup": int64(1000)},
			"schedulerName":                 "default-scheduler",
			"priority":                      int64(0),
			"enableServiceLinks":            true,
			"preemptionPolicy":              "PreemptLowerPriority",
			"tolerations": []any{
				map[string]any{"key": "node.kubernetes.io/not-ready", "operator": "Exists", "effect": "NoExecute", "tolerationSeconds": int64(300)},
				map[string]any{"key": "node.kubernetes.io/unreachable", "operator": "Exists", "effect": "NoExecute", "tolerationSeconds": int64(300)},
			},
			"volumes": []any{
				map[string]any{"name": "config", "configMap": map[string]any{"name": "web-config", "defaultMode": int64(420)}},
				map[string]any{"name": "tmp", "emptyDir": map[string]any{}},
				map[string]any{"name": "certs", "secret": map[string]any{"secretName": "web-tls", "defaultMode": int64(420)}},
				map[string]any{"name": "kube-api-access", "projected": map[string]any{"defaultMode": int64(420), "sources": []any{
					map[string]any{"serviceAccountToken": map[string]any{"expirationSeconds": int64(3607), "path": "token"}},
					map[string]any{"configMap": map[string]any{"name": "kube-root-ca.crt", "items": []any{map[string]any{"key": "ca.crt", "path": "ca.crt"}}}},
				}}},
			},
		},
		"status": map[string]any{
			"phase":     "Running",
			"hostIP":    fmt.Sprintf("10.0.%d.%d", i%8, i%200),
			"podIP":     fmt.Sprintf("10.1.%d.%d", (i/250)%250, i%250),
			"podIPs":    []any{map[string]any{"ip": fmt.Sprintf("10.1.%d.%d", (i/250)%250, i%250)}},
			"startTime": "2026-11-01T10:00:01Z",
			"qosClass":  "Burstable",
			"conditions": []any{
				cond("PodReadyToStartContainers"), cond("Initialized"), cond("Ready"), cond("ContainersReady"), cond("PodScheduled"),
			},
			"containerStatuses": []any{cstatus("app", i), cstatus("sidecar", i)},
		},
	}
}

func container(name string, i int) map[string]any {
	env := make([]any, 0, 10)
	for k := 0; k < 10; k++ {
		env = append(env, map[string]any{"name": "ENV_VAR_" + strconv.Itoa(k), "value": "value-" + strconv.Itoa(k*i%97)})
	}
	probe := map[string]any{
		"httpGet":          map[string]any{"path": "/healthz", "port": int64(8080), "scheme": "HTTP"},
		"periodSeconds":    int64(10),
		"timeoutSeconds":   int64(1),
		"successThreshold": int64(1),
		"failureThreshold": int64(3),
	}
	return map[string]any{
		"name":            name,
		"image":           "123456789012.dkr.ecr.us-east-1.amazonaws.com/" + name + ":v1.42.0",
		"imagePullPolicy": "IfNotPresent",
		"ports":           []any{map[string]any{"name": "http", "containerPort": int64(8080), "protocol": "TCP"}},
		"env":             env,
		"resources": map[string]any{
			"requests": map[string]any{"cpu": "250m", "memory": "256Mi"},
			"limits":   map[string]any{"memory": "512Mi"},
		},
		"volumeMounts": []any{
			map[string]any{"name": "config", "mountPath": "/etc/config", "readOnly": true},
			map[string]any{"name": "tmp", "mountPath": "/tmp"},
			map[string]any{"name": "certs", "mountPath": "/etc/tls", "readOnly": true},
			map[string]any{"name": "kube-api-access", "mountPath": "/var/run/secrets/kubernetes.io/serviceaccount", "readOnly": true},
		},
		"livenessProbe":            probe,
		"readinessProbe":           probe,
		"terminationMessagePath":   "/dev/termination-log",
		"terminationMessagePolicy": "File",
	}
}

func mf(manager, op, sub, t string) map[string]any {
	m := map[string]any{"manager": manager, "operation": op, "apiVersion": "v1", "time": t, "fieldsType": "FieldsV1"}
	if sub != "" {
		m["subresource"] = sub
	}
	return m
}

func cond(t string) map[string]any {
	return map[string]any{"type": t, "status": "True", "lastProbeTime": nil, "lastTransitionTime": "2026-11-01T10:00:05Z"}
}

func cstatus(name string, i int) map[string]any {
	return map[string]any{
		"name": name, "ready": true, "started": true, "restartCount": int64(0),
		"image":       "123456789012.dkr.ecr.us-east-1.amazonaws.com/" + name + ":v1.42.0",
		"imageID":     "123456789012.dkr.ecr.us-east-1.amazonaws.com/" + name + "@sha256:" + fmt.Sprintf("%064d", i),
		"containerID": "containerd://" + fmt.Sprintf("%064d", i),
		"state":       map[string]any{"running": map[string]any{"startedAt": "2026-11-01T10:00:04Z"}},
		"lastState":   map[string]any{},
		"volumeMounts": []any{
			map[string]any{"name": "config", "mountPath": "/etc/config", "readOnly": true, "recursiveReadOnly": "Disabled"},
		},
	}
}

// Churn is the next version of pod: what a kubelet status write does every
// few seconds. A new resourceVersion, the kubelet's managedFields time, a
// condition's transition time, and every fourth write a restart.
func Churn(pod map[string]any, n int) map[string]any {
	out := DeepCopy(pod)
	md := out["metadata"].(map[string]any)
	md["resourceVersion"] = strconv.Itoa(1000 + n)
	mfs := md["managedFields"].([]any)
	mfs[2].(map[string]any)["time"] = fmt.Sprintf("2026-11-01T10:%02d:%02dZ", (n/60)%60, n%60)
	st := out["status"].(map[string]any)
	conds := st["conditions"].([]any)
	conds[2].(map[string]any)["lastTransitionTime"] = fmt.Sprintf("2026-11-01T10:%02d:%02dZ", (n/60)%60, n%60)
	if n%4 == 0 {
		cs := st["containerStatuses"].([]any)[0].(map[string]any)
		cs["restartCount"] = int64(n / 4)
		cs["ready"] = n%8 == 0
	}
	return out
}

// DeepCopy copies a JSON-shaped value, as client-go hands each update a new
// object.
func DeepCopy(m map[string]any) map[string]any {
	return deepCopy(m).(map[string]any)
}

func deepCopy(v any) any {
	switch t := v.(type) {
	case map[string]any:
		o := make(map[string]any, len(t))
		for k, x := range t {
			o[k] = deepCopy(x)
		}
		return o
	case []any:
		o := make([]any, len(t))
		for i, x := range t {
			o[i] = deepCopy(x)
		}
		return o
	}
	return v
}
