import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, InlineBanner, Modal, Row, Stack } from "@kubebay/ui";
import { mcpApi, type McpProposal } from "../lib/api";

function lineStyle(line: string) {
  if (line.startsWith("+")) return { background: "var(--kb-status-ok-subtle)", color: "var(--kb-status-ok-fg)" };
  if (line.startsWith("-")) return { background: "var(--kb-status-err-subtle)", color: "var(--kb-status-err-fg)" };
  if (line === "…") return { color: "var(--kb-fg-muted)" };
  return undefined;
}

/**
 * Backlog #5 phase 2: when an assistant proposes a change, ask the person
 * at the keyboard. Nothing applies until they approve, and an approval
 * applies exactly the diff shown, only to the version it was computed on.
 */
export function McpProposals() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["mcp"], queryFn: mcpApi.get, refetchInterval: 15_000, retry: false });
  const on = !!status.data?.enabled && !!status.data?.writesEnabled;
  const list = useQuery({ queryKey: ["mcp-proposals"], queryFn: mcpApi.proposals, enabled: on, refetchInterval: 3_000, retry: false });
  const [later, setLater] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const next: McpProposal | undefined = on ? (list.data?.pending ?? []).find((p) => p.status === "pending" && !later.has(p.id)) : undefined;

  useEffect(() => {
    if (!next) return;
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [next]);

  if (!next) return null;

  const decide = async (call: (id: string) => Promise<McpProposal>) => {
    setBusy(true);
    setError(null);
    try {
      await call(next.id);
      await qc.invalidateQueries({ queryKey: ["mcp-proposals"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await qc.invalidateQueries({ queryKey: ["mcp-proposals"] });
    } finally {
      setBusy(false);
    }
  };
  const decideLater = () => setLater((s) => new Set(s).add(next.id));
  const secs = Math.max(0, Math.round((new Date(next.expires).getTime() - now) / 1000));
  const lines = next.diff.replace(/\n$/, "").split("\n");

  return (
    <Modal label="Proposed change" title={`${next.client || "An assistant"} proposes a change`} placement="center" size="wide" onClose={decideLater}>
      <Stack gap={3}>
        <Row gap={2} align="center" wrap>
          <span className="mono strong">
            {next.kind} {next.namespace}/{next.name}
          </span>
          <span className="muted small">in</span>
          <span className="mono">{next.cluster}</span>
          <Badge tone="warn">{`expires in ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`}</Badge>
        </Row>
        {next.reason && (
          <div className="small">
            <span className="muted">Why, in the assistant&apos;s words: </span>
            {next.reason}
          </div>
        )}
        <div className="muted small">
          Changes <span className="mono">{next.changedPaths.join(", ")}</span>. Nothing has been applied. Approving applies
          exactly this diff, and only if the object hasn&apos;t changed since it was computed.
        </div>
        <pre
          className="mono"
          aria-label="Diff"
          style={{
            fontSize: "var(--kb-text-xs)",
            background: "var(--kb-bg-inset)",
            borderRadius: "var(--kb-radius-xs)",
            padding: 8,
            margin: 0,
            maxHeight: 320,
            overflow: "auto",
            whiteSpace: "pre",
          }}
        >
          {lines.map((l, i) => (
            <div key={i} style={lineStyle(l)}>
              {l}
            </div>
          ))}
        </pre>
        {error && <InlineBanner flush>{error}</InlineBanner>}
        <Row gap={2} align="center" wrap>
          <Button disabled={busy} onClick={() => void decide(mcpApi.approve)}>
            Approve and apply
          </Button>
          <Button variant="danger-ghost" disabled={busy} onClick={() => void decide(mcpApi.reject)}>
            Reject
          </Button>
          <Button variant="ghost" disabled={busy} onClick={decideLater}>
            Decide later
          </Button>
        </Row>
      </Stack>
    </Modal>
  );
}
