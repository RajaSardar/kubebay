import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Badge, CellLink, DataTable, InlineBanner, SkeletonLines, Stack } from "@kubebay/ui";
import { helmApi, type HelmRelease, type ReleaseHook, type ReleaseResource } from "../lib/api";
import { groupResources, resourceHref, stuckFor } from "../lib/helmDetails";
import { fmtAge } from "../lib/resources";

// ADR 0004 S8: a Helm release's Overview, its drawer's first tab. Everything
// here comes from one read of the release as the person signed in; the
// objects are references, never what they hold.

const APPLY_LABEL: Record<string, string> = { ssa: "server-side apply", csa: "client-side apply" };

const AFTER_RUN: Record<string, string> = {
  "hook-succeeded": "deleted when it succeeds",
  "hook-failed": "deleted when it fails",
  "before-hook-creation": "replaced on its next run",
};

function ago(iso?: string): string {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? "" : `${fmtAge(Date.now() - t)} ago`;
}

function ObjectLink({ to, children }: { to: string; children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <CellLink
      href={to}
      onClick={(e) => {
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </CellLink>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="pod-kv">
      <span className="muted small">{label}</span>
      <span className="small">{children}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack as="section" gap={2} aria-label={title}>
      <div className="pod-section-title">{title}</div>
      {children}
    </Stack>
  );
}

function ResourceGroup({ group, rows }: { group: string; rows: ReleaseResource[] }) {
  return (
    <Section title={group}>
      <DataTable
        rows={rows}
        rowKey={(r) => `${r.apiVersion}/${r.kind}/${r.namespace ?? ""}/${r.name}`}
        columns={[
          { key: "kind", header: "Kind", className: "small", render: (r) => r.kind },
          {
            key: "name",
            header: "Name",
            className: "mono small",
            render: (r) => {
              const href = resourceHref(r);
              if (href) return <ObjectLink to={href}>{r.name}</ObjectLink>;
              return (
                <>
                  {r.name} {!r.served && <Badge tone="warn">not served by this cluster</Badge>}
                </>
              );
            },
          },
          { key: "ns", header: "Namespace", className: "mono small muted", render: (r) => r.namespace || "–" },
        ]}
      />
    </Section>
  );
}

function Hooks({ hooks }: { hooks: ReleaseHook[] }) {
  return (
    <Section title="Hooks">
      <DataTable
        rows={hooks}
        rowKey={(h) => `${h.kind}/${h.name}`}
        columns={[
          {
            key: "hook",
            header: "Hook",
            className: "small",
            render: (h) => (
              <>
                <span className="muted">{h.kind}</span> <span className="mono">{h.name}</span>
              </>
            ),
          },
          { key: "events", header: "Runs on", className: "small", render: (h) => h.events.join(", ") },
          {
            key: "last",
            header: "Last run",
            className: "small",
            render: (h) =>
              h.phase ? (
                <Badge tone={h.phase === "Succeeded" ? "ok" : h.phase === "Failed" ? "err" : undefined}>
                  {h.phase}
                  {h.completedAt || h.startedAt ? ` · ${ago(h.completedAt || h.startedAt)}` : ""}
                </Badge>
              ) : (
                <span className="muted">not run</span>
              ),
          },
          {
            key: "after",
            header: "After it runs",
            className: "small muted",
            render: (h) => (h.deletePolicies ?? []).map((p) => AFTER_RUN[p] ?? p).join(", ") || "kept",
          },
        ]}
      />
    </Section>
  );
}

export function ReleaseOverview({ cluster, rel }: { cluster: string; rel: HelmRelease }) {
  // Read again whenever the release moves on, from here or anywhere else.
  const q = useQuery({
    queryKey: ["helm-release", cluster, rel.namespace, rel.name, rel.revision, rel.status],
    queryFn: () => helmApi.details(cluster, rel.namespace, rel.name),
    retry: false,
  });
  const stuck = stuckFor(rel);

  if (q.isLoading) return <SkeletonLines lines={8} label="Loading release…" />;

  return (
    <Stack gap={4} className="pod-summary" style={{ padding: 14, overflowY: "auto", flex: 1 }}>
      {stuck !== null && (
        <InlineBanner tone="warn" flush>
          This release has been {rel.status} for {stuck} minutes, longer than Helm's 5-minute timeout: the change may have stopped part-way,
          and Helm won't start another until it settles.
        </InlineBanner>
      )}
      {q.isError && <InlineBanner flush>{q.error instanceof Error ? q.error.message : String(q.error)}</InlineBanner>}

      <Section title="Release">
        <Fact label="Chart">{`${rel.chart} ${rel.chartVersion}`.trim() || "–"}</Fact>
        <Fact label="App version">{rel.appVersion || "–"}</Fact>
        <Fact label="Revision">{rel.revision}</Fact>
        <Fact label="Status">{rel.status}</Fact>
        <Fact label="Updated">{ago(rel.updated) || "–"}</Fact>
        {rel.description && <Fact label="Last change">{rel.description}</Fact>}
        {rel.applyMethod && <Fact label="Applied with">{APPLY_LABEL[rel.applyMethod] ?? rel.applyMethod}</Fact>}
      </Section>

      {q.data && (
        <>
          {groupResources(q.data.resources).map((g) => (
            <ResourceGroup key={g.group} group={g.group} rows={g.rows} />
          ))}
          {q.data.resources.length === 0 && <div className="muted small">This release created no objects.</div>}
          {q.data.hooks.length > 0 && <Hooks hooks={q.data.hooks} />}
          {q.data.notes && (
            <Section title="Notes">
              <pre className="log-view mono" style={{ whiteSpace: "pre-wrap", userSelect: "text", margin: 0 }}>
                {q.data.notes}
              </pre>
            </Section>
          )}
        </>
      )}
    </Stack>
  );
}
