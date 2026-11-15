import { EmptyState } from "@kubebay/ui";
import { selectorQuery, type LabelSelector } from "../lib/labelSelector";
import { ImageSignatureCheck } from "./ImageSignatureCheck";

/**
 * Backlog #45: the running-image signature check for one Deployment,
 * StatefulSet or DaemonSet, scoped to the pods its own selector picks.
 */
export function WorkloadSignaturesTab({ cluster, ns, obj }: { cluster: string; ns: string; obj: Record<string, unknown> | null }) {
  const spec = (obj?.spec ?? {}) as { selector?: LabelSelector };
  const selector = selectorQuery(spec.selector);
  if (!obj) return null;
  if (!selector) {
    return (
      <div style={{ padding: 14 }}>
        <EmptyState title="No pod selector" hint="This workload's selector can't be used to find its pods, so there's nothing to check." />
      </div>
    );
  }
  return (
    <div style={{ padding: 14 }}>
      <ImageSignatureCheck cluster={cluster} scope={{ ns, selector }} />
    </div>
  );
}
