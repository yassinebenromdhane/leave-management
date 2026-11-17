// Bundles the server (and the TypeScript source of @leave/shared) into dist/.
// Everything is bundled except native modules (NATIVE_EXTERNALS), which the runtime image
// installs on its own (see Dockerfile). Keep the two lists in sync.
export const NATIVE_EXTERNALS = ["@node-rs/argon2"];
import { build } from "esbuild";

await build({
  entryPoints: { index: "src/index.ts", migrate: "src/db/migrate.ts", seed: "src/db/seed.ts" },
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
  external: NATIVE_EXTERNALS,
  logLevel: "info",
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});
