import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Badge, CellLink, DataTable, InlineBanner, SkeletonLines, Stack, StatusPill } from "@kubebay/ui";
import { helmApi, type HelmRelease, type ReleaseHook, type ReleaseResource } from "../lib/api";
import { groupResources, resourceHref, stuckFor } from "../lib/helmDetails";
import { joinReleaseResources, liveSummary, podsNeededIn, releaseStreams, resourceKey, streamPicker, type LiveStatus, type LiveStreamSpec } from "../lib/helmLive";
import { useResourceStream, type StreamState } from "../lib/useResourceStream";
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

/** One stream an object's status is read from; it renders nothing. */
function StreamTap({ cluster, spec, onState }: { cluster: string; spec: LiveStreamSpec; onState: (key: string, s: StreamState) => void }) {
  const state = useResourceStream(cluster, spec.gvr, { mode: spec.mode, ns: spec.ns });
  useEffect(() => onState(spec.key, state), [spec.key, state, onState]);
  return null;
}

/**
 * ADR 0004 S9: each object the release created, joined against streams in
 * the release's namespaces, open while the Overview is. Pods join only once
 * a workload isn't ready, to say why.
 */
function useReleaseLive(cluster: string, resources: ReleaseResource[]) {
  const [states, setStates] = useState<Record<string, StreamState>>({});
  const onState = useCallback((key: string, s: StreamState) => setStates((prev) => (prev[key] === s ? prev : { ...prev, [key]: s })), []);
  const [podsIn, setPodsIn] = useState("");
  const specs = useMemo(() => releaseStreams(resources, podsIn ? podsIn.split(" ") : []), [resources, podsIn]);
  const statuses = joinReleaseResources(resources, streamPicker(specs, states));
  const needed = podsNeededIn(resources, statuses).join(" ");
  useEffect(() => setPodsIn(needed), [needed]);
  const taps = specs.map((s) => <StreamTap key={s.key} cluster={cluster} spec={s} onState={onState} />);
  return { statuses, taps };
}

const PILL: Partial<Record<LiveStatus["state"], { tone: "ok" | "pending" | "err"; label: string }>> = {
  ready: { tone: "ok", label: "ready" },
  progressing: { tone: "pending", label: "progressing" },
  "not-ready": { tone: "err", label: "not ready" },
  missing: { tone: "err", label: "missing" },
};

const MUTED: Partial<Record<LiveStatus["state"], string>> = { present: "present", checking: "checking…", "cant-check": "can't check" };

function LiveCell({ status }: { status?: LiveStatus }) {
  if (!status) return null;
  const pill = PILL[status.state];
  if (!pill) {
    return (
      <span className="muted" title={status.state === "cant-check" ? status.why : undefined}>
        {MUTED[status.state]}
      </span>
    );
  }
  return (
    <>
      <StatusPill tone={pill.tone}>{pill.label}</StatusPill> {status.why && <span className="muted">{status.why}</span>}
    </>
  );
}

function ResourceGroup({ group, rows, statuses }: { group: string; rows: ReleaseResource[]; statuses: Map<string, LiveStatus> }) {
  return (
    <Section title={group}>
      <DataTable
        rows={rows}
        rowKey={resourceKey}
        columns={[
          { key: "kind", header: "Kind", className: "small", width: "20%", render: (r) => r.kind },
          {
            key: "name",
            header: "Name",
            className: "mono small",
            width: "28%",
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
          { key: "ns", header: "Namespace", className: "mono small muted", width: "14%", render: (r) => r.namespace || "–" },
          {
            key: "status",
            header: "Status",
            className: "small",
            width: "38%",
            title: (r) => statuses.get(resourceKey(r))?.why,
            render: (r) => <LiveCell status={statuses.get(resourceKey(r))} />,
          },
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
  const resources = useMemo(() => q.data?.resources ?? [], [q.data]);
  const live = useReleaseLive(cluster, resources);

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
        {live.statuses.size > 0 && <Fact label="Objects">{liveSummary([...live.statuses.values()])}</Fact>}
      </Section>
      {live.taps}

      {q.data && (
        <>
          {groupResources(q.data.resources).map((g) => (
            <ResourceGroup key={g.group} group={g.group} rows={g.rows} statuses={live.statuses} />
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
