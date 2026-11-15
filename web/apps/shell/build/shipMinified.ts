import { transformWithEsbuild, type Plugin } from "vite";

/**
 * The shell ships unminified, with source maps, so its own code is debuggable
 * in the field. A third-party package nobody debugs here doesn't need either:
 * this minifies the chunks made only of `pkg`'s code and drops their maps.
 */
export function shipMinified(pkg: string): Plugin {
  const own = (id: string) => id.includes(`/node_modules/${pkg}/`);
  return {
    name: `kubebay:ship-minified:${pkg}`,
    apply: "build",
    async generateBundle(_options, bundle) {
      for (const out of Object.values(bundle)) {
        if (out.type !== "chunk") continue;
        // "\0" ids are the bundler's own glue (Vite's preload helper), not app code.
        const modules = out.moduleIds.filter((id) => !id.startsWith("\0"));
        if (modules.length === 0 || !modules.every(own)) continue;
        const min = await transformWithEsbuild(out.code, out.fileName, { minify: true, sourcemap: false });
        out.code = min.code.replace(/\n\/\/# sourceMappingURL=\S+\s*$/, "\n");
        out.map = null;
        delete bundle[`${out.fileName}.map`];
      }
    },
  };
}
