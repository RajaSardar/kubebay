package httpapi

import (
	"context"
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

func podWithEphemeral(running bool) *corev1.Pod {
	st := corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: "ContainerCreating"}}
	if running {
		st = corev1.ContainerState{Running: &corev1.ContainerStateRunning{}}
	}
	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "prod"},
		Spec: corev1.PodSpec{
			Containers:          []corev1.Container{{Name: "app"}},
			EphemeralContainers: []corev1.EphemeralContainer{{EphemeralContainerCommon: corev1.EphemeralContainerCommon{Name: "debugger-abcde"}}},
		},
		Status: corev1.PodStatus{
			Phase:                      corev1.PodRunning,
			ContainerStatuses:          []corev1.ContainerStatus{{Name: "app", State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{}}}},
			EphemeralContainerStatuses: []corev1.ContainerStatus{{Name: "debugger-abcde", State: st}},
		},
	}
}

func TestPreflightExecAcceptsARunningEphemeralContainer(t *testing.T) {
	cs := fake.NewSimpleClientset(podWithEphemeral(true))
	if msg := preflightExec(context.Background(), cs, "prod", "web", "debugger-abcde"); msg != "" {
		t.Errorf("running ephemeral container should pass preflight, got %q", msg)
	}
}

func TestPreflightExecReportsAWaitingEphemeralContainer(t *testing.T) {
	cs := fake.NewSimpleClientset(podWithEphemeral(false))
	msg := preflightExec(context.Background(), cs, "prod", "web", "debugger-abcde")
	if !strings.Contains(msg, "waiting") || !strings.Contains(msg, "ContainerCreating") {
		t.Errorf("msg = %q", msg)
	}
}
