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
    // Local, git-ignored scratch of the Frontlights flow (collectors output, screenshots, throwaway scripts).
    ".frontlights/**",
    // Node scripts (CommonJS, run by hand against the live project): not part of the app.
    "scripts/**/*.cjs",
  ]),
]);

export default eslintConfig;
