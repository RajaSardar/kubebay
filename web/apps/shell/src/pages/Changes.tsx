import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Badge, Button, DataTable, EmptyState, InlineBanner, PageHeader, Row, Select, Stack } from "@kubebay/ui";
import { PageHelp } from "../components/PageHelp";
import { useCluster } from "../lib/useCluster";
import { timelineApi } from "../lib/api";
import {
  changeObjectHref,
  changesQuery,
  describeFields,
  layoutBands,
  type TimelineChange,
} from "../lib/timeline";

const WINDOWS: { label: string; hours: number }[] = [
  { label: "Last hour", hours: 1 },
  { label: "Last 24 hours", hours: 24 },
  { label: "Last 7 days", hours: 24 * 7 },
  { label: "Last 30 days", hours: 24 * 30 },
];

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function what(c: TimelineChange): string {
  if (c.op === "event") return `${c.type ?? "Event"} ${c.reason ?? ""}: ${c.message ?? ""}`.trim();
  const fields = describeFields(c);
  return fields ? `${c.op}: ${fields}` : c.op;
}

/** A row of strips, one per kind: shaded where nothing was recording that kind. */
function CoverageBands({ coverage, from, to }: { coverage: { kind: string; gaps: { from: string; to: string; reason: string }[] }[]; from: string; to: string }) {
  if (coverage.length === 0) return null;
  return (
    <Stack gap={1} style={{ margin: "8px 0" }} aria-label="Recording coverage by kind">
      {coverage.map((c) => {
        const bands = layoutBands(c.gaps, from, to);
        return (
          <Row key={c.kind} align="center" gap={2}>
            <span className="mono small muted" style={{ width: 150, flexShrink: 0 }}>
              {c.kind}
            </span>
            <div
              style={{ position: "relative", flex: 1, height: 14, background: "var(--kb-status-ok-subtle)", borderRadius: "var(--kb-radius-control)", overflow: "hidden" }}
              role="img"
              aria-label={bands.length === 0 ? `${c.kind}: recorded for the whole period` : `${c.kind}: not recorded in ${bands.length} period${bands.length === 1 ? "" : "s"}`}
            >
              {bands.map((b) => (
                <div
                  key={b.from}
                  title={`Not recorded, ${fmtTime(b.from)} to ${fmtTime(b.to)}: ${b.reason}`}
                  data-testid="gap-band"
                  style={{
                    position: "absolute",
                    left: `${b.left}%`,
                    width: `${Math.max(b.width, 0.5)}%`,
                    top: 0,
                    bottom: 0,
                    background: "var(--kb-bg-inset)",
                    borderLeft: "1px solid var(--kb-border-strong)",
                    borderRight: "1px solid var(--kb-border-strong)",
                  }}
                />
              ))}
            </div>
          </Row>
        );
      })}
      <span className="muted small">Shaded bars are periods nothing was recording that kind: the app was closed, no page had it open, or access was refused.</span>
    </Stack>
  );
}

