/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// Backlog #21: a copy-name button for every kind. Every resource opens in a
// Drawer, so every Drawer the shell renders passes the name to copy.

const SRC = resolve(__dirname, "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "__tests__" ? [] : files(p);
    return p.endsWith(".tsx") && !p.endsWith(".test.tsx") ? [p] : [];
  });
}

/** Each `<Drawer …>` opening tag's props: up to the first `>` outside braces, so `onClose={() => …}` doesn't end it. */
function drawerTags(src: string): string[] {
  const tags: string[] = [];
  for (const m of src.matchAll(/<Drawer\b/g)) {
    let depth = 0;
    let i = m.index! + m[0].length;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    tags.push(src.slice(m.index! + m[0].length, i));
  }
  return tags;
}

describe("every drawer", () => {
  it("offers to copy the name of what it shows", () => {
    const missing: string[] = [];
    for (const f of files(SRC)) {
      const src = readFileSync(f, "utf8");
      for (const props of drawerTags(src)) {
        if (!/\bcopyName=/.test(props)) missing.push(`${relative(SRC, f)}: <Drawer ${props.trim().split("\n")[0]}…`);
      }
    }
    expect(missing).toEqual([]);
  });
});
