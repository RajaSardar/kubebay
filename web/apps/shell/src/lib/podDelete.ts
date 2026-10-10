type Obj = Record<string, unknown>;

export interface ForceDeleteEffect {
  /** Grace period 0 changes anything: the pod is scheduled and hasn't finished. */
  skipsGrace: boolean;
  /** The pod has finalizers for force delete to strip. */
  removesFinalizers: boolean;
}

/**
 * What "force" would add to deleting this pod (backlog #18). The API server
 * already deletes a finished (Succeeded/Failed) or unscheduled pod with no
 * grace period (pod strategy CheckGracefulDelete), so force only matters there
 * when a finalizer, such as a Job's tracking finalizer, holds the pod. Without
 * the pod object both are assumed, so force is never hidden by mistake.
 */
export function forceDeleteEffect(pod: Obj | undefined | null): ForceDeleteEffect {
  if (!pod) return { skipsGrace: true, removesFinalizers: true };
  const meta = (pod.metadata ?? {}) as Obj;
  const spec = (pod.spec ?? {}) as Obj;
  const phase = ((pod.status ?? {}) as Obj).phase;
  const finished = phase === "Succeeded" || phase === "Failed";
  const scheduled = typeof spec.nodeName === "string" && spec.nodeName !== "";
  const finalizers = Array.isArray(meta.finalizers) ? meta.finalizers : [];
  return { skipsGrace: scheduled && !finished, removesFinalizers: finalizers.length > 0 };
}

/** The force checkbox's label for an effect, or null to hide it. */
export function forceDeleteLabel(e: ForceDeleteEffect): string | null {
  if (e.skipsGrace && e.removesFinalizers) return "force (skip grace period, remove finalizers)";
  if (e.skipsGrace) return "force (skip grace period)";
  if (e.removesFinalizers) return "remove finalizers";
  return null;
}
