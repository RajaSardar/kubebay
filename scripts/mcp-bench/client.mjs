// A minimal MCP client over Kubebay's HTTP endpoint (stateless JSON-RPC, the
// 2025 transport). fetch is injectable so tests never touch the network.
export function httpClient({ url, token, fetchImpl = fetch, name = "kubebay-mcp-bench" }) {
  let id = 0;
  async function rpc(method, params) {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token}`, "User-Agent": name },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });
    if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
    const body = await res.json();
    if (body.error) throw new Error(`${method}: ${body.error.message}`);
    return body.result;
  }
  return {
    async listTools() {
      return (await rpc("tools/list", {})).tools;
    },
    async callTool(toolName, args) {
      const r = await rpc("tools/call", { name: toolName, arguments: args });
      return { isError: !!r.isError, text: (r.content ?? []).map((c) => c.text ?? "").join("\n") };
    },
  };
}
