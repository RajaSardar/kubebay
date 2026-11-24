import { ObjectStarButton } from "../components/Favorites";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, InlineBanner, Modal, Row, Stack, Select, Spinner, StatusDot, Tabs, TextField, Drawer } from "@kubebay/ui";
import { api } from "../lib/api";
import { usePodLogs, type PodLogsSpec } from "../lib/usePodLogs";
import { filterLogLines } from "../lib/logFilter";
import { ansiSegments, logLevel, type LogLevel, type LogTone } from "../lib/logLevels";
import { ExecTerm, YamlTab } from "../components/heavy";
import { useDiscardGuard } from "../components/DiscardGuard";
import { forceDeleteEffect, forceDeleteLabel } from "../lib/podDelete";
import { defaultContainer } from "../lib/pods";
import { PodSummary } from "../components/PodSummary";
import { PodGraphs } from "../components/PodGraphs";
import { DebugContainerModal } from "../components/DebugContainerModal";
import { ResizePanel } from "../components/ResizePanel";
import { PodVulnerabilitiesTab } from "../components/PodVulnerabilitiesTab";
import { ImageSignatureCheck } from "../components/ImageSignatureCheck";
import { TriageTab } from "../components/TriageTab";
import { useTriageAllowed } from "../lib/useTriageAllowed";
import { EventsDrawer } from "../components/EventsDrawer";

export interface SelectedPod {
  cluster: string;
  namespace: string;
  pod: string;
  containers: string[];
  obj?: Record<string, unknown>;
  /** Open on this tab (the row menu's Logs, Shell or Edit YAML) instead of the last one used. */
  tab?: "logs" | "shell" | "yaml" | "events";
}

const TAILS = [200, 2000, 10000];

// Backlog #22: a log line's class from its level (lib/logLevels).
const LEVEL_CLASS: Record<LogLevel, string> = { error: "err", warn: "warn", success: "ok", info: "info", debug: "debug", "": "" };
const ANSI_CLASS: Record<LogTone, string> = {
  err: "log-ansi-err",
  warn: "log-ansi-warn",
  ok: "log-ansi-ok",
  info: "log-ansi-info",
  muted: "log-ansi-muted",
};

/** A log line, coloured by its level, with an app's own ANSI colours as theme tones. */
function LogLine({ line }: { line: string }) {
  const level = LEVEL_CLASS[logLevel(line)];
  const segments = ansiSegments(line);
  return (
    <div className={level ? `log-line ${level}` : "log-line"}>
      {segments
        ? segments.map((seg, i) =>
            seg.tone || seg.bold ? (
              <span key={i} className={[seg.tone && ANSI_CLASS[seg.tone], seg.bold && "log-ansi-bold"].filter(Boolean).join(" ")}>
                {seg.text}
              </span>
            ) : (
              seg.text
            ),
          )
        : line}
    </div>
  );
}

const POD_TABS = ["summary", "logs", "triage", "shell", "graphs", "size", "vulnerabilities", "signatures", "events", "yaml"] as const;
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
  events: "Events",
  yaml: "YAML",
};

