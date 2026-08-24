import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, StatusDot } from "@kubebay/ui";
import { api } from "../lib/api";
import { usePodLogs, type PodLogsSpec } from "../lib/usePodLogs";
import { ExecTerm } from "../components/ExecTerm";
import { YamlTab } from "../components/YamlTab";
import { PodSummary } from "../components/PodSummary";
import { PodGraphs } from "../components/PodGraphs";

export interface SelectedPod {
  cluster: string;
  namespace: string;
  pod: string;
  containers: string[];
  obj?: Record<string, unknown>;
}

const TAILS = [200, 2000, 10000];

function classify(line: string): "" | "err" | "warn" {
  if (/\b(FATAL|ERROR|Error|E\d{4})\b/.test(line)) return "err";
  if (/\b(WARN|Warning|W\d{4})\b/.test(line)) return "warn";
  return "";
}

export default function PodPanel({ pod, onClose, onDeleted }: { pod: SelectedPod; onClose: () => void; onDeleted?: () => void }) {
  const [tab, setTabState] = useState<"summary" | "logs" | "shell" | "graphs" | "size" | "yaml">(() => {
    const saved = localStorage.getItem("kb.drawerTab");
    return saved === "shell" || saved === "yaml" || saved === "graphs" || saved === "size" || saved === "summary" ? saved : "summary";
  });
  const setTab = (t: "summary" | "logs" | "shell" | "graphs" | "size" | "yaml") => {
    localStorage.setItem("kb.drawerTab", t);
    setTabState(t);
  };
  const [container, setContainer] = useState<string | undefined>(pod.containers[0]);
  const [tail, setTail] = useState(2000);
  const [follow, setFollow] = useState(true);
  const [previous, setPrevious] = useState(false);
  const [filter, setFilter] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteInput, setDeleteInput] = useState("");
  const [deleteErr, setDeleteErr] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [force, setForce] = useState(false);
  const [shell, setShell] = useState<"auto" | "bash" | "sh" | "ash" | "powershell">("auto");

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

  async function doDelete() {
    if (deleteInput !== pod.pod) {
      setDeleteErr("Name does not match.");
      return;
    }
    setDeleting(true);
    setDeleteErr("");
    try {
      await api.deleteResource({
        cluster: pod.cluster,
        gvr: "v1/pods",
        ns: pod.namespace,
        name: pod.pod,
        graceSeconds: force ? 0 : undefined,
        forceFinalizers: force,
      });
      onDeleted?.();
      onClose();
    } catch (e) {
      setDeleteErr(String(e instanceof Error ? e.message : e));
    } finally {
      setDeleting(false);
    }
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
          {!confirmingDelete ? (
            <>
              <Button variant="ghost" className="kb-btn-danger-ghost" onClick={() => setConfirmingDelete(true)}>
                Delete
              </Button>
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
            </>
          ) : (
            <>
              <input
                className="toolbar-input"
                style={{ maxWidth: 180 }}
                placeholder={`type "${pod.pod}"`}
                value={deleteInput}
                onChange={(e) => setDeleteInput(e.target.value)}
                spellCheck={false}
              />
              <label className="ctl" style={{ cursor: "pointer" }}>
                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                force
              </label>
              <Button variant="danger" disabled={deleting} onClick={() => void doDelete()}>
                Confirm
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setConfirmingDelete(false);
                  setDeleteInput("");
                  setDeleteErr("");
                }}
              >
                Cancel
              </Button>
            </>
          )}
        </div>
      </div>
      {deleteErr && (
        <div className="error-banner" style={{ margin: "10px 14px 0" }}>
          {deleteErr}
        </div>
      )}

      <div className="tabs">
        {(["summary", "logs", "shell", "graphs", "size", "yaml"] as const).map((t) => (
          <button key={t} className={`tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
            {t === "summary" ? "Summary" : t === "logs" ? "Logs" : t === "shell" ? "Terminal" : t === "graphs" ? "Graphs" : t === "size" ? "Size" : "YAML"}
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
        {tab === "shell" && (
          <select
            className="toolbar-select drawer-select"
            value={shell}
            onChange={(e) => setShell(e.target.value as typeof shell)}
            aria-label="shell"
          >
            <option value="auto">auto</option>
            <option value="bash">bash</option>
            <option value="sh">sh</option>
            <option value="ash">ash</option>
          </select>
        )}
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
      ) : tab === "graphs" ? (
        <div style={{ overflow: "auto" }}>
          <PodGraphs cluster={pod.cluster} namespace={pod.namespace} pod={pod.pod} />
        </div>
      ) : tab === "summary" ? (
        <PodSummary obj={pod.obj ?? {}} />
      ) : tab === "size" ? (
        <ResizePanel
          cluster={pod.cluster}
          namespace={pod.namespace}
          pod={pod.pod}
          containers={pod.containers}
        />
      ) : tab === "shell" ? (
        <div className="term-wrap">
          <ExecTerm
            cluster={pod.cluster}
            namespace={pod.namespace}
            pod={pod.pod}
            container={container}
            shell={shell}
          />
        </div>
      ) : (
        <div className="yaml-wrap">
          <YamlTab
            cluster={pod.cluster}
            gvr="v1/pods"
            ns={pod.namespace}
            name={pod.pod}
          />
        </div>
      )}
    </aside>
  );
}
