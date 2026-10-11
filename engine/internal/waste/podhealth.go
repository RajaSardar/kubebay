package waste

import (
	"time"

	corev1 "k8s.io/api/core/v1"
)

// podGrace is how long a pod may be Pending or not ready before it counts as
// broken, as on the Overview's Needs attention list.
const podGrace = 5 * time.Minute

// podBroken reports whether a pod needs attention, judged from the pod alone.
func podBroken(pod corev1.Pod, now time.Time) bool {
	return podReason(pod, now) != ""
}

// podReason is why a pod needs attention, as a Kubernetes reason code
// (CrashLoopBackOff, OOMKilled, Unschedulable, Pending, NotReady…), or "" when
// it is fine. It is the Overview's rule (podProblem in the shell's
// attention.ts) without node trouble, which needs the node list; a pod on a
// failing node still counts, as NotReady, once it has been not ready past the
// grace period. Both sides run the fixtures in
// web/apps/shell/src/lib/__fixtures__/podBroken.json.
func podReason(pod corev1.Pod, now time.Time) string {
	if pod.DeletionTimestamp != nil {
		return ""
	}
	switch pod.Status.Phase {
	case corev1.PodSucceeded:
		return ""
	case corev1.PodFailed:
		if pod.Status.Reason == "Evicted" {
			return "Evicted"
		}
		return "Failed"
	}

	for _, cs := range pod.Status.ContainerStatuses {
		if w := cs.State.Waiting; w != nil && w.Reason != "" && w.Reason != "ContainerCreating" && w.Reason != "PodInitializing" {
			if t := cs.LastTerminationState.Terminated; t != nil && t.Reason == "OOMKilled" {
				return "OOMKilled"
			}
			return w.Reason
		}
	}

	created := pod.CreationTimestamp.Time
	since := created
	for _, c := range pod.Status.Conditions {
		if c.Type == corev1.PodScheduled && c.Status == corev1.ConditionFalse && c.Reason == corev1.PodReasonUnschedulable {
			return "Unschedulable"
		}
		if c.Type == corev1.PodReady && c.Status == corev1.ConditionFalse && !c.LastTransitionTime.IsZero() {
			since = c.LastTransitionTime.Time
		}
	}

	if pod.Status.Phase == corev1.PodPending {
		if !created.IsZero() && now.Sub(created) > podGrace {
			return "Pending"
		}
		return ""
	}
	allReady := len(pod.Status.ContainerStatuses) > 0
	for _, cs := range pod.Status.ContainerStatuses {
		allReady = allReady && cs.Ready
	}
	if !allReady && !since.IsZero() && now.Sub(since) > podGrace {
		return "NotReady"
	}
	return ""
}
