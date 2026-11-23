// install.sh is the one-line installer for Linux (and the engine on macOS):
//   curl -fsSL https://github.com/RajaSardar/kubebay/releases/latest/download/install.sh | sh
// It picks the release asset for this OS and CPU, checks it against the SHA-256
// the release publishes (and the cosign signature when cosign is installed), and
// only then installs: the engine into a bin directory, or with --desktop the
// .deb through apt (never `dpkg -i`, which leaves its dependencies missing) or
// the AppImage. These run the real script under POSIX sh against stand-in curl,
// wget, uname, id, sudo, apt-get and cosign, with a PATH that holds nothing else,
// so the host's own tools never decide the outcome.
// Run: node --test scripts/install.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "install.sh");
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const which = (cmd) => {
  const r = spawnSync("sh", ["-c", `command -v ${cmd}`], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
};

// The real tools the script may use. Anything else it calls must be a stub.
const REAL = ["sh", "bash", "tar", "gzip", "mktemp", "awk", "sed", "grep", "chmod", "mkdir", "mv", "rm", "cp",
  "cat", "basename", "dirname", "head", "tr", "env", "ln", "perl", "shasum", "sha256sum", "printf", "test", "ls", "touch"];

// An engine tarball laid out like the release's: kubebay-<os>-<arch>/kubebay.
function tarball(dir, os, arch, body = "#!/bin/sh\necho kubebay-engine\n") {
  const name = `kubebay-${os}-${arch}`;
  const src = join(dir, "src", name);
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "kubebay"), body);
  chmodSync(join(src, "kubebay"), 0o755);
  writeFileSync(join(src, "README.md"), "readme");
  const r = spawnSync("tar", ["czf", join(dir, `${name}.tar.gz`), "-C", join(dir, "src"), name]);
  assert.equal(r.status, 0, String(r.stderr));
  return readFileSync(join(dir, `${name}.tar.gz`));
}

// A sandbox: a "release" folder the fake curl/wget serve from, stub commands, a
// home directory, and a log of every stubbed call.
function sandbox({ os = "Linux", arch = "x86_64", uid = 1000, files = {}, cosign = null, apt = false, sudo = true, downloader = "curl" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "kb-install-"));
  const release = join(dir, "release");
  const bin = join(dir, "bin");
  const home = join(dir, "home");
  for (const d of [release, bin, home]) mkdirSync(d);
  for (const [name, body] of Object.entries(files)) writeFileSync(join(release, name), body);
  const log = join(dir, "calls.log");
  writeFileSync(log, "");
  for (const t of REAL) {
    const p = which(t);
    if (p && !existsSync(join(bin, t))) symlinkSync(p, join(bin, t));
  }
  const stub = (name, body) => {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  // Both downloaders: serve release/<basename of URL>, fail like curl -f when absent.
  const serve = `
f="${release}/$(basename "$url")"
[ -f "$f" ] || exit 22
if [ -z "$out" ] || [ "$out" = "-" ]; then cat "$f"; else cp "$f" "$out"; fi`;
  if (downloader === "curl") {
    stub("curl", `out=""; url=""
while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift ;; -*) ;; *) url="$1" ;; esac; shift; done
echo "curl $url" >> "${log}"${serve}`);
  } else {
    stub("wget", `out=""; url=""
while [ $# -gt 0 ]; do case "$1" in -O) out="$2"; shift ;; -O-) out="-" ;; -qO-) out="-" ;; -qO) out="$2"; shift ;; -*) ;; *) url="$1" ;; esac; shift; done
echo "wget $url" >> "${log}"${serve}`);
  }
  stub("uname", `case "$1" in -s) echo ${os} ;; -m) echo ${arch} ;; *) echo ${os} ;; esac`);
  stub("id", `[ "$1" = "-u" ] && echo ${uid} || echo uid=${uid}`);
  if (cosign !== null) stub("cosign", `echo "cosign $*" >> "${log}"; exit ${cosign}`);
  if (apt) stub("apt-get", `echo "apt-get $*" >> "${log}"; for a in "$@"; do case "$a" in *.deb) [ -r "$a" ] || exit 100 ;; esac; done`);
  if (sudo) stub("sudo", `echo "sudo $*" >> "${log}"; exec "$@"`);

  const run = (args = [], env = {}) =>
    spawnSync(process.env.KB_SH ?? "sh", [script, ...args], {
      encoding: "utf8",
      env: { PATH: bin, HOME: home, KUBEBAY_INSTALL_DIR: join(dir, "installed"), ...env },
    });
  const calls = () => readFileSync(log, "utf8");
  return { run, calls, dir, home, release, installed: join(dir, "installed") };
}

