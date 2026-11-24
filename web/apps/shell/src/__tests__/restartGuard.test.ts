/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";

// Restart replaces every pod of a workload, so no Restart may reach the API
// on one click. Any source file that calls api.restart or builds a Rollout
// action request (which carries restart) must go through RESTART_CONFIRM_LABEL.
const src = resolve(__dirname, "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = resolve(dir, f);
    if (statSync(p).isDirectory()) return f === "__tests__" || f === "generated" ? [] : walk(p);
    return /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });
}

describe("restart is always confirmed", () => {
  const files = walk(src).filter((p) => !p.endsWith("lib/api.ts") && !p.endsWith("lib/rollouts.ts"));
  const callers = files.filter((p) => /\bapi\.restart\(|\/api\/action\/restart|rolloutActionRequests\(/.test(readFileSync(p, "utf8")));

  it("finds the known call sites", () => {
    const names = callers.map((p) => relative(src, p)).sort();
    expect(names).toEqual(expect.arrayContaining(["components/ActionsBar.tsx", "components/RolloutsDashboard.tsx", "components/WorkloadActionDialog.tsx"]));
  });

  it.each(callers.map((p) => relative(src, p)))("%s asks again before restarting", (file) => {
    const text = readFileSync(resolve(src, file), "utf8");
    expect(text).toMatch(/from "\.\.\/lib\/restartConfirm"/);
    expect(text).toMatch(/RESTART_CONFIRM_LABEL/);
  });
});
