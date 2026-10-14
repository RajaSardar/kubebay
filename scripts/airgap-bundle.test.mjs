// KB-21: the air-gapped install bundle. Run: node --test scripts/airgap-bundle.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBundle, chartVersion, pinChart, sha256Manifest } from "./airgap-bundle.mjs";

test("pins the chart's image to the release tag", () => {
  const values = "image:\n  repository: ghcr.io/rajasardar/kubebay\n  tag: latest\n  pullPolicy: IfNotPresent\n\nreplicaCount: 1\n";
  const chart = 'apiVersion: v2\nname: kubebay\nversion: 0.1.0\nappVersion: "0.1.0"\n';
  const out = pinChart({ values, chart }, "v0.7.0");
  assert.match(out.values, /^  tag: v0\.7\.0$/m);
  assert.match(out.values, /^  pullPolicy: IfNotPresent$/m);
  assert.match(out.chart, /^version: 0\.7\.0$/m);
  assert.match(out.chart, /^appVersion: "v0\.7\.0"$/m);
});

test("refuses a chart it can't pin rather than ship one pulling latest", () => {
  assert.throws(() => pinChart({ values: "image:\n  repository: x\n", chart: "version: 1.0.0\n" }, "v0.7.0"), /image tag/);
});

test("turns a release tag into a chart version", () => {
  assert.equal(chartVersion("v0.7.0"), "0.7.0");
  assert.equal(chartVersion("v1.0.0-rc.1"), "1.0.0-rc.1");
  assert.throws(() => chartVersion("main"), /semver/);
});

test("writes a SHA256SUMS that sha256sum -c reads", () => {
  const dir = mkdtempSync(join(tmpdir(), "kb-sums-"));
  mkdirSync(join(dir, "images"));
  writeFileSync(join(dir, "README.md"), "hello\n");
  writeFileSync(join(dir, "images", "a.tar"), "abc");
  assert.equal(
    sha256Manifest(dir),
    // Byte order, as LC_ALL=C sort has it.
    "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03  README.md\n" +
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  images/a.tar\n",
  );
});

test("plans the bundle: multi-arch OCI archive, a docker-load tarball per arch, the pinned chart, docs and sums", async () => {
  const work = mkdtempSync(join(tmpdir(), "kb-airgap-"));
  const docs = join(work, "AIRGAP.md");
  writeFileSync(docs, "# Offline\n");
  const chartDir = join(work, "chart");
  mkdirSync(chartDir);
  writeFileSync(join(chartDir, "values.yaml"), "image:\n  repository: ghcr.io/rajasardar/kubebay\n  tag: latest\n");
  writeFileSync(join(chartDir, "Chart.yaml"), "apiVersion: v2\nname: kubebay\nversion: 0.1.0\nappVersion: \"0.1.0\"\n");
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, ...args]);
    // Stand in for the tools: write the files they would.
    const dest = args.find((a) => /^(oci|docker)-archive:/.test(a));
    if (dest) writeFileSync(dest.replace(/^(oci|docker)-archive:/, "").replace(/(\.tar):.*$/, "$1"), "image");
    if (cmd === "helm") writeFileSync(join(args[args.indexOf("--destination") + 1], "kubebay-0.7.0.tgz"), "chart");
    if (cmd === "tar") writeFileSync(args[args.indexOf("-czf") + 1], "tarball");
  };
  const out = join(work, "dist");
  const result = await buildBundle(
    { version: "v0.7.0", image: "docker://ghcr.io/rajasardar/kubebay:v0.7.0", ref: "ghcr.io/rajasardar/kubebay:v0.7.0", chart: chartDir, docs, out, arches: ["amd64", "arm64"] },
    run,
  );

  const skopeo = calls.filter((c) => c[0] === "skopeo");
  assert.deepEqual(skopeo[0].slice(1, 3), ["copy", "--all"]);
  assert.match(skopeo[0].at(-1), /^oci-archive:.*\/images\/kubebay-v0\.7\.0\.oci\.tar:ghcr\.io\/rajasardar\/kubebay:v0\.7\.0$/);
  for (const arch of ["amd64", "arm64"]) {
    const c = skopeo.find((x) => x.includes(arch));
    assert.ok(c, arch);
    assert.ok(c.includes("--override-arch") && c.includes("--override-os"), arch);
    assert.match(c.at(-1), new RegExp(`^docker-archive:.*/images/kubebay-v0\\.7\\.0-linux-${arch}\\.tar:ghcr\\.io/rajasardar/kubebay:v0\\.7\\.0$`));
  }
  const helm = calls.find((c) => c[0] === "helm");
  assert.deepEqual(helm.slice(1, 2), ["package"]);
  assert.ok(helm.includes("--version") && helm[helm.indexOf("--version") + 1] === "0.7.0");

  const root = result.dir;
  assert.equal(readFileSync(join(root, "README.md"), "utf8"), "# Offline\n");
  const sums = readFileSync(join(root, "SHA256SUMS"), "utf8");
  for (const f of ["README.md", "chart/kubebay-0.7.0.tgz", "images/kubebay-v0.7.0.oci.tar", "images/kubebay-v0.7.0-linux-amd64.tar", "images/kubebay-v0.7.0-linux-arm64.tar"]) {
    assert.match(sums, new RegExp(`  ${f.replace(/[.]/g, "\\.")}\\n`), f);
  }
  assert.ok(!sums.includes("SHA256SUMS"), "the manifest doesn't list itself");
  assert.equal(result.tarball, join(out, "kubebay-airgap-v0.7.0.tar.gz"));
  const tar = calls.find((c) => c[0] === "tar");
  assert.ok(tar.includes("kubebay-airgap-v0.7.0"));
  // No signing unless asked.
  assert.ok(!calls.some((c) => c[0] === "cosign"));
});
