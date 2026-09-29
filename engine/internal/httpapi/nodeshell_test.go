package httpapi

import "testing"

// buildNodeShellPod is a pure pod-spec builder factored out of HandleStart so
// it can be tested without a live cluster -- the thing under test is the
// spec's shape, not anything that talks to an apiserver.
func TestBuildNodeShellPod(t *testing.T) {
	pod := buildNodeShellPod("kubebay-node-shell-abcd1234", "node-1", "alpine")

	if pod.Name != "kubebay-node-shell-abcd1234" {
		t.Errorf("Name = %q, want kubebay-node-shell-abcd1234", pod.Name)
	}
	if pod.Spec.NodeName != "node-1" {
		t.Errorf("NodeName = %q, want node-1", pod.Spec.NodeName)
	}
	if !pod.Spec.HostPID {
		t.Error("HostPID = false, want true (needed so nsenter -t 1 can see the host's PID 1)")
	}
	if !pod.Spec.HostIPC {
		t.Error("HostIPC = false, want true (host namespace parity)")
	}
	if !pod.Spec.HostNetwork {
		t.Error("HostNetwork = false, want true (host namespace parity)")
	}
	if len(pod.Spec.Tolerations) != 1 || pod.Spec.Tolerations[0].Operator != "Exists" {
		t.Errorf("Tolerations = %+v, want a single tolerate-all entry", pod.Spec.Tolerations)
	}
	if len(pod.Spec.Containers) != 1 {
		t.Fatalf("Containers = %d, want 1", len(pod.Spec.Containers))
	}
	c := pod.Spec.Containers[0]
	if c.Image != "alpine" {
		t.Errorf("Image = %q, want alpine", c.Image)
	}
	if c.SecurityContext == nil || c.SecurityContext.Privileged == nil || !*c.SecurityContext.Privileged {
		t.Error("container is not privileged, want privileged: true")
	}
	if !c.Stdin || !c.StdinOnce || !c.TTY {
		t.Errorf("Stdin/StdinOnce/TTY = %v/%v/%v, want all true", c.Stdin, c.StdinOnce, c.TTY)
	}
}
