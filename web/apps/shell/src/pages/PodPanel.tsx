import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, StatusDot } from "@kubebay/ui";
import { usePodLogs, type PodLogsSpec } from "../lib/usePodLogs";
import { ExecTerm } from "../components/ExecTerm";

export interface SelectedPod {
  cluster: string;
  namespace: string;
  pod: string;
  containers: string[];
}

const TAILS = [200, 2000, 10000];

function classify(line: string): "" | "err" | "warn" {
  if (/\b(FATAL|ERROR|Error|E\d{4})\b/.test(line)) return "err";
  if (/\b(WARN|Warning|W\d{4})\b/.test(line)) return "warn";
  return "";
}

export default function PodPanel({ pod, onClose }: { pod: SelectedPod; onClose: () => void }) {
  const [tab, setTab] = useState<"logs" | "shell">("logs");
  const [container, setContainer] = useState<string | undefined>(pod.containers[0]);
  const [tail, setTail] = useState(2000);
  const [follow, setFollow] = useState(true);
  const [previous, setPrevious] = useState(false);
  const [filter, setFilter] = useState("");

  const spec: PodLogsSpec = useMemo(
    () => ({
      cluster: pod.cluster,
      namespace: pod.namespace,
      pod: pod.pod,
      container,
      tail,
      follow,
      previous,
    }),
    [pod.cluster, pod.namespace, pod.pod, container, tail, follow, previous],
  );

  const { lines, status, error } = usePodLogs(tab === "logs" ? spec : null);
  const viewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (follow && tab === "logs" && viewRef.current) {
      viewRef.current.scrollTop = viewRef.current.scrollHeight;
    }
  }, [lines, follow, tab]);

  const shown = filter ? lines.filter((l) => l.includes(filter)) : lines;

  function download() {
    const blob = new Blob([lines.join("\n") + "\n"], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${pod.pod}${container ? "." + container : ""}.log`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <aside className="drawer">
      <div className="drawer-head">
        <StatusDot status="connected" pulse={status === "streaming"} />
        <div style={{ minWidth: 0 }}>
          <div className="mono strong">{pod.pod}</div>
          <div className="muted small mono">{pod.namespace}</div>
        </div>
        <div className="drawer-head-actions">
          {status === "closed" && <Badge tone="err">ended</Badge>}
          {error && <span className="error-text small">{error}</span>}
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>

      <div className="tabs">
        {(["logs", "shell"] as const).map((t) => (
          <button key={t} className={`tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
            {t === "logs" ? "Logs" : "Terminal"}
          </button>
        ))}
        <select
          className="toolbar-select drawer-select"
          value={container ?? ""}
          onChange={(e) => setContainer(e.target.value || undefined)}
        >
          {pod.containers.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {tab === "logs" ? (
        <>
          <div className="log-controls">
            <label className="ctl">
              tail
              <select className="toolbar-select" value={tail} onChange={(e) => setTail(Number(e.target.value))}>
                {TAILS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="ctl">
              <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
              follow
            </label>
            <label className="ctl">
              <input type="checkbox" checked={previous} onChange={(e) => setPrevious(e.target.checked)} />
              previous
            </label>
            <input
              className="toolbar-input"
              placeholder="Filter lines…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              spellCheck={false}
            />
            <Badge>{shown.length}</Badge>
            <Button variant="ghost" onClick={download}>
              Download
            </Button>
          </div>
          <div className="log-view" ref={viewRef}>
            {shown.length === 0 && status !== "idle" && (
              <div className="muted small" style={{ padding: 8 }}>
                {status === "streaming" ? "Waiting for output…" : "No output."}
              </div>
            )}
            {shown.map((l, i) => (
              <div key={i} className={`log-line ${classify(l)}`}>
                {l}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="term-wrap">
          <ExecTerm
            cluster={pod.cluster}
            namespace={pod.namespace}
            pod={pod.pod}
            container={container}
          />
        </div>
      )}
    </aside>
  );
}
