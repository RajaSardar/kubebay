import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArmedButton, Badge, Button, Card, DataTable, EmptyState, InlineBanner, Row, Stack, TextField } from "@kubebay/ui";
import { api, mcpApi, type McpStatus } from "../lib/api";
import { claudeCodeCommand, claudeDesktopConfig, recentMcpCalls, scopeFromDraft, type ScopeDraft } from "../lib/mcpConfig";
import { CopyableCommand } from "./CopyableCommand";

function draftFrom(status: McpStatus | undefined, clusterIds: string[]): ScopeDraft {
  const scoped = status?.clusters ?? {};
  const ids = [...new Set([...clusterIds, ...Object.keys(scoped)])].sort();
  return Object.fromEntries(ids.map((id) => [id, { on: id in scoped, namespaces: (scoped[id] ?? []).join(", ") }]));
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * Backlog #5: the switch, scope and connection details for Kubebay's MCP
 * server, and the assistant calls it has answered. Turning it off revokes the
 * token, so the switch is also the kill switch.
 */
export function McpSettingsCard() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["mcp"], queryFn: mcpApi.get });
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: api.clusters });
  const st = status.data;
  const audit = useQuery({ queryKey: ["audit"], queryFn: api.auditLog, enabled: !!st?.enabled, refetchInterval: 10_000 });
  // null follows the engine; the first edit takes a copy.
  const [edited, setEdited] = useState<ScopeDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!st) return null;
  const draft = edited ?? draftFrom(st, (clusters.data ?? []).map((c) => c.id));
  const scope = scopeFromDraft(draft);
  const anyOn = Object.keys(scope).length > 0;

  const edit = (id: string, patch: Partial<ScopeDraft[string]>) => {
    const cur = draft[id] ?? { on: false, namespaces: "" };
    setEdited({ ...draft, [id]: { ...cur, ...patch } });
  };
  const run = async (call: () => Promise<McpStatus>) => {
    setBusy(true);
    setError(null);
    try {
      qc.setQueryData(["mcp"], await call());
      setEdited(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const calls = recentMcpCalls(audit.data ?? [], 10);
  const bridge = st.bridgeCommand;

  return (
    <Card id="mcp" style={{ marginTop: 18 }}>
      <Row align="center" gap={2}>
        <div className="rbac-section-title">AI assistants (MCP)</div>
        {st.enabled && <Badge tone="warn">on</Badge>}
      </Row>
      <Stack gap={3}>
        <div className="muted small">
          Let an AI assistant such as Claude read the clusters you choose, through Kubebay&apos;s MCP server. It&apos;s
          read-only: resources, logs, events and health. Secrets are never shown, and environment values are redacted.
          Every call is written to the audit log.
        </div>
        {st.disabled ? (
          <InlineBanner tone="warn" flush>
            MCP isn&apos;t available here: {st.disabled}.
          </InlineBanner>
        ) : (
          <>
            <Stack gap={2}>
              {Object.keys(draft).length === 0 && <div className="muted small">No clusters in your kubeconfig yet.</div>}
              {Object.entries(draft).map(([id, d]) => (
                <Row key={id} align="center" gap={2} wrap>
                  <label className="ctl" style={{ cursor: "pointer", minWidth: 180 }}>
                    <input type="checkbox" aria-label={`Allow ${id}`} checked={d.on} onChange={(e) => edit(id, { on: e.target.checked })} />
                    <span className="mono small strong">{id}</span>
                  </label>
                  {d.on && (
                    <TextField
                      aria-label={`Namespaces for ${id}`}
                      placeholder="All namespaces, or e.g. shop, payments"
                      value={d.namespaces}
                      onChange={(e) => edit(id, { namespaces: e.target.value })}
                      spellCheck={false}
                      style={{ flex: 1, minWidth: 0 }}
                    />
                  )}
                </Row>
              ))}
            </Stack>
            {error && <InlineBanner flush>{error}</InlineBanner>}
            <Row gap={2} align="center" wrap>
              {st.enabled ? (
                <>
                  <Button disabled={busy || !edited || !anyOn} onClick={() => void run(() => mcpApi.save({ enabled: true, clusters: scope }))}>
                    Save scope
                  </Button>
                  <Button variant="danger" disabled={busy} onClick={() => void run(() => mcpApi.save({ enabled: false, clusters: st.clusters }))}>
                    Turn off
                  </Button>
                  <ArmedButton label="Rotate token" confirmLabel="Disconnect direct clients?" busy={busy} onGo={() => void run(mcpApi.rotate)} />
                </>
              ) : (
                <Button disabled={busy || !anyOn} onClick={() => void run(() => mcpApi.save({ enabled: true, clusters: scope }))}>
                  Turn on
                </Button>
              )}
            </Row>
            {st.enabled && bridge && bridge.length > 0 && (
              <Stack gap={2}>
                <div className="strong small">Connect an assistant</div>
                <div className="muted small">
                  Claude Desktop: add this to claude_desktop_config.json (Settings, Developer, Edit Config), then restart it.
                </div>
                <CopyableCommand label="Claude Desktop configuration" command={claudeDesktopConfig(bridge)} />
                <div className="muted small">Claude Code: run this once in a terminal.</div>
                <CopyableCommand label="Claude Code command" command={claudeCodeCommand(bridge)} />
                {st.connectionFile && (
                  <div className="muted small">
                    Both start Kubebay&apos;s bridge, which reads the token from{" "}
                    <span className="mono">{st.connectionFile}</span>. Keep Kubebay open while you use them. Rotating the
                    token doesn&apos;t disconnect them.
                  </div>
                )}
              </Stack>
            )}
            {st.enabled && (
              <Stack gap={2}>
                <div className="strong small">Recent assistant calls</div>
                <DataTable
                  loading={audit.isLoading}
                  loadingLabel="Loading assistant calls…"
                  rows={calls}
                  rowKey={(c, i) => `${c.time}-${i}`}
                  empty={<EmptyState title="No assistant calls yet." hint="Calls appear here as an assistant uses Kubebay." />}
                  columns={[
                    { key: "time", header: "Time", width: 180, className: "mono muted small", render: (c) => fmtTime(c.time) },
                    { key: "tool", header: "Tool", width: 160, className: "mono small strong", render: (c) => c.tool },
                    {
                      key: "where",
                      header: "Cluster",
                      width: 170,
                      className: "mono muted small",
                      render: (c) => (c.cluster ? (c.namespace ? `${c.cluster}/${c.namespace}` : c.cluster) : "–"),
                    },
                    { key: "client", header: "Assistant", className: "muted small", render: (c) => c.client || "–" },
                  ]}
                />
              </Stack>
            )}
          </>
        )}
      </Stack>
    </Card>
  );
}