const V = "0.9.0";
const engineFiles = (os, arch, { sum = true } = {}) => {
  const tmp = mkdtempSync(join(tmpdir(), "kb-tar-"));
  const tgz = tarball(tmp, os, arch);
  const name = `kubebay-${os}-${arch}.tar.gz`;
  return { [name]: tgz, ...(sum ? { [`${name}.sha256`]: `${sha(tgz)}  ${name}\n` } : {}) };
};
const out = (r) => r.stdout + r.stderr;

test("installs the engine for Linux x86_64, checked against the release's checksum", () => {
  const sb = sandbox({ files: engineFiles("linux", "amd64") });
  const r = sb.run([`v${V}`]);
  assert.equal(r.status, 0, out(r));
  const exe = join(sb.installed, "kubebay");
  assert.ok(existsSync(exe), "kubebay was not installed");
  assert.ok(statSync(exe).mode & 0o111, "kubebay is not executable");
  assert.match(sb.calls(), new RegExp(`releases/download/v${V}/kubebay-linux-amd64\\.tar\\.gz`));
  assert.match(out(r), /checksum matches/i);
  // It says how to run it and where the token is.
  assert.match(out(r), /http:\/\/127\.0\.0\.1:9898/);
  assert.match(out(r), /session-token/);
});

test("picks the arm64 engine on aarch64 Linux and the darwin build on a Mac", () => {
  const arm = sandbox({ arch: "aarch64", files: engineFiles("linux", "arm64") });
  assert.equal(arm.run([`v${V}`]).status, 0);
  assert.match(arm.calls(), /kubebay-linux-arm64\.tar\.gz/);

  const mac = sandbox({ os: "Darwin", arch: "arm64", files: engineFiles("darwin", "arm64") });
  const r = mac.run([`v${V}`]);
  assert.equal(r.status, 0, out(r));
  assert.match(mac.calls(), /kubebay-darwin-arm64\.tar\.gz/);
  assert.ok(existsSync(join(mac.installed, "kubebay")));
});

test("names the CPU it can't install for, and downloads nothing", () => {
  for (const arch of ["i686", "riscv64", "armv7l"]) {
    const sb = sandbox({ arch, files: engineFiles("linux", "amd64") });
    const r = sb.run([`v${V}`]);
    assert.notEqual(r.status, 0, `${arch} was accepted`);
    assert.match(out(r), new RegExp(arch));
    assert.doesNotMatch(sb.calls(), /tar\.gz/);
  }
});

test("refuses a download whose checksum doesn't match, and leaves the installed engine alone", () => {
  const files = engineFiles("linux", "amd64");
  files["kubebay-linux-amd64.tar.gz.sha256"] = `${sha("something else")}  kubebay-linux-amd64.tar.gz\n`;
  const sb = sandbox({ files });
  mkdirSync(sb.installed);
  writeFileSync(join(sb.installed, "kubebay"), "old");
  const r = sb.run([`v${V}`]);
  assert.notEqual(r.status, 0, "a tampered download was installed");
  assert.match(out(r), /checksum/i);
  assert.equal(readFileSync(join(sb.installed, "kubebay"), "utf8"), "old");
});

test("refuses a release with no published checksum unless told to go ahead", () => {
  const files = engineFiles("linux", "amd64", { sum: false });
  const refused = sandbox({ files });
  const r = refused.run([`v${V}`]);
  assert.notEqual(r.status, 0);
  assert.match(out(r), /checksum/i);
  assert.ok(!existsSync(join(refused.installed, "kubebay")));

  const sb = sandbox({ files });
  const ok = sb.run([`v${V}`], { KUBEBAY_INSTALL_UNVERIFIED: "1" });
  assert.equal(ok.status, 0, out(ok));
  assert.match(out(ok), /unverified/i);
  assert.ok(existsSync(join(sb.installed, "kubebay")));
});

