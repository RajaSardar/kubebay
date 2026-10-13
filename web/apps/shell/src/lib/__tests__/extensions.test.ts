import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  actionsFor,
  appliesTo,
  columnsFor,
  contextMatches,
  expandRun,
  expandURL,
  shellQuote,
  typeWhenQuiet,
  varsOf,
  type TemplateVars,
} from "../extensions";
import type { ExtensionsFile } from "../api";

const pod = {
  metadata: {
    name: "api-7d9f",
    namespace: "shop",
    labels: { app: "api", "app.kubernetes.io/name": "api" },
    annotations: { "example.com/owner": "team-a", "example.com/runbook": "x'; rm -rf ~; echo '" },
  },
};
const vars: TemplateVars = varsOf(pod, "Pod", "kind-dev");

describe("appliesTo", () => {
  const deployments = { resource: "deployments", group: "apps" };
  const pods = { resource: "pods", group: "" };
  const nodepools = { resource: "nodepools", group: "karpenter.sh" };
  it("matches a bare resource in any group, or resource.group exactly", () => {
    expect(appliesTo("deployments", deployments)).toBe(true);
    expect(appliesTo("deployments.apps", deployments)).toBe(true);
    expect(appliesTo("deployments.extensions", deployments)).toBe(false);
    expect(appliesTo("pods", pods)).toBe(true);
    expect(appliesTo("pods.apps", pods)).toBe(false);
    expect(appliesTo("nodepools.karpenter.sh", nodepools)).toBe(true);
    expect(appliesTo("nodepools", nodepools)).toBe(true);
    expect(appliesTo("pod", pods)).toBe(false);
  });
});

describe("contextMatches", () => {
  it("matches every context when the action names none", () => {
    expect(contextMatches(undefined, "prod")).toBe(true);
    expect(contextMatches([], "prod")).toBe(true);
  });
  it("matches names and * wildcards, and nothing else", () => {
    expect(contextMatches(["kind-dev"], "kind-dev")).toBe(true);
    expect(contextMatches(["dev-*"], "dev-eu-1")).toBe(true);
    expect(contextMatches(["dev-*"], "prod-dev-1")).toBe(false);
    expect(contextMatches(["*-dev"], "kind-dev")).toBe(true);
    // A regexp character in a pattern is literal.
    expect(contextMatches(["a.b"], "aXb")).toBe(false);
    expect(contextMatches(["a.b"], "a.b")).toBe(true);
  });
});

describe("shellQuote", () => {
  it("single-quotes, and keeps quotes and backslashes outside the quotes so fish reads it the same", () => {
    expect(shellQuote("api")).toBe("'api'");
    expect(shellQuote("")).toBe("''");
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
    expect(shellQuote("a\\")).toBe(`'a'\\\\''`);
    expect(shellQuote("$(id) `id` ${HOME} ; | & > *")).toBe("'$(id) `id` ${HOME} ; | & > *'");
  });
});

describe("expandRun", () => {
  it("quotes each value as one argument", () => {
    expect(expandRun("stern -n {{namespace}} {{name}} --context {{context}}", vars)).toEqual({
      ok: true,
      value: "stern -n 'shop' 'api-7d9f' --context 'kind-dev'",
    });
    expect(expandRun("kubectl get {{kind}} -l app={{label:app.kubernetes.io/name}}", vars)).toEqual({
      ok: true,
      value: "kubectl get 'Pod' -l app='api'",
    });
  });

  it("keeps a hostile annotation one argument", () => {
    const r = expandRun("echo {{annotation:example.com/runbook}}", vars);
    expect(r).toEqual({ ok: true, value: `echo 'x'\\''; rm -rf ~; echo '\\'''` });
  });

  it.each([
    ["a newline, which would run the line", "a\nrm -rf ~"],
    ["a carriage return", "a\rb"],
    ["an escape, which could end a bracketed paste", "a\u001b[201~; rm -rf ~"],
    ["a C1 control", "a\u009bb"],
    ["DEL", "a\u007fb"],
    ["a right-to-left override, which hides what it says", "a‮b"],
    ["a bidi isolate", "a⁦b"],
  ])("refuses a value with %s", (_why, bad) => {
    const v = varsOf({ metadata: { name: "p", annotations: { x: bad } } }, "Pod", "ctx");
    const r = expandRun("echo {{annotation:x}}", v);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/annotation x/);
  });

  it("says which value is missing", () => {
    expect(expandRun("echo {{label:team}}", vars)).toEqual({ ok: false, reason: "It has no label team." });
    const node = varsOf({ metadata: { name: "n1" } }, "Node", "ctx");
    expect(expandRun("echo {{namespace}}", node)).toEqual({ ok: false, reason: "It has no namespace." });
  });

  it("refuses a placeholder it doesn't know rather than leave it in", () => {
    expect(expandRun("echo {{Name}}", vars).ok).toBe(false);
  });
});