export default function Changes() {
  const { cluster } = useCluster();
  const navigate = useNavigate();
  const [namespace, setNamespace] = useState("");
  const [kind, setKind] = useState("");
  const [manager, setManager] = useState("");
  const [hours, setHours] = useState(24);
  const [cursors, setCursors] = useState<string[]>([]);

  const status = useQuery({ queryKey: ["timeline-status"], queryFn: timelineApi.status, retry: false, refetchInterval: 15_000 });
  const on = status.data?.enabled === true;
  const facets = useQuery({ queryKey: ["timeline-facets", cluster], queryFn: () => timelineApi.facets(cluster), enabled: !!cluster && on, retry: false });

  const window = useMemo(() => {
    const to = new Date();
    return { from: new Date(to.getTime() - hours * 3600_000).toISOString(), to: to.toISOString() };
    // Re-anchored whenever a filter changes or the data refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hours, namespace, kind, manager, cluster, cursors.length]);

  const cursor = cursors[cursors.length - 1] ?? "";
  const page = useQuery({
    queryKey: ["timeline-changes", cluster, namespace, kind, manager, hours, cursor],
    queryFn: () => timelineApi.changes(changesQuery({ cluster, namespace, kind, manager, from: window.from, to: window.to, cursor, limit: 100 })),
    enabled: !!cluster && on,
    retry: false,
    refetchInterval: 10_000,
  });

  const reset = () => setCursors([]);
  const rows = page.data?.changes ?? [];

  return (
    <div className="page">
      <PageHeader help={<PageHelp route="/changes" />} level={2} title="Changes" />

      {status.isError && (
        <InlineBanner flush style={{ margin: "8px 0" }}>
          {String(status.error instanceof Error ? status.error.message : status.error)}
        </InlineBanner>
      )}
      {status.data && !status.data.enabled && (
        <EmptyState
          title={status.data.error ? "The change timeline is unavailable." : "The change timeline is off."}
          hint={status.data.error ?? "Turn it on under Settings, Change timeline, by choosing how many days to keep."}
        />
      )}
      {status.data?.recovered && (
        <InlineBanner flush style={{ margin: "8px 0" }}>
          The previous database could not be read, so it was set aside as {status.data.recovered} and a new one started.
        </InlineBanner>
      )}

      {on && (
        <>
          <div className="toolbar">
            <Select aria-label="Time range" value={hours} onChange={(e) => { setHours(Number(e.target.value)); reset(); }}>
              {WINDOWS.map((w) => (
                <option key={w.hours} value={w.hours}>
                  {w.label}
                </option>
              ))}
            </Select>
            <Select aria-label="Kind" value={kind} onChange={(e) => { setKind(e.target.value); reset(); }}>
              <option value="">All kinds</option>
              {(facets.data?.kinds ?? []).map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </Select>
            <Select aria-label="Namespace" value={namespace} onChange={(e) => { setNamespace(e.target.value); reset(); }}>
              <option value="">All namespaces</option>
              {(facets.data?.namespaces ?? []).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
            <Select aria-label="Field manager" value={manager} onChange={(e) => { setManager(e.target.value); reset(); }}>
              <option value="">All field managers</option>
              {(facets.data?.managers ?? []).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
            <Badge>{rows.length}</Badge>
          </div>

          {(page.data?.dropped ?? 0) > 0 && (
            <InlineBanner flush style={{ margin: "8px 0" }}>
              {page.data?.dropped} changes not recorded: they came faster than they could be written.
            </InlineBanner>
          )}
          {page.isError && (
            <InlineBanner flush style={{ margin: "8px 0" }}>
              {String(page.error instanceof Error ? page.error.message : page.error)}
            </InlineBanner>
          )}

          {page.data && <CoverageBands coverage={page.data.coverage} from={page.data.from} to={page.data.to} />}

          <DataTable
            loading={page.isLoading}
            loadingLabel="Loading changes…"
            rows={rows}
            rowKey={(c) => String(c.id)}
            onRowClick={(c) => {
              const href = changeObjectHref(c);
              if (href) navigate(href);
            }}
            empty={
              <EmptyState
                title="No changes recorded in this period."
                hint="Changes appear while a page that shows the kind is open. Shaded bars above show when nothing was recording."
              />
            }
            columns={[
              { key: "time", header: "Time", width: 160, className: "mono muted small", render: (c) => fmtTime(c.ts) },
              { key: "kind", header: "Kind", width: 150, render: (c) => c.kind },
              { key: "ns", header: "Namespace", width: 150, render: (c) => c.namespace || "–" },
              { key: "name", header: "Name", render: (c) => <span className="mono small">{c.name}</span> },
              { key: "what", header: "What changed", render: (c) => what(c) },
              {
                key: "manager",
                header: "Field manager",
                width: 190,
                render: (c) => (c.fieldManager ? <span className="mono small">{c.fieldManager}</span> : c.afterGap ? <span className="muted small">unknown (during a gap)</span> : "–"),
              },
              {
                key: "notes",
                header: "",
                width: 150,
                render: (c) => (
                  <span className="muted small">
                    {c.afterGap ? "during a gap" : ""}
                    {c.merged && c.merged > 1 ? `${c.afterGap ? ", " : ""}${c.merged} updates merged` : ""}
                  </span>
                ),
              },
            ]}
          />
          <div className="toolbar" style={{ marginTop: 8 }}>
            <Button variant="ghost" disabled={cursors.length === 0} onClick={() => setCursors((c) => c.slice(0, -1))}>
              Newer
            </Button>
            <Button variant="ghost" disabled={!page.data?.nextCursor} onClick={() => page.data?.nextCursor && setCursors((c) => [...c, page.data!.nextCursor!])}>
              Older
            </Button>
          </div>
        </>
      )}
      {!cluster && <EmptyState title="Choose a cluster first." hint="The Changes page shows one cluster at a time." />}
    </div>
  );
}
