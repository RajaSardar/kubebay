import type { Plugin, Rollup } from "vite";

/**
 * Fails the build if any of `pkg`'s code can be reached from an entry through
 * static imports, which would load it on every page instead of when it's first
 * needed. Rollup can pull a package into the startup graph without anyone
 * importing it there, through a helper module both share.
 */
export function staysLazy(pkg: string): Plugin {
  const own = (id: string) => id.includes(`/node_modules/${pkg}/`);
  return {
    name: `kubebay:stays-lazy:${pkg}`,
    apply: "build",
    generateBundle(_options, bundle) {
      const chunks = new Map<string, Rollup.OutputChunk>();
      for (const out of Object.values(bundle)) if (out.type === "chunk") chunks.set(out.fileName, out);
      for (const entry of chunks.values()) {
        if (!entry.isEntry) continue;
        const path = new Map<string, string[]>([[entry.fileName, [entry.fileName]]]);
        const queue = [entry.fileName];
        while (queue.length) {
          const name = queue.shift()!;
          const c = chunks.get(name);
          if (!c) continue;
          if (c.moduleIds.some(own)) {
            this.error(`${pkg} is loaded at startup: ${path.get(name)!.join(" → ")} (static imports). Keep it behind a dynamic import.`);
          }
          for (const next of c.imports) {
            if (path.has(next)) continue;
            path.set(next, [...path.get(name)!, next]);
            queue.push(next);
          }
        }
      }
    },
  };
}