test("with cosign installed, a bad signature stops the install and a good one lets it through", () => {
  const files = { ...engineFiles("linux", "amd64"), "kubebay-linux-amd64.tar.gz.cosign.bundle": "{}" };
  const bad = sandbox({ files, cosign: 1 });
  const r = bad.run([`v${V}`]);
  assert.notEqual(r.status, 0);
  assert.match(out(r), /signature/i);
  assert.ok(!existsSync(join(bad.installed, "kubebay")));

  const good = sandbox({ files, cosign: 0 });
  assert.equal(good.run([`v${V}`]).status, 0);
  assert.match(good.calls(), /--certificate-identity-regexp .*RajaSardar\/kubebay\/\\\.github\/workflows\/release\\\.yml@refs\/tags\/v/);
  assert.match(good.calls(), /--certificate-oidc-issuer https:\/\/token\.actions\.githubusercontent\.com/);
});

test("a version that isn't a version never reaches a URL or a path", () => {
  for (const v of ["../../etc", "v1.0.0/../x", "v1.0.0;rm -rf ~", "$(id)", "v1 .0"]) {
    const sb = sandbox({ files: engineFiles("linux", "amd64") });
    const r = sb.run([v]);
    assert.notEqual(r.status, 0, `${v} was accepted`);
    assert.equal(sb.calls(), "", `${v} reached a download`);
  }
});

test("with no version it installs the latest release", () => {
  const files = { ...engineFiles("linux", "amd64"), latest: `{\n  "tag_name": "v${V}",\n  "name": "v${V}"\n}\n` };
  const sb = sandbox({ files });
  const r = sb.run([]);
  assert.equal(r.status, 0, out(r));
  assert.match(sb.calls(), /api\.github\.com\/repos\/RajaSardar\/kubebay\/releases\/latest/);
  assert.match(sb.calls(), new RegExp(`download/v${V}/kubebay-linux-amd64`));
});

test("works with wget when curl isn't installed (a stock Ubuntu desktop)", () => {
  const sb = sandbox({ files: engineFiles("linux", "amd64"), downloader: "wget" });
  const r = sb.run([`v${V}`]);
  assert.equal(r.status, 0, out(r));
  assert.match(sb.calls(), /^wget /m);
  assert.ok(existsSync(join(sb.installed, "kubebay")));
});

test("without KUBEBAY_INSTALL_DIR a normal user gets ~/.local/bin, and is told to add it to PATH", () => {
  const sb = sandbox({ files: engineFiles("linux", "amd64") });
  const r = sb.run([`v${V}`], { KUBEBAY_INSTALL_DIR: "" });
  assert.equal(r.status, 0, out(r));
  assert.ok(existsSync(join(sb.home, ".local/bin/kubebay")));
  assert.match(out(r), /PATH/);
});

const deb = `Kubebay_${V}_amd64.deb`;
const appimage = `Kubebay_${V}_amd64.AppImage`;
const desktopFiles = () => ({
  [deb]: "deb-bytes", [`${deb}.sha256`]: `${sha("deb-bytes")}  ${deb}\n`,
  [appimage]: "appimage-bytes", [`${appimage}.sha256`]: `${sha("appimage-bytes")}  ${appimage}\n`,
});

test("--desktop on Ubuntu installs the .deb through apt with sudo, so apt pulls in WebKitGTK", () => {
  const sb = sandbox({ files: desktopFiles(), apt: true });
  const r = sb.run(["--desktop", `v${V}`]);
  assert.equal(r.status, 0, out(r));
  assert.match(sb.calls(), new RegExp(`sudo apt-get install -y \\S*/${deb.replace(/\./g, "\\.")}`));
  assert.doesNotMatch(sb.calls(), /dpkg -i/);
  assert.match(out(r), /Kubebay/);
});

test("--desktop as root needs no sudo", () => {
  const sb = sandbox({ uid: 0, files: desktopFiles(), apt: true, sudo: false });
  const r = sb.run(["--desktop", `v${V}`]);
  assert.equal(r.status, 0, out(r));
  assert.match(sb.calls(), /^apt-get install -y /m);
  assert.doesNotMatch(sb.calls(), /sudo/);
});

