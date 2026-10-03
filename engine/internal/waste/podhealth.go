package waste

import (
	"time"

	corev1 "k8s.io/api/core/v1"
)

// podGrace is how long a pod may be Pending or not ready before it counts as
// broken, as on the Overview's Needs attention list.
const podGrace = 5 * time.Minute

// podBroken reports whether a pod needs attention, judged from the pod alone.
// It is the Overview's rule (podProblem in the shell's attention.ts) without
// node trouble, which needs the node list; a pod on a failing node still
// counts once it has been not ready past the grace period. Both sides run the
// fixtures in web/apps/shell/src/lib/__fixtures__/podBroken.json.
func podBroken(pod corev1.Pod, now time.Time) bool {
	if pod.DeletionTimestamp != nil {
		return false
	}
	switch pod.Status.Phase {
	case corev1.PodSucceeded:
		return false
	case corev1.PodFailed:
		return true
	}

	for _, cs := range pod.Status.ContainerStatuses {
		if w := cs.State.Waiting; w != nil && w.Reason != "" && w.Reason != "ContainerCreating" && w.Reason != "PodInitializing" {
			return true
		}
	}

	created := pod.CreationTimestamp.Time
	since := created
	for _, c := range pod.Status.Conditions {
		if c.Type == corev1.PodScheduled && c.Status == corev1.ConditionFalse && c.Reason == corev1.PodReasonUnschedulable {
			return true
		}
		if c.Type == corev1.PodReady && c.Status == corev1.ConditionFalse && !c.LastTransitionTime.IsZero() {
			since = c.LastTransitionTime.Time
		}
	}

	if pod.Status.Phase == corev1.PodPending {
		return !created.IsZero() && now.Sub(created) > podGrace
	}
	allReady := len(pod.Status.ContainerStatuses) > 0
	for _, cs := range pod.Status.ContainerStatuses {
		allReady = allReady && cs.Ready
	}
	return !allReady && !since.IsZero() && now.Sub(since) > podGrace
}
