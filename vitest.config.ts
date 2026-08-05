import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

/*
 * Vitest needs the same `@/` alias the app is written against.
 *
 * Without it, the only files that could be tested were the ones that happened
 * to import nothing but relative paths -- which is why the suite sat on two
 * modules for so long. Anything reaching for `@/lib/...` failed at import with
 * "Cannot find package", which reads like a missing dependency rather than a
 * missing config, so it looked like those modules were untestable.
 *
 * Mirrors the single `@/* -> ./*` mapping in tsconfig.json. Kept as the one
 * source of truth for the runner; if the tsconfig path ever gains a second
 * entry, this needs it too.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**", "jk2mv/**"],
  },
})
