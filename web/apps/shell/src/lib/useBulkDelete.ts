import { useState } from "react";

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

  function request(targets: DeleteTarget[]) {
    setError("");
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
    const outcomes = await Promise.allSettled(pending.map((t) => deleteOne(t)));
    const failures: Failure[] = [];
    const succeeded: DeleteTarget[] = [];
    outcomes.forEach((o, i) => {
      const target = pending[i]!;
      if (o.status === "rejected") {
        failures.push({ target, message: o.reason instanceof Error ? o.reason.message : String(o.reason) });
      } else {
        succeeded.push(target);
      }
    });
    setBusy(false);
    setPending(null);
    if (failures.length > 0) {
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
    return succeeded;
  }

  return { pending, busy, error, request, cancel, confirm, clearError: () => setError("") };
}
