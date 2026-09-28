/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";

// Every rendition of the Kubebay mark (favicons, app icons, the website) uses
// the same cyan→green gradient as KubebayMark in @kubebay/ui.
const root = resolve(__dirname, "../../../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const brand = read("web/packages/ui/src/brand.tsx");
const CYAN = /BRAND_CYAN = "(#[0-9a-f]{6})"/.exec(brand)![1]!;
const GREEN = /BRAND_GREEN = "(#[0-9a-f]{6})"/.exec(brand)![1]!;

const stops = (svg: string) => [...svg.matchAll(/stop-color=['"]([^'"]+)['"]/g)].map((m) => m[1]!.toLowerCase());

/** Decodes an 8-bit, non-interlaced RGB or RGBA PNG into rows of [r, g, b, a]. */
function decodePng(buf: Buffer) {
  let pos = 8;
  let width = 0, height = 0, channels = 4;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect({ depth: data[8], interlace: data[12] }).toEqual({ depth: 8, interlace: 0 });
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      expect(channels).toBeGreaterThan(0);
    }
    if (type === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]!;
      const a = x >= channels ? out[y * stride + x - channels]! : 0;
      const b = y > 0 ? out[(y - 1) * stride + x]! : 0;
      const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels]! : 0;
      const p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      out[y * stride + x] = (v + [0, a, b, (a + b) >> 1, paeth][filter]!) & 0xff;
    }
  }
  const px = (x: number, y: number) => {
    const i = y * stride + x * channels;
    return [out[i]!, out[i + 1]!, out[i + 2]!, channels === 4 ? out[i + 3]! : 255];
  };
  return { width, height, px };
}

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const near = (px: number[], rgb: number[], tol: number) => rgb.every((v, i) => Math.abs(px[i]! - v) <= tol);

describe("brand assets match KubebayMark", () => {
  it("the shell's SVG favicon uses the mark's gradient", () => {
    const html = decodeURIComponent(/rel="icon"\s+href="data:image\/svg\+xml,([^"]+)"/.exec(read("web/apps/shell/index.html"))![1]!);
    expect(stops(html)).toEqual([CYAN, GREEN]);
  });

  it("the web manifest splash matches the default theme (Dawn)", () => {
    const tokens = read("web/packages/ui/src/tokens.css");
    const dawn = /:root\[data-theme="dawn"\]\s*\{[^}]*--kb-theme-color:\s*(#[0-9a-f]{6})/.exec(tokens)![1]!;
    const manifest = JSON.parse(read("web/apps/shell/public/manifest.json"));
    expect([manifest.background_color, manifest.theme_color]).toEqual([dawn, dawn]);
  });

  it("the README badge uses the brand cyan", () => {
    expect(read("README.md")).toMatch(new RegExp(`color=${CYAN.slice(1)}\\)`));
  });

  it("the website favicon is the mark, not a separate logo", () => {
    expect(stops(read("website/public/favicon.svg"))).toEqual([CYAN, GREEN]);
  });

  it.each([
    "web/apps/shell/public/favicon-16.png",
    "web/apps/shell/public/favicon-32.png",
    "web/apps/shell/public/apple-touch-icon.png",
    "web/apps/shell/public/icon-192.png",
    "web/apps/shell/public/icon-512.png",
    "desktop/src-tauri/icons/32x32.png",
    "desktop/src-tauri/icons/128x128.png",
    "desktop/src-tauri/icons/128x128@2x.png",
    "desktop/src-tauri/icons/icon.png",
  ])("%s starts cyan and ends green", (file) => {
    const { width, height, px } = decodePng(readFileSync(resolve(root, file)));
    // Sample just inside the rounded corners, on the diagonal the gradient runs along.
    const at = (f: number) => px(Math.round(width * f), Math.round(height * f));
    const tol = width <= 32 ? 40 : 24;
    expect({ file, topLeft: near(at(0.2), hex(CYAN), tol) }).toEqual({ file, topLeft: true });
    expect({ file, bottomRight: near(at(0.8), hex(GREEN), tol) }).toEqual({ file, bottomRight: true });
  });
});