describe("expandURL", () => {
  it("percent-encodes each value", () => {
    expect(expandURL("https://grafana.example.com/d/x?var-ns={{namespace}}&var-pod={{name}}", vars)).toEqual({
      ok: true,
      value: "https://grafana.example.com/d/x?var-ns=shop&var-pod=api-7d9f",
    });
    const odd = varsOf({ metadata: { name: "p", annotations: { x: "a/b?c=d&e#f g" } } }, "Pod", "ctx");
    expect(expandURL("https://h.example/{{annotation:x}}", odd)).toEqual({
      ok: true,
      value: "https://h.example/a%2Fb%3Fc%3Dd%26e%23f%20g",
    });
  });

  it("opens http and https only", () => {
    expect(expandURL("javascript:alert({{name}})", vars).ok).toBe(false);
    expect(expandURL("{{name}}", vars).ok).toBe(false);
  });

  it("never lets a value pick the host", () => {
    const evil = varsOf({ metadata: { name: "p", labels: { h: "evil.example" } } }, "Pod", "ctx");
    expect(expandURL("https://{{label:h}}/x", evil).ok).toBe(false);
    // An @ in the path can't turn the start into userinfo either.
    const at = varsOf({ metadata: { name: "@evil.example" } }, "Pod", "ctx");
    expect(expandURL("https://grafana.example.com{{name}}", at).ok).toBe(false);
  });
});

describe("columnsFor and actionsFor", () => {
  const file: ExtensionsFile = {
    path: "/home/u/.kubebay/extensions.yaml",
    exists: true,
    errors: [],
    columns: [
      { resource: "pods", header: "Node", jsonPath: ".spec.nodeName" },
      { resource: "deployments.apps", header: "Team", jsonPath: ".metadata.labels.team" },
    ],
    actions: [
      { resource: "pods", label: "Grafana", url: "https://g.example/{{name}}" },
      { resource: "pods", label: "stern", run: "stern {{name}}" },
      { resource: "pods", label: "dev only", url: "https://d.example/{{name}}", contexts: ["dev-*"] },
      { resource: "deployments", label: "Rollout", run: "kubectl rollout status deploy/{{name}}" },
    ],
    commands: { available: true, shell: "zsh" },
  };
  const pods = { resource: "pods", group: "" };

  it("picks the columns for a table's resource", () => {
    expect(columnsFor(file, pods).map((c) => c.header)).toEqual(["Node"]);
    expect(columnsFor(file, { resource: "deployments", group: "apps" }).map((c) => c.header)).toEqual(["Team"]);
    expect(columnsFor(undefined, pods)).toEqual([]);
  });

  it("picks actions by resource and context, and hides commands without a shell to type them into", () => {
    expect(actionsFor(file, pods, "prod").map((a) => a.label)).toEqual(["Grafana", "stern"]);
    expect(actionsFor(file, pods, "dev-eu").map((a) => a.label)).toEqual(["Grafana", "stern", "dev only"]);
    const noShell = { ...file, commands: { available: false, reason: "no local shell" } };
    expect(actionsFor(noShell, pods, "dev-eu").map((a) => a.label)).toEqual(["Grafana", "dev only"]);
    expect(actionsFor(undefined, pods, "x")).toEqual([]);
  });
});

describe("typeWhenQuiet", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("waits for the shell's first output to settle, then types once", () => {
    const paste = vi.fn();
    const t = typeWhenQuiet("stern 'api'", paste, { quietMs: 300, maxMs: 3000 });
    vi.advanceTimersByTime(5000);
    expect(paste).not.toHaveBeenCalled(); // nothing until the shell says something
    t.onData();
    vi.advanceTimersByTime(200);
    t.onData(); // more of the prompt
    vi.advanceTimersByTime(200);
    expect(paste).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    expect(paste).toHaveBeenCalledWith("stern 'api'");
    t.onData();
    vi.advanceTimersByTime(1000);
    expect(paste).toHaveBeenCalledTimes(1);
  });

  it("types anyway after maxMs of steady output", () => {
    const paste = vi.fn();
    const t = typeWhenQuiet("x", paste, { quietMs: 300, maxMs: 1000 });
    for (let i = 0; i < 20; i++) {
      t.onData();
      vi.advanceTimersByTime(100);
    }
    expect(paste).toHaveBeenCalledTimes(1);
  });

  it("types nothing once cancelled", () => {
    const paste = vi.fn();
    const t = typeWhenQuiet("x", paste, { quietMs: 300, maxMs: 1000 });
    t.onData();
    t.cancel();
    vi.advanceTimersByTime(2000);
    expect(paste).not.toHaveBeenCalled();
  });
});
