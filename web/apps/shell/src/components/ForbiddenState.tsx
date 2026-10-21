import { EmptyState } from "@kubebay/ui";
import { listKinds, type Denied } from "../lib/forbidden";

/**
 * What RBAC doesn't let this identity list, in place of a loader that would
 * never finish: one line naming the kinds, then each API server reason.
 */
export function ForbiddenState({ denied }: { denied: readonly Denied[] }) {
  return (
    <EmptyState>
      <p>You can't list {listKinds(denied.map((d) => d.what))} here.</p>
      {denied.map((d) => (
        <p key={d.what} className="muted small">
          {d.reason}
        </p>
      ))}
    </EmptyState>
  );
}
