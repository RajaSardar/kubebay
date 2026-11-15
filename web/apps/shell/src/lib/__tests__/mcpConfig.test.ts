import { describe, it, expect } from "vitest";
import { claudeCodeCommand, claudeDesktopConfig, parseNamespaces, recentMcpCalls, scopeFromDraft } from "../mcpConfig";

const MAC = ["/Applications/Kubebay.app/Contents/MacOS/kubebay-engine", "mcp-stdio"];

describe("claudeDesktopConfig", () => {
  it("is the mcpServers entry that launches the stdio bridge", () => {
    const conf = JSON.parse(claudeDesktopConfig(MAC));
    expect(conf).toEqual({ mcpServers: { kubebay: { command: MAC[0], args: ["mcp-stdio"] } } });
  });

  it("keeps Windows paths intact", () => {
    const exe = "C:\\Program Files\\Kubebay\\kubebay-engine.exe";
    expect(JSON.parse(claudeDesktopConfig([exe, "mcp-stdio"])).mcpServers.kubebay.command).toBe(exe);
  });
});

describe("claudeCodeCommand", () => {
  it("adds the bridge for every project, so the token never appears in it", () => {
    expect(claudeCodeCommand(MAC)).toBe(`claude mcp add --scope user kubebay -- ${MAC[0]} mcp-stdio`);
  });

  it("quotes paths a shell would split", () => {
    expect(claudeCodeCommand(["/Users/me/My Apps/kubebay-engine", "mcp-stdio"])).toBe(
      "claude mcp add --scope user kubebay -- '/Users/me/My Apps/kubebay-engine' mcp-stdio",
    );
    expect(claudeCodeCommand(["/opt/raja's/kb", "mcp-stdio"])).toBe(
      "claude mcp add --scope user kubebay -- '/opt/raja'\\''s/kb' mcp-stdio",
    );
  });
});

describe("parseNamespaces", () => {
  it("splits on commas and spaces, drops blanks and repeats", () => {
    expect(parseNamespaces(" shop, ops  web,,shop ")).toEqual(["shop", "ops", "web"]);
    expect(parseNamespaces("")).toEqual([]);
  });
});

describe("scopeFromDraft", () => {
  it("maps each chosen cluster to its namespaces; none means the whole cluster", () => {
    expect(
      scopeFromDraft({ "kind-dev": { on: true, namespaces: "" }, prod: { on: false, namespaces: "shop" }, stage: { on: true, namespaces: "shop, ops" } }),
    ).toEqual({ "kind-dev": [], stage: ["shop", "ops"] });
  });
});

describe("recentMcpCalls", () => {
  it("keeps assistant calls only, newest first, capped", () => {
    const entries = [
      { time: "2026-10-10T08:00:00Z", action: "scale", cluster: "kind-dev" },
      { time: "2026-10-10T08:00:01Z", action: "mcp:list_clusters", cluster: "", source: "mcp", userAgent: "claude-code 2.1" },
      { time: "2026-10-10T08:00:02Z", action: "mcp:get_logs", cluster: "kind-dev", source: "mcp" },
      { time: "2026-10-10T08:00:03Z", action: "mcp:describe_resource", cluster: "kind-dev", source: "mcp" },
    ];
    const got = recentMcpCalls(entries, 2);
    expect(got.map((e) => e.tool)).toEqual(["describe_resource", "get_logs"]);
    expect(recentMcpCalls(entries, 10).at(-1)).toMatchObject({ tool: "list_clusters", client: "claude-code 2.1" });
  });
});
