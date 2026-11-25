// Backlog 77b: the chart's mcp.readOnly value. Renders the chart with helm, so
// it skips where helm isn't installed. Run: node --test scripts/chart-mcp.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const chart = fileURLToPath(new URL("../charts/kubebay", import.meta.url));
const hasHelm = spawnSync("helm", ["version", "--short"]).status === 0;
const opts = { skip: hasHelm ? false : "helm is not installed" };

const render = (...sets) =>
  execFileSync("helm", ["template", "r", chart, ...sets.flatMap((s) => ["--set", s])], { encoding: "utf8" });
const deployment = (y) => y.split(/^---$/m).find((d) => /^kind: Deployment$/m.test(d));

test("default: mcp.readOnly is false and sets nothing", opts, () => {
  assert.doesNotMatch(deployment(render()), /KUBEBAY_MCP_READ_ONLY/);
  assert.match(readFileSync(`${chart}/values.yaml`, "utf8"), /^mcp:\n(?:\s+#.*\n)*\s+readOnly: false$/m);
});

test("mcp.readOnly=true sets KUBEBAY_MCP_READ_ONLY=true on the engine", opts, () => {
  assert.match(deployment(render("mcp.readOnly=true")), /- name: KUBEBAY_MCP_READ_ONLY\n\s+value: "true"/);
});
