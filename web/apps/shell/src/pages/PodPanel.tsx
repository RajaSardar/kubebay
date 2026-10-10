import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, InlineBanner, Row, Select, Spinner, StatusDot, Tabs, TextField, Drawer } from "@kubebay/ui";
import { api } from "../lib/api";
import { usePodLogs, type PodLogsSpec } from "../lib/usePodLogs";
import { ExecTerm, YamlTab } from "../components/heavy";
import { forceDeleteEffect, forceDeleteLabel } from "../lib/podDelete";
import { PodSummary } from "../components/PodSummary";
import { PodGraphs } from "../components/PodGraphs";
import { ResizePanel } from "../components/ResizePanel";
import { PodVulnerabilitiesTab } from "../components/PodVulnerabilitiesTab";
import { ImageSignatureCheck } from "../components/ImageSignatureCheck";
import { TriageTab } from "../components/TriageTab";
import { useTriageAllowed } from "../lib/useTriageAllowed";

export interface SelectedPod {
  cluster: string;
  namespace: string;
  pod: string;
  containers: string[];
  obj?: Record<string, unknown>;
  /** Open on this tab (the row menu's Logs, Shell or Edit YAML) instead of the last one used. */
  tab?: "logs" | "shell" | "yaml";
}

const TAILS = [200, 2000, 10000];

function classify(line: string): "" | "err" | "warn" {
  if (/\b(FATAL|ERROR|Error|E\d{4})\b/.test(line)) return "err";
  if (/\b(WARN|Warning|W\d{4})\b/.test(line)) return "warn";
  return "";
}

const POD_TABS = ["summary", "logs", "triage", "shell", "graphs", "size", "vulnerabilities", "signatures", "yaml"] as const;
type PodTab = (typeof POD_TABS)[number];
const POD_TAB_LABELS = {
  summary: "Summary",
  logs: "Logs",
  triage: "Triage",
  shell: "Terminal",
  graphs: "Graphs",
  size: "Size",
  vulnerabilities: "Vulnerabilities",
  signatures: "Signatures",
  yaml: "YAML",
};

export default function PodPanel({ pod, onClose, onDeleted }: { pod: SelectedPod; onClose: () => void; onDeleted?: () => void }) {
  const [tab, setTabState] = useState<PodTab>(() => {
    if (pod.tab) return pod.tab;
    const saved = localStorage.getItem("kb.drawerTab");
    return saved === "shell" || saved === "yaml" || saved === "graphs" || saved === "size" || saved === "vulnerabilities" || saved === "signatures" || saved === "summary"
      ? saved
      : "summary";
  });
  const setTab = (t: PodTab) => {
    localStorage.setItem("kb.drawerTab", t);
    setTabState(t);
  };
  // Triage shows only where the user turned it on for this cluster (backlog #13).
  const triageAllowed = useTriageAllowed(pod.cluster);
  const tabs = triageAllowed ? POD_TABS : POD_TABS.filter((t) => t !== "triage");
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

  const forceEffect = forceDeleteEffect(pod.obj);
  const forceLabel = forceDeleteLabel(forceEffect);

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
        graceSeconds: force && forceEffect.skipsGrace ? 0 : undefined,
        forceFinalizers: force && forceEffect.removesFinalizers,
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
    <Drawer
      title={pod.pod}
      subtitle={pod.namespace}
      leading={<StatusDot status="connected" pulse={status === "streaming"} />}
      onClose={onClose}
      actions={
        <>
          {status === "closed" && <Badge tone="err">ended</Badge>}
          {error && <span className="error-text small">{error}</span>}
          {!confirmingDelete ? (
            <>
              <Button variant="danger-ghost" onClick={() => setConfirmingDelete(true)}>
                Delete
              </Button>
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
            </>
          ) : (
            <>
              <TextField
                style={{ maxWidth: 180 }}
                placeholder={`type "${pod.pod}"`}
                value={deleteInput}
                onChange={(e) => setDeleteInput(e.target.value)}
                spellCheck={false}
              />
              {forceLabel && (
                <label className="ctl" style={{ cursor: "pointer" }}>
                  <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                  {forceLabel}
                </label>
              )}
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
        </>
      }
    >
      {deleteErr && (
        <InlineBanner flush style={{ margin: "10px 14px 0" }}>
          {deleteErr}
        </InlineBanner>
      )}

      <Tabs
        tabs={tabs}
        active={tab}
        labels={POD_TAB_LABELS}
        onChange={setTab}
        trailing={
          <>
            <Select
              className="drawer-select"
              aria-label="Container"
              value={container ?? ""}
              onChange={(e) => setContainer(e.target.value || undefined)}
            >
              {pod.containers.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            {tab === "shell" && (
              <Select
                className="drawer-select"
                value={shell}
                onChange={(e) => setShell(e.target.value as typeof shell)}
                aria-label="shell"
              >
                <option value="auto">auto</option>
                <option value="bash">bash</option>
                <option value="sh">sh</option>
                <option value="ash">ash</option>
              </Select>
            )}
          </>
        }
      />

      {tab === "logs" ? (
        <>
          <div className="log-controls">
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
            <TextField
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
                {status === "streaming" ? (
                  <Row gap={2} align="center">
                    <Spinner label={null} size={14} />
                    <span>Waiting for output…</span>
                  </Row>
                ) : (
                  "No output."
                )}
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
        <PodSummary obj={pod.obj ?? {}} cluster={pod.cluster} />
      ) : tab === "size" ? (
        <ResizePanel
          cluster={pod.cluster}
          namespace={pod.namespace}
          pod={pod.pod}
          containers={pod.containers}
          podObj={pod.obj}
        />
      ) : tab === "vulnerabilities" ? (
        <PodVulnerabilitiesTab
          cluster={pod.cluster}
          ns={pod.namespace}
          podName={pod.pod}
          containers={pod.containers}
          podObj={pod.obj}
        />
      ) : tab === "triage" && triageAllowed ? (
        <TriageTab cluster={pod.cluster} namespace={pod.namespace} pod={pod.pod} />
      ) : tab === "signatures" ? (
        <div style={{ padding: 14 }}>
          <ImageSignatureCheck cluster={pod.cluster} scope={{ ns: pod.namespace, pod: pod.pod }} />
        </div>
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
    </Drawer>
  );
}