export default function PodPanel({ pod, onClose: onCloseNow, onDeleted }: { pod: SelectedPod; onClose: () => void; onDeleted?: () => void }) {
  const [tab, setTabState] = useState<PodTab>(
    // Always open on Summary unless an explicit tab was requested (e.g. "Edit YAML" from the row menu).
    pod.tab ?? "summary",
  );
  // Closing or changing tab drops an open YAML editor: ask first if it holds unapplied edits.
  const { guard, modal: discardModal } = useDiscardGuard();
  const onClose = guard(onCloseNow);
  const setTab = (t: PodTab) => {
    if (t !== tab) guard(setTabState)(t);
  };
  // Triage shows only where the user turned it on for this cluster (backlog #13).
  const triageAllowed = useTriageAllowed(pod.cluster);
  const tabs = triageAllowed ? POD_TABS : POD_TABS.filter((t) => t !== "triage");
  const [container, setContainer] = useState<string | undefined>(defaultContainer(pod.obj, pod.containers));
  // Debug containers added from the Terminal tab; the pod object only lists them once it refreshes.
  const [debugContainers, setDebugContainers] = useState<string[]>([]);
  const [debugOpen, setDebugOpen] = useState(false);
  const [tail, setTail] = useState(2000);
  const [follow, setFollow] = useState(true);
  const [previous, setPrevious] = useState(false);
  const [filter, setFilter] = useState("");
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
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

  // Filter on the text you see, not on an app's escape codes.
  const { shown, hidden } = useMemo(() => filterLogLines(lines, { text: filter, problemsOnly }), [lines, filter, problemsOnly]);

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
      onCloseNow();
    } catch (e) {
      setDeleteErr(String(e instanceof Error ? e.message : e));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Drawer
      title={pod.pod}
      copyName={pod.pod}
      nameExtra={<ObjectStarButton obj={{ cluster: pod.cluster, slug: "pods", ns: pod.namespace, name: pod.pod, kind: "Pod" }} />}
      subtitle={pod.namespace}
      leading={<StatusDot status="connected" pulse={status === "streaming"} />}
      onClose={onClose}
      actions={
        <>
          {status === "closed" && <Badge tone="err">ended</Badge>}
          {error && <span className="error-text small">{error}</span>}
          <Button variant="danger-ghost" onClick={() => setConfirmingDelete(true)}>
            Delete
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      {discardModal}
      {debugOpen && (
        <DebugContainerModal
          cluster={pod.cluster}
          namespace={pod.namespace}
          pod={pod.pod}
          containers={pod.containers}
          onClose={() => setDebugOpen(false)}
          onCreated={(name) => {
            setDebugContainers((cs) => (cs.includes(name) ? cs : [...cs, name]));
            setContainer(name);
            setDebugOpen(false);
          }}
        />
      )}
      {confirmingDelete && (
        <Modal
          label={`Delete ${pod.pod}?`}
          title={`Delete ${pod.pod}?`}
          onClose={() => {
            setConfirmingDelete(false);
            setDeleteErr("");
          }}
          placement="center"
        >
          <Stack gap={3}>
            <span className="muted small">
              A pod is recreated by its controller, if it has one. A pod without one is gone for good.
            </span>
            {forceLabel && (
              <label className="ctl" style={{ cursor: "pointer" }}>
                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                {forceLabel}
              </label>
            )}
            {deleteErr && <InlineBanner flush>{deleteErr}</InlineBanner>}
            <Row justify="end" gap={2}>
              <Button
                variant="ghost"
                disabled={deleting}
                onClick={() => {
                  setConfirmingDelete(false);
                  setDeleteErr("");
                }}
              >
                Cancel
              </Button>
              <Button variant="danger" disabled={deleting} onClick={() => void doDelete()}>
                {deleting ? "Deleting…" : "Delete"}
              </Button>
            </Row>
          </Stack>
        </Modal>
      )}
      {!confirmingDelete && deleteErr && (
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
              {[...pod.containers, ...debugContainers].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            {tab === "shell" && (
              <Button variant="ghost" onClick={() => setDebugOpen(true)}>
                Debug with ephemeral container
              </Button>
            )}
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
            <label className="ctl">
              <input type="checkbox" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} />
              warnings and errors only
            </label>
            <TextField
              placeholder="Filter lines…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              spellCheck={false}
            />
            <Badge>{shown.length}</Badge>
            {problemsOnly && hidden > 0 && <span className="muted small">{hidden} {hidden === 1 ? "line" : "lines"} hidden</span>}
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
              <LogLine key={i} line={l} />
            ))}
          </div>
        </>
      ) : tab === "graphs" ? (
        <div style={{ overflow: "auto" }}>
          <PodGraphs cluster={pod.cluster} namespace={pod.namespace} pod={pod.pod} />
        </div>
      ) : tab === "summary" ? (
        <PodSummary
          obj={pod.obj ?? {}}
          cluster={pod.cluster}
          onOpenTab={(t, o) => {
            if (t === "logs") {
              if (o?.container) setContainer(o.container);
              setPrevious(o?.previous === true);
              if (o?.previous) setFollow(false);
            }
            setTab(t);
          }}
        />
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
      ) : tab === "events" ? (
        <div style={{ padding: "12px 16px", overflow: "auto" }}>
          <EventsDrawer cluster={pod.cluster} namespace={pod.namespace} name={pod.pod} kind="Pod" />
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
