import type { ReactNode } from "react";
import { EmptyState, InlineBanner } from "@kubebay/ui";
import { listKinds, type Denied } from "../lib/forbidden";
import type { NamespaceDenial } from "../lib/useResourceStream";

/**
 * What RBAC doesn't let this identity list, in place of a loader that would
 * never finish: one line naming the kinds, then each API server reason, and
 * where this identity can look instead when the page knows.
 */
export function ForbiddenState({ denied, action }: { denied: readonly Denied[]; action?: ReactNode }) {
  return (
    <EmptyState>
      <p>You can't list {listKinds(denied.map((d) => d.what))} here.</p>
      {denied.map((d) => (
        <p key={d.what} className="muted small">
          {d.reason}
        </p>
      ))}
      {action}
    </EmptyState>
  );
}

/** The filtered namespaces RBAC lets this identity list, as a phrase. */
function shownNamespaces(namespaces: readonly string[] | undefined, denied: readonly NamespaceDenial[]): string {
  const refused = new Set(denied.map((d) => d.ns));
  return listKinds((namespaces ?? []).filter((ns) => !refused.has(ns)));
}

/**
 * Over a list filtered to namespaces, some of which RBAC refused (ADR 0003):
 * which, the API server's reasons, and which namespaces the list shows.
 */
export function NamespacesDeniedBanner({
  noun,
  namespaces,
  denied,
  flush,
}: {
  noun: string;
  namespaces: readonly string[] | undefined;
  denied: readonly NamespaceDenial[];
  flush?: boolean;
}) {
  const shown = shownNamespaces(namespaces, denied);
  return (
    <InlineBanner tone="warn" flush={flush}>
      <div>
        <div>
          You can't list {noun} in {listKinds(denied.map((d) => d.ns))}.{shown ? ` Showing ${shown}.` : ""}
        </div>
        {denied.map((d) => (
          <div key={d.ns} className="small">
            {d.reason}
          </div>
        ))}
      </div>
    </InlineBanner>
  );
}
