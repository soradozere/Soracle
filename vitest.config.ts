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
    // A bare "node_modules" glob only matches the root install, so nested ones were still
    // walked. That pulled in two unrelated sets of files:
    //   - package-internal tests shipped inside dependencies. @use-gesture/react ships a
    //     types.test.ts importing `tsd`, which isn't installed: three hard failures.
    //   - the git worktrees under .claude/, which are full checkouts of other branches, so
    //     every project test ran a second time against a stale copy of itself.
    // The recursive glob below covers nested installs; excluding .claude keeps other
    // branches' checkouts out of this branch's suite.
    exclude: ["**/node_modules/**", ".claude/**", ".next/**", "jk2mv/**"],
  },
})