test("--desktop refuses a .deb whose checksum doesn't match, before apt sees it", () => {
  const files = { ...desktopFiles(), [`${deb}.sha256`]: `${sha("evil")}  ${deb}\n` };
  const sb = sandbox({ files, apt: true });
  const r = sb.run(["--desktop", `v${V}`]);
  assert.notEqual(r.status, 0);
  assert.match(out(r), /checksum/i);
  assert.doesNotMatch(sb.calls(), /apt-get/);
});

test("--desktop with --appimage (or no apt) installs the AppImage and a menu entry", () => {
  const sb = sandbox({ files: desktopFiles() });
  const r = sb.run(["--desktop", "--appimage", `v${V}`]);
  assert.equal(r.status, 0, out(r));
  const app = join(sb.installed, "kubebay-desktop");
  assert.equal(readFileSync(app, "utf8"), "appimage-bytes");
  assert.ok(statSync(app).mode & 0o111);
  const entry = readFileSync(join(sb.home, ".local/share/applications/kubebay.desktop"), "utf8");
  assert.match(entry, new RegExp(`Exec=${app.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`));
  // The AppImage needs FUSE 2 on Ubuntu 22.04 and later; say so.
  assert.match(out(r), /libfuse2/);
});

test("--desktop on arm64 Linux says the desktop app is x86_64 only and points at the engine", () => {
  const sb = sandbox({ arch: "aarch64", files: desktopFiles(), apt: true });
  const r = sb.run(["--desktop", `v${V}`]);
  assert.notEqual(r.status, 0);
  assert.match(out(r), /x86_64/);
  assert.match(out(r), /without --desktop/);
  assert.equal(sb.calls(), "");
});

test("--desktop on a Mac points at install-mac.sh", () => {
  const sb = sandbox({ os: "Darwin", arch: "arm64", files: desktopFiles() });
  const r = sb.run(["--desktop", `v${V}`]);
  assert.notEqual(r.status, 0);
  assert.match(out(r), /install-mac\.sh/);
});

test("rejects an option it doesn't know", () => {
  const sb = sandbox({ files: engineFiles("linux", "amd64") });
  const r = sb.run(["--frobnicate"]);
  assert.notEqual(r.status, 0);
  assert.match(out(r), /--frobnicate/);
  assert.equal(sb.calls(), "");
});

// The documented one-liner downloads install.sh from the release, so the
// release has to publish it, next to install-mac.sh.
test("the release workflow publishes install.sh", () => {
  const wf = readFileSync(join(here, "..", ".github/workflows/release.yml"), "utf8");
  assert.match(wf, /cp scripts\/install\.sh dist\/install\.sh/);
});

// Backlog 58: the README is where most people land, so it carries the whole
// install story, and no install doc points at a release that doesn't exist.
test("the README's Install section covers every platform and the Linux one-liner", () => {
  const readme = readFileSync(join(here, "..", "README.md"), "utf8");
  const start = readme.search(/^## Install\b/m);
  assert.ok(start >= 0, "README.md has no '## Install' section");
  const next = readme.slice(start + 1).search(/^## /m);
  const install = readme.slice(start, next < 0 ? undefined : start + 1 + next);
  for (const h of ["macOS", "Linux", "Windows", "Helm", "source"]) {
    assert.match(install, new RegExp(`^###.*${h}`, "mi"), `no ### heading for ${h}`);
  }
  assert.match(install, /releases\/latest\/download\/install\.sh \| sh -s -- --desktop/);
  assert.match(install, /releases\/latest\/download\/install\.sh \| sh\n/);
  assert.match(install, /releases\/latest\/download\/install-mac\.sh \| bash/);
  assert.match(install, /sudo apt install \.\/Kubebay_/);
  assert.doesNotMatch(install, /dpkg -i/);
  // The Homebrew formula is the engine; it doesn't install the desktop app.
  assert.doesNotMatch(readme, /Install the desktop app:\s*```bash\s*brew install/);
});

test("no install doc downloads from a hard-coded old release", () => {
  for (const f of ["README.md", "docs/INSTALL.md", "website/src/content/docs/install.md"]) {
    const text = readFileSync(join(here, "..", f), "utf8");
    assert.doesNotMatch(text, /releases\/download\/v\d+\.\d+\.\d+\//, `${f} pins a download to one release`);
    // shasum isn't on a stock Ubuntu; every shasum check offers sha256sum too.
    if (/shasum -a 256 -c/.test(text)) assert.match(text, /sha256sum -c/, `${f} checks with shasum only`);
  }
});

