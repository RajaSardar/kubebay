import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, NsPill, Row, Select, Spinner, TextField } from "@kubebay/ui";
import { useResourceStream } from "../lib/useResourceStream";
import { filterLogItems } from "../lib/logFilter";
import { splitPodName } from "../lib/podName";
import { useMergedPodLogs } from "../lib/useMergedPodLogs";
import { workloadLabelSelector, workloadPods } from "../lib/workloadPods";
import { logPodMatches, pickLogPods } from "../lib/workloadLogs";
import { LogLine } from "./LogLine";
import { PodName } from "./PodName";

const TAILS = [100, 500, 2000];

/** A short, readable tag for a pod's lines: its generated end, or the whole name when it has none. */
function tag(name: string): string {
  const { suffix } = splitPodName(name);
  // An ordinal alone ("1") says little; the whole name is short anyway.
  return suffix && !/^-\d+$/.test(suffix) ? suffix.slice(1) : name;
}

/**
 * Backlog 59: the logs of all of a workload's pods in one view. Each line
 * carries a tinted tag for its pod. The pod filter narrows which pods are
 * followed ("name" or =name for one exact pod); at most MAX_LOG_PODS are, and
 * the view says so when the workload has more.
 */
export function WorkloadLogs({ cluster, obj: given, kind }: { cluster: string; obj: Record<string, unknown>; kind?: string }) {
  const obj = useMemo(() => (kind ? { ...given, kind } : given), [given, kind]);
  const meta = (obj.metadata ?? {}) as { namespace?: string };
  const namespace = meta.namespace ?? "";
  const ns = namespace ? [namespace] : undefined;
  const labelSelector = workloadLabelSelector(obj) || undefined;
  const isDeployment = obj.kind === "Deployment";
  const pods = useResourceStream(cluster || undefined, "v1/pods", { mode: "full", ns, labelSelector });
  const sets = useResourceStream(cluster || undefined, "apps/v1/replicasets", { mode: "full", ns, labelSelector, enabled: isDeployment });
  const all = useMemo(() => workloadPods(obj, pods.rows, isDeployment ? sets.rows : []), [obj, pods.rows, sets.rows, isDeployment]);

  const [podFilter, setPodFilter] = useState("");
  const [tail, setTail] = useState(500);
  const [follow, setFollow] = useState(true);
  const [previous, setPrevious] = useState(false);
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [text, setText] = useState("");

  const { pods: picked, total } = useMemo(() => pickLogPods(all.filter((p) => logPodMatches(p.name, podFilter))), [all, podFilter]);
  // The pods named by key, so a pod list that re-streams unchanged does not reopen every channel.
  const podKey = picked.map((p) => p.name).join(",");
  const spec = useMemo(
    () =>
      picked.length
        ? { cluster, namespace, pods: picked.map((p) => ({ pod: p.name, container: p.containers[0] })), tail, follow, previous }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cluster, namespace, podKey, tail, follow, previous],
  );
  const { lines, errors } = useMergedPodLogs(spec);

  const { shown, hidden } = useMemo(() => filterLogItems(lines, (l) => l.text, { text, problemsOnly }), [lines, text, problemsOnly]);

  const viewRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (follow && viewRef.current) viewRef.current.scrollTop = viewRef.current.scrollHeight;
  }, [shown, follow]);

  const matching = all.filter((p) => logPodMatches(p.name, podFilter)).length;
  const errorNotes = Object.entries(errors);

  return (
    <div className="workload-logs">
      <div className="log-controls">
        <TextField placeholder='Filter pods… ("name" or =name for one exact pod)' value={podFilter} onChange={(e) => setPodFilter(e.target.value)} spellCheck={false} />
        <label className="ctl">
          tail
          <Select value={tail} onChange={(e) => setTail(Number(e.target.value))}>
            {TAILS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </label>
        <label className="ctl">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          follow
        </label>
        <label className="ctl">
          <input type="checkbox" checked={previous} onChange={(e) => setPrevious(e.target.checked)} />
          previous
        </label>
        <label className="ctl">
          <input type="checkbox" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} />
          warnings and errors only
        </label>
        <TextField placeholder="Filter lines…" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        <Badge>{shown.length}</Badge>
        {problemsOnly && hidden > 0 && <span className="muted small">{hidden} {hidden === 1 ? "line" : "lines"} hidden</span>}
      </div>
      <div className="muted small" style={{ padding: "6px 14px" }}>
        {picked.length < all.length ? (
          <span>{`Showing ${picked.length} of ${all.length} pods`}</span>
        ) : (
          <span>{`${picked.length} ${picked.length === 1 ? "pod" : "pods"}`}</span>
        )}
        {matching > picked.length && " (the first ones; narrow the pod filter to see others)"}
        {total === 0 && " – no pods match"}
      </div>
      {picked.length > 0 && (
        <Row gap={2} wrap style={{ padding: "0 14px 6px" }}>
          {picked.map((p) => (
            <Button key={p.name} variant="ghost" title={`Only ${p.name}`} onClick={() => setPodFilter(`=${p.name}`)}>
              <PodName name={p.name} />
            </Button>
          ))}
        </Row>
      )}
      {errorNotes.map(([pod, msg]) => (
        <div key={pod} className="error-text small" style={{ padding: "0 14px" }}>{`${pod}: ${msg}`}</div>
      ))}
      <div className="log-view" ref={viewRef}>
        {shown.length === 0 && (
          <div className="muted small" style={{ padding: 8 }}>
            {spec ? (
              <Row gap={2} align="center">
                <Spinner label={null} size={14} />
                <span>Waiting for output…</span>
              </Row>
            ) : (
              "No pods to follow."
            )}
          </div>
        )}
        {shown.map((l) => (
          <LogLine
            key={l.id}
            line={l.text}
            prefix={
              <span className="log-pod" title={l.pod}>
                <NsPill>{tag(l.pod)}</NsPill>{" "}
              </span>
            }
          />
        ))}
      </div>
    </div>
  );
}
