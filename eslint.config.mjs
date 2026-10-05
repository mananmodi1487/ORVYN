import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Additional build output and caches.
    "node_modules/**",
    "coverage/**",
    // Agent Manager worktrees and session state live under `.kilo/`. They are
    // separate checkouts with their own `node_modules` and `.next`; linting them
    // would report thousands of errors from files this repo does not own.
    ".kilo/**",
  ]),
]);

export default eslintConfig;
