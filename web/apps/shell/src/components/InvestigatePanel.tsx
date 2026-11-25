import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, InlineBanner, Modal, Row, Spinner, Stack } from "@kubebay/ui";
import { aiApi, outcomeLabel, type AiStatus, type InvestigationRequest } from "../lib/aiInvestigate";
import { useInvestigation } from "../lib/useInvestigation";

/**
 * Backlog 78: runs the user's own Claude Code on this computer against one
 * problem. The panel only shows text. A fix it suggests is never applied from
 * here: the person opens the object and uses the YAML editor's diff and
 * confirmation like any other change.
 */
function Panel({ request, status, onClose, onOpenObject }: { request: InvestigationRequest; status: AiStatus; onClose: () => void; onOpenObject?: () => void }) {
  const qc = useQueryClient();
  const { phase, run, error, start, stop } = useInvestigation();
  const started = useRef(false);
  const [accepting, setAccepting] = useState(false);
  const [noticeError, setNoticeError] = useState<string | null>(null);

  useEffect(() => {
    if (status.state === "ready" && !started.current) {
      started.current = true;
      void start(request);
    }
  }, [status.state, start, request]);

  const accept = async () => {
    setAccepting(true);
    setNoticeError(null);
    try {
      await aiApi.acceptNotice(status.noticeVersion);
      await qc.invalidateQueries({ queryKey: ["ai-status"] });
    } catch (e) {
      setNoticeError(e instanceof Error ? e.message : String(e));
    } finally {
      setAccepting(false);
    }
  };

  switch (status.state) {
    case "locked":
      return <InlineBanner tone="warn" flush>{status.reason}</InlineBanner>;
    case "off-by-user":
      return <InlineBanner tone="warn" flush>AI investigations are turned off in Settings. Turn them on there to use this.</InlineBanner>;
    case "no-claude":
      return <InlineBanner tone="warn" flush>{status.installHelp}</InlineBanner>;
    case "notice-needed":
      return (
        <Stack gap={3}>
          <div>{status.notice}</div>
          {noticeError && <InlineBanner tone="err" flush>{noticeError}</InlineBanner>}
          <Row gap={2} justify="end">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button disabled={accepting} onClick={() => void accept()}>Accept and investigate</Button>
          </Row>
        </Stack>
      );
  }

  const running = phase === "starting" || phase === "running";
  return (
    <Stack gap={3}>
      <Row align="center" gap={2} wrap>
        {running && <Spinner />}
        {running ? <span>Claude Code is looking (read-only)…</span> : run.outcome && <Badge tone={run.outcome === "done" ? "ok" : "warn"}>{outcomeLabel(run.outcome)}</Badge>}
        <span className="muted small">
          Up to {Math.round(status.limits.seconds / 60)} minutes and {Math.round(status.limits.bytes / 1024)} KiB. {run.bytes > 0 && `${Math.max(1, Math.round(run.bytes / 1024))} KiB so far.`}
        </span>
      </Row>
      {run.tools.length > 0 && <div className="muted small">Read through: {run.tools.join(", ")}</div>}
      {error && <InlineBanner tone="err" flush>{error}</InlineBanner>}
      {run.notices.map((n, i) => (
        <InlineBanner key={i} tone="warn" flush>{n}</InlineBanner>
      ))}
      <pre className="log-view" style={{ whiteSpace: "pre-wrap", minHeight: 120 }}>{run.text}</pre>
      <div className="muted small">
        This answer comes from Claude Code and can be wrong. Nothing was changed in your cluster. To act on a suggestion, open the object and make the change
        yourself in the YAML editor, which shows the diff and asks for confirmation.
      </div>
      <Row gap={2} justify="end">
        {running ? (
          <Button variant="danger" onClick={() => void stop()}>Stop</Button>
        ) : (
          <>
            {onOpenObject && <Button variant="ghost" onClick={onOpenObject}>Open the object to review and apply a change</Button>}
            <Button onClick={onClose}>Close</Button>
          </>
        )}
      </Row>
    </Stack>
  );
}

function Dialog({ request, onClose, onOpenObject }: { request: InvestigationRequest; onClose: () => void; onOpenObject?: () => void }) {
  const status = useQuery({ queryKey: ["ai-status"], queryFn: aiApi.status, staleTime: 0 });
  return (
    <Modal title="Investigate with AI" label="Investigate with AI" size="wide" onClose={onClose}>
      {status.isLoading && <Spinner />}
      {status.error && <InlineBanner tone="err" flush>{status.error instanceof Error ? status.error.message : String(status.error)}</InlineBanner>}
      {status.data && (
        <Panel
          request={request}
          status={status.data}
          onClose={onClose}
          onOpenObject={
            onOpenObject
              ? () => {
                  onClose();
                  onOpenObject();
                }
              : undefined
          }
        />
      )}
    </Modal>
  );
}

/** The "Investigate with AI" action, with its panel. Offered where an Issue or a pod or workload is shown. */
export function InvestigateButton({ request, onOpenObject, size }: { request: InvestigationRequest; onOpenObject?: () => void; size?: "sm" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant="ghost" onClick={() => setOpen(true)}>
        Investigate with AI
      </Button>
      {open && <Dialog request={request} onClose={() => setOpen(false)} onOpenObject={onOpenObject} />}
    </>
  );
}
