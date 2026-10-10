/**
 * Backlog #5: what the MCP settings card shows. Assistants connect through
 * the stdio bridge (`kubebay-engine mcp-stdio`), which reads the token from
 * Kubebay's connection file per request, so no snippet here carries the token
 * and rotating it never breaks a connected assistant.
 */

/** The `mcpServers` entry for Claude Desktop's claude_desktop_config.json. */
export function claudeDesktopConfig(bridge: string[]): string {
  const [command, ...args] = bridge;
  return JSON.stringify({ mcpServers: { kubebay: { command, args } } }, null, 2);
}

const SHELL_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

function shellQuote(s: string): string {
  return SHELL_SAFE.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Registers the bridge with Claude Code for every project (user scope). */
export function claudeCodeCommand(bridge: string[]): string {
  return `claude mcp add --scope user kubebay -- ${bridge.map(shellQuote).join(" ")}`;
}

export function parseNamespaces(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).filter(Boolean))];
}

export type ScopeDraft = Record<string, { on: boolean; namespaces: string }>;

/** The engine's scope: cluster ID to namespaces, where none means the whole cluster. */
export function scopeFromDraft(draft: ScopeDraft): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [id, d] of Object.entries(draft)) {
    if (d.on) out[id] = parseNamespaces(d.namespaces);
  }
  return out;
}

export interface McpCall {
  time: string;
  tool: string;
  cluster: string;
  namespace?: string;
  detail?: string;
  client?: string;
}

interface AuditLike {
  time: string;
  action: string;
  cluster: string;
  namespace?: string;
  detail?: string;
  userAgent?: string;
  source?: string;
}

/** Assistant tool calls from the audit log, newest first. */
export function recentMcpCalls(entries: AuditLike[], limit = 20): McpCall[] {
  return entries
    .filter((e) => e.source === "mcp")
    .slice(-limit)
    .reverse()
    .map((e) => ({
      time: e.time,
      tool: e.action.replace(/^mcp:/, ""),
      cluster: e.cluster,
      namespace: e.namespace,
      detail: e.detail,
      client: e.userAgent,
    }));
}
