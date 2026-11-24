// Backlog 81: the chart's auth-proxy sign-in option. Renders the chart with
// helm, so it skips where helm isn't installed (then it proves nothing).
// Run: node --test scripts/chart-authproxy.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const chart = fileURLToPath(new URL("../charts/kubebay", import.meta.url));
const hasHelm = spawnSync("helm", ["version", "--short"]).status === 0;
const opts = { skip: hasHelm ? false : "helm is not installed" };

const render = (...sets) =>
  execFileSync("helm", ["template", "r", chart, ...sets.flatMap((s) => ["--set", s])], { encoding: "utf8", stdio: "pipe" });
const docs = (y) => y.split(/^---$/m);
const deployment = (y) => docs(y).find((d) => /^kind: Deployment$/m.test(d));
const envValue = (d, name) => d.match(new RegExp(`- name: ${name}\\n\\s+value: "?([^"\\n]*)"?`))?.[1];
const proxy = ["authProxy.enabled=true", "authProxy.trustedCIDRs={10.1.2.0/24}"];

test("off by default: no proxy env, no impersonation role", opts, () => {
  const y = render();
  assert.doesNotMatch(y, /KUBEBAY_AUTH_PROXY/);
  assert.doesNotMatch(y, /impersonate/);
});

test("enabled: flags render as env and the impersonation role appears", opts, () => {
  const y = render(...proxy, "authProxy.userHeader=X-Forwarded-Email", "authProxy.groupsHeader=X-Forwarded-Groups");
  const d = deployment(y);
  assert.equal(envValue(d, "KUBEBAY_AUTH_PROXY_USER_HEADER"), "X-Forwarded-Email");
  assert.equal(envValue(d, "KUBEBAY_AUTH_PROXY_GROUPS_HEADER"), "X-Forwarded-Groups");
  assert.equal(envValue(d, "KUBEBAY_AUTH_PROXY_TRUSTED_CIDRS"), "10.1.2.0/24");
  assert.equal(envValue(d, "KUBEBAY_AUTH_PROXY_ALLOW_ANY_PEER"), undefined);
  assert.doesNotMatch(d, /KUBEBAY_OIDC/);
  assert.match(y, /verbs: \["impersonate"\]/);
  assert.match(y, /resources: \["users"\]/);
  assert.match(y, /resources: \["groups"\]/);
  assert.doesNotMatch(y, /serviceaccounts|userextras|uids/);
});

test("impersonation allow-lists apply to the proxy mode too", opts, () => {
  const y = render(...proxy, "impersonation.groups={dev,ops}", "impersonation.users={alice}");
  assert.match(y, /resourceNames:\n\s+- dev\n\s+- ops/);
  assert.match(y, /resourceNames:\n\s+- alice/);
});

test("the shared secret is a mounted Secret file, never a value in the manifest", opts, () => {
  const y = render(...proxy, "authProxy.secret.header=X-Proxy-Secret", "authProxy.secret.existingSecret=proxy-secret");
  const d = deployment(y);
  assert.equal(envValue(d, "KUBEBAY_AUTH_PROXY_SECRET_HEADER"), "X-Proxy-Secret");
  assert.equal(envValue(d, "KUBEBAY_AUTH_PROXY_SECRET_FILE"), "/etc/kubebay/auth-proxy/secret");
  assert.match(d, /secretName: proxy-secret/);
  assert.match(d, /mountPath: \/etc\/kubebay\/auth-proxy\n\s+readOnly: true/);
  assert.doesNotMatch(d, /KUBEBAY_AUTH_PROXY_SECRET\n/);
});

test("a secret header without a Secret to read it from is refused", opts, () => {
  assert.throws(() => render(...proxy, "authProxy.secret.header=X-Proxy-Secret"), /existingSecret/);
});

test("the proxy and OIDC cannot both be on", opts, () => {
  assert.throws(() => render(...proxy, "oidc.issuerUrl=https://idp.example", "ingress.host=kb.example"), /both/);
});

test("trusted CIDRs are required unless any peer is acknowledged", opts, () => {
  assert.throws(() => render("authProxy.enabled=true"), /trustedCIDRs/);
  assert.throws(() => render("authProxy.enabled=true", "authProxy.trustedCIDRs={0.0.0.0/0}"), /allowAnyPeer/);
  const y = render("authProxy.enabled=true", "authProxy.allowAnyPeer=true");
  assert.equal(envValue(deployment(y), "KUBEBAY_AUTH_PROXY_ALLOW_ANY_PEER"), "true");
});

test("OIDC alone still renders its role and no proxy env", opts, () => {
  const y = render("oidc.issuerUrl=https://idp.example", "ingress.host=kb.example");
  assert.match(y, /verbs: \["impersonate"\]/);
  assert.doesNotMatch(y, /KUBEBAY_AUTH_PROXY/);
});
