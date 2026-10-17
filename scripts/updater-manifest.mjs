#!/usr/bin/env node
// KB-04: writes latest.json, the manifest the desktop app's updater reads from
// https://github.com/OWNER/REPO/releases/latest/download/latest.json.
//
//   node scripts/updater-manifest.mjs --dir dist --tag v0.8.0 --repo OWNER/REPO --out dist/latest.json
//
// Each update bundle the Tauri build signed (createUpdaterArtifacts, with
// TAURI_SIGNING_PRIVATE_KEY) has a <bundle>.sig beside it. The manifest lists,
// per updater target, the bundle's download URL and that signature; the app
// verifies the bundle against the public key it was built with.
//
// The updater looks up "{os}-{arch}-{installer}" first, then "{os}-{arch}".
// Linux gets installer keys only, so a .deb install is never handed the
// AppImage.

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const TARGETS = [
  [/\.app\.tar\.gz$/i, ["darwin-aarch64-app", "darwin-x86_64-app", "darwin-aarch64", "darwin-x86_64"]],
  [/-setup\.exe$/i, ["windows-x86_64-nsis", "windows-x86_64"]],
  [/\.msi$/i, ["windows-x86_64-msi"]],
  [/\.AppImage$/i, ["linux-x86_64-appimage"]],
  [/\.deb$/i, ["linux-x86_64-deb"]],
  [/\.rpm$/i, ["linux-x86_64-rpm"]],
];

/** The updater targets a bundle installs on, or [] if it isn't an update bundle. */
export function platformsFor(name) {
  for (const [re, targets] of TARGETS) if (re.test(name)) return targets;
  return [];
}

/** The manifest for the signed bundles in `dir`, released as `tag` in `repo`. */
export function manifest({ dir, tag, repo, date = new Date().toISOString() }) {
  const base = `https://github.com/${repo}/releases/download/${tag}/`;
  const platforms = {};
  for (const sig of readdirSync(dir).filter((f) => f.endsWith(".sig")).sort()) {
    const bundle = sig.slice(0, -".sig".length);
    const targets = platformsFor(bundle);
    if (targets.length === 0) continue;
    if (!existsSync(join(dir, bundle))) throw new Error(`${sig} has no ${bundle} beside it`);
    const signature = readFileSync(join(dir, sig), "utf8").trim();
    for (const t of targets) platforms[t] = { signature, url: base + bundle };
  }
  if (Object.keys(platforms).length === 0) throw new Error(`no signed update bundles in ${dir}`);
  return {
    version: tag.replace(/^v/, ""),
    notes: `https://github.com/${repo}/releases/tag/${tag}`,
    pub_date: date,
    platforms,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const argv = process.argv.slice(2);
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  try {
    const m = manifest({ dir: arg("--dir"), tag: arg("--tag"), repo: arg("--repo") });
    writeFileSync(arg("--out"), JSON.stringify(m, null, 2) + "\n");
    console.log(`wrote ${arg("--out")}: ${Object.keys(m.platforms).join(", ")}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
