#!/usr/bin/env node
// KB-21: the air-gapped install bundle, kubebay-airgap-<tag>.tar.gz:
//
//   kubebay-airgap-v0.7.0/
//     README.md                                 docs/AIRGAP.md, the offline install guide
//     chart/kubebay-0.7.0.tgz                   the Helm chart, its image pinned to v0.7.0
//     images/kubebay-v0.7.0.oci.tar             every platform, to push to a private registry
//     images/kubebay-v0.7.0-linux-<arch>.tar    one platform, for docker load / ctr import
//     SHA256SUMS                                sha256sum -c reads it
//     SHA256SUMS.cosign.bundle                  with --sign: a keyless signature of SHA256SUMS
//
//   node scripts/airgap-bundle.mjs --version v0.7.0 --image docker://ghcr.io/rajasardar/kubebay:v0.7.0 \
//     --chart charts/kubebay --docs docs/AIRGAP.md --out dist [--arches amd64,arm64] [--sign]
//
// Needs skopeo, helm and tar (and cosign with --sign) on PATH.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

const SEMVER = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

/** The chart version for a release tag: v0.7.0 → 0.7.0. */
export function chartVersion(tag) {
  const m = SEMVER.exec(tag);
  if (!m) throw new Error(`${tag} isn't a semver release tag`);
  return m[1];
}

/** The chart with its image tag, version and appVersion set to the release. */
export function pinChart({ values, chart }, tag) {
  const tagLine = /^(  tag:\s*).*$/m;
  if (!/^image:\s*$/m.test(values) || !tagLine.test(values)) {
    throw new Error("values.yaml has no image tag to pin; the bundle would pull an image the cluster can't reach");
  }
  return {
    values: values.replace(tagLine, `$1${tag}`),
    chart: chart.replace(/^version:.*$/m, `version: ${chartVersion(tag)}`).replace(/^appVersion:.*$/m, `appVersion: "${tag}"`),
  };
}

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

/** A SHA256SUMS for every file under dir, in byte order, as sha256sum -c reads it. */
export function sha256Manifest(dir) {
  return files(dir)
    .map((p) => relative(dir, p).split(sep).join("/"))
    .filter((rel) => !rel.startsWith("SHA256SUMS"))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((rel) => `${createHash("sha256").update(readFileSync(join(dir, rel))).digest("hex")}  ${rel}\n`)
    .join("");
}

const defaultRun = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit" });

/**
 * Builds the bundle. `image` is a skopeo source (docker://…, oci:…) and `ref`
 * the name the archives carry; `run` runs a command (injected by tests).
 */
export async function buildBundle({ version, image, ref, chart, docs, out, arches = ["amd64", "arm64"], sign = false }, run = defaultRun) {
  const name = `kubebay-airgap-${version}`;
  const work = mkdtempSync(join(tmpdir(), "kubebay-airgap-"));
  const dir = join(work, name);
  mkdirSync(join(dir, "images"), { recursive: true });
  mkdirSync(join(dir, "chart"), { recursive: true });
  mkdirSync(out, { recursive: true });

  run("skopeo", ["copy", "--all", image, `oci-archive:${join(dir, "images", `kubebay-${version}.oci.tar`)}:${ref}`]);
  for (const arch of arches) {
    run("skopeo", [
      "copy",
      "--override-os",
      "linux",
      "--override-arch",
      arch,
      image,
      `docker-archive:${join(dir, "images", `kubebay-${version}-linux-${arch}.tar`)}:${ref}`,
    ]);
  }

  const chartCopy = join(work, "chart-src");
  cpSync(chart, chartCopy, { recursive: true });
  const pinned = pinChart(
    { values: readFileSync(join(chartCopy, "values.yaml"), "utf8"), chart: readFileSync(join(chartCopy, "Chart.yaml"), "utf8") },
    version,
  );
  writeFileSync(join(chartCopy, "values.yaml"), pinned.values);
  writeFileSync(join(chartCopy, "Chart.yaml"), pinned.chart);
  run("helm", ["package", chartCopy, "--version", chartVersion(version), "--app-version", version, "--destination", join(dir, "chart")]);

  copyFileSync(docs, join(dir, "README.md"));
  writeFileSync(join(dir, "SHA256SUMS"), sha256Manifest(dir));
  if (sign) run("cosign", ["sign-blob", "--yes", "--bundle", join(dir, "SHA256SUMS.cosign.bundle"), join(dir, "SHA256SUMS")]);

  const tarball = join(out, `${name}.tar.gz`);
  run("tar", ["-C", work, "-czf", tarball, name]);
  return { dir, tarball };
}

function args(argv) {
  const out = { sign: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--sign") out.sign = true;
    else if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[++i];
  }
  return out;
}

async function main() {
  const a = args(process.argv.slice(2));
  for (const k of ["version", "image", "chart", "docs", "out"]) {
    if (!a[k]) {
      console.error(`missing --${k}`);
      process.exit(2);
    }
  }
  const ref = a.ref ?? a.image.replace(/^docker:\/\//, "");
  const { tarball } = await buildBundle({
    version: a.version,
    image: a.image,
    ref,
    chart: a.chart,
    docs: a.docs,
    out: a.out,
    arches: (a.arches ?? "amd64,arm64").split(","),
    sign: a.sign,
  });
  console.log(tarball);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
