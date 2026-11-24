// Backlog 79: the chart's audit log options. Renders the chart with helm, so it
// skips where helm isn't installed. Run: node --test scripts/chart-audit.test.mjs
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
const docs = (y) => y.split(/^---$/m);
const deployment = (y) => docs(y).find((d) => /^kind: Deployment$/m.test(d));
const envValue = (d, name) => d.match(new RegExp(`- name: ${name}\\n\\s+value: "?([^"\\n]*)"?`))?.[1];

test("default: stdout lines on, file capped, no volume claim", opts, () => {
  const y = render();
  const d = deployment(y);
  assert.equal(envValue(d, "KUBEBAY_AUDIT_STDOUT"), "true");
  assert.equal(envValue(d, "KUBEBAY_AUDIT_MAX_BYTES"), String(16 * 1024 * 1024));
  assert.equal(envValue(d, "KUBEBAY_AUDIT_DIR"), undefined);
  assert.doesNotMatch(y, /kind: PersistentVolumeClaim/);
  assert.match(d, /emptyDir:\n\s+sizeLimit: 64Mi/);
});

test("auditLog.stdout=false turns the stdout copy off explicitly", opts, () => {
  assert.equal(envValue(deployment(render("auditLog.stdout=false")), "KUBEBAY_AUDIT_STDOUT"), "false");
});

test("persistence creates a claim, mounts it where the audit file lives", opts, () => {
  const y = render("auditLog.persistence.enabled=true", "auditLog.persistence.size=2Gi", "auditLog.persistence.storageClass=fast", "auditLog.maxSizeMiB=100");
  const d = deployment(y);
  const pvc = docs(y).find((x) => /kind: PersistentVolumeClaim/.test(x));
  assert.ok(pvc, "claim rendered");
  assert.match(pvc, /storage: 2Gi/);
  assert.match(pvc, /storageClassName: "?fast"?/);
  assert.match(pvc, /ReadWriteOnce/);
  assert.equal(envValue(d, "KUBEBAY_AUDIT_DIR"), "/var/lib/kubebay/audit");
  assert.equal(envValue(d, "KUBEBAY_AUDIT_MAX_BYTES"), String(100 * 1024 * 1024));
  assert.match(d, /mountPath: \/var\/lib\/kubebay\/audit/);
  assert.match(d, /persistentVolumeClaim:\n\s+claimName: kubebay-r-audit/);
  assert.match(d, /fsGroup: 65532/);
  assert.match(d, /readOnlyRootFilesystem: true/);
});

test("existingClaim mounts that claim and renders none", opts, () => {
  const y = render("auditLog.persistence.enabled=true", "auditLog.persistence.existingClaim=mine");
  assert.doesNotMatch(y, /kind: PersistentVolumeClaim/);
  assert.match(deployment(y), /claimName: mine/);
});

test("a cap that cannot fit twice in the claim is refused", opts, () => {
  assert.throws(
    () => execFileSync("helm", ["template", "r", chart, "--set", "auditLog.persistence.enabled=true", "--set", "auditLog.persistence.size=100Mi", "--set", "auditLog.maxSizeMiB=100"], { encoding: "utf8", stdio: "pipe" }),
    /maxSizeMiB/,
  );
  assert.throws(
    () => execFileSync("helm", ["template", "r", chart, "--set", "auditLog.maxSizeMiB=40"], { encoding: "utf8", stdio: "pipe" }),
    /64Mi/,
  );
});

test("values.yaml documents the options", () => {
  const v = readFileSync(`${chart}/values.yaml`, "utf8");
  for (const k of ["auditLog:", "persistence:", "existingClaim", "storageClass", "maxSizeMiB"]) assert.ok(v.includes(k), k);
});
