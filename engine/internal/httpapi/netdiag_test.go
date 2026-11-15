package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBuildNetDiagPod(t *testing.T) {
	pod := buildNetDiagPod("kubebay-netdiag-abcd1234", "shop", "", "netshoot:test")

	if pod.Namespace != "shop" {
		t.Errorf("Namespace = %q, want shop (DNS search path and NetworkPolicies must match the namespace under test)", pod.Namespace)
	}
	if pod.Labels["app.kubernetes.io/managed-by"] != "kubebay" || pod.Labels["kubebay.io/role"] != "netdiag" {
		t.Errorf("Labels = %v, want managed-by=kubebay and role=netdiag only", pod.Labels)
	}
	if len(pod.Labels) != 2 {
		t.Errorf("Labels = %v: extra labels could make a Service route real traffic to the diagnostic pod", pod.Labels)
	}
	if pod.Spec.NodeName != "" {
		t.Errorf("NodeName = %q, want unset when no node is requested", pod.Spec.NodeName)
	}
	if pod.Spec.HostNetwork || pod.Spec.HostPID || pod.Spec.HostIPC {
		t.Error("diagnostic pod must use the pod network, not the host's")
	}
	if pod.Spec.AutomountServiceAccountToken == nil || *pod.Spec.AutomountServiceAccountToken {
		t.Error("AutomountServiceAccountToken must be false: the pod needs no API credentials")
	}
	if pod.Spec.ActiveDeadlineSeconds == nil || *pod.Spec.ActiveDeadlineSeconds != 3600 {
		t.Errorf("ActiveDeadlineSeconds = %v, want 3600 so an orphaned pod stops on its own", pod.Spec.ActiveDeadlineSeconds)
	}
	if pod.Spec.RestartPolicy != "Never" {
		t.Errorf("RestartPolicy = %q, want Never", pod.Spec.RestartPolicy)
	}
	if len(pod.Spec.Containers) != 1 {
		t.Fatalf("Containers = %d, want 1", len(pod.Spec.Containers))
	}
	c := pod.Spec.Containers[0]
	if c.Name != "netdiag" || c.Image != "netshoot:test" {
		t.Errorf("container = %s/%s, want netdiag/netshoot:test", c.Name, c.Image)
	}
	sc := c.SecurityContext
	if sc == nil || sc.Privileged != nil && *sc.Privileged {
		t.Error("container must not be privileged")
	}
	if sc == nil || sc.AllowPrivilegeEscalation == nil || *sc.AllowPrivilegeEscalation {
		t.Error("AllowPrivilegeEscalation must be false")
	}
	if strings.Join(c.Command, " ") != "sleep 3600" {
		t.Errorf("Command = %v, want sleep 3600", c.Command)
	}
}

func TestBuildNetDiagPodPinnedToNode(t *testing.T) {
	pod := buildNetDiagPod("x", "shop", "node-1", "img")
	if pod.Spec.NodeName != "node-1" {
		t.Errorf("NodeName = %q, want node-1", pod.Spec.NodeName)
	}
}

func TestNetDiagImageResolution(t *testing.T) {
	t.Setenv("KUBEBAY_NETDIAG_IMAGE", "")
	if got := netDiagImage(""); got != DefaultNetDiagImage {
		t.Errorf("default image = %q, want %q", got, DefaultNetDiagImage)
	}
	t.Setenv("KUBEBAY_NETDIAG_IMAGE", "mirror.local/netshoot:1")
	if got := netDiagImage(""); got != "mirror.local/netshoot:1" {
		t.Errorf("env image = %q, want mirror.local/netshoot:1", got)
	}
	if got := netDiagImage("custom:2"); got != "custom:2" {
		t.Errorf("requested image = %q, want custom:2", got)
	}
}

func TestNetDiagRequiresClusterAndNamespace(t *testing.T) {
	m := &NetDiagManager{}
	for _, body := range []string{`{}`, `{"cluster":"c"}`, `{"namespace":"shop"}`, `{"cluster":"c","namespace":"Bad_NS"}`} {
		rr := httptest.NewRecorder()
		m.HandleStart(rr, httptest.NewRequest(http.MethodPost, "/api/netdiag", strings.NewReader(body)))
		if rr.Code != http.StatusBadRequest {
			t.Errorf("body %s: status = %d, want 400", body, rr.Code)
		}
	}
}
