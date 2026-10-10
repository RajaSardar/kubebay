import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@kubebay/ui";
import { mcpApi } from "../lib/api";

/**
 * Backlog #5: while AI assistants can read clusters through MCP, the sidebar
 * says so, and links to the switch that turns it off.
 */
export function McpChip() {
  const status = useQuery({ queryKey: ["mcp"], queryFn: mcpApi.get, refetchInterval: 15_000, retry: false });
  if (!status.data?.enabled) return null;
  const n = Object.keys(status.data.clusters ?? {}).length;
  return (
    <Link
      to="/settings#mcp"
      className="brand-mcp"
      title={`AI assistants can read ${n} ${n === 1 ? "cluster" : "clusters"} through MCP. Open Settings to change or turn it off.`}
    >
      <Badge tone="warn">AI access on</Badge>
    </Link>
  );
}
