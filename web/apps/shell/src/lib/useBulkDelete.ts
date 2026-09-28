import { useState } from "react";
import { PolicyRejectionError, type PolicyRejectionDetail } from "./policyRejection";

export interface DeleteTarget {
  ns: string;
  name: string;
}

interface Failure {
  target: DeleteTarget;
  message: string;
}

/**
 * Drives a confirm-then-delete flow for one or many targets at once, sharing the same
 * confirm-banner shape whether it's a single row (context menu "Delete") or a bulk
 * selection ("Delete N selected").
 */
export function useBulkDelete(deleteOne: (t: DeleteTarget) => Promise<unknown>) {
  const [pending, setPending] = useState<DeleteTarget[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rejection, setRejection] = useState<PolicyRejectionDetail | null>(null);

  function request(targets: DeleteTarget[]) {
    setError("");
    setRejection(null);
    setPending(targets);
  }

  function cancel() {
    if (busy) return;
    setPending(null);
  }

  async function confirm(): Promise<DeleteTarget[]> {
    if (!pending || pending.length === 0) return [];
    setBusy(true);
    setError("");
    setRejection(null);
    const outcomes = await Promise.allSettled(pending.map((t) => deleteOne(t)));
    const failures: Failure[] = [];
    const succeeded: DeleteTarget[] = [];
    let soleRejection: PolicyRejectionDetail | null = null;
    outcomes.forEach((o, i) => {
      const target = pending[i]!;
      if (o.status === "rejected") {
        failures.push({ target, message: o.reason instanceof Error ? o.reason.message : String(o.reason) });
        if (o.reason instanceof PolicyRejectionError) soleRejection = o.reason.rejection;
      } else {
        succeeded.push(target);
      }
    });
    setBusy(false);
    setPending(null);
    if (failures.length > 0) {
      // A structured card only makes sense when there's exactly one target and
      // its one failure is a policy rejection — a bulk failure mixing targets
      // and/or causes stays the existing aggregate string.
      if (pending.length === 1 && failures.length === 1 && soleRejection) {
        setRejection(soleRejection);
      } else {
        const reasons = failures
          .slice(0, 3)
          .map((f) => (pending.length === 1 ? f.message : `${f.target.name}: ${f.message}`))
          .join("; ");
        setError(
          pending.length === 1
            ? `Delete failed: ${reasons}`
            : `${succeeded.length} of ${pending.length} deleted, ${failures.length} failed: ${reasons}`,
        );
      }
    }
    return succeeded;
  }

  return { pending, busy, error, rejection, request, cancel, confirm, clearError: () => setError("") };
}
