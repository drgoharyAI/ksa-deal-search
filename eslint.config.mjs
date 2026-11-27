import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import security from "eslint-plugin-security";
import redos from "eslint-plugin-redos";

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
    // Local-only, gitignored folders: Chrome profiles, api-anything homes, agent tooling,
    // eval dumps. Linting them reported thousands of hits in Chrome's own bundled JS.
    ".noon-profile*/**",
    ".aa-home*/**",
    ".superpowers/**",
    ".claude/**",
    "eval/dump/**",
  ]),
  {
    // The stricter pass (eslint.strict.config.mjs) enables these plugins' rules; they are only
    // registered here so inline `eslint-disable` comments naming them resolve. Unused-directive
    // checks run in the strict pass, where every suppressed rule is on.
    plugins: { security, redos },
    linterOptions: { reportUnusedDisableDirectives: "off" },
  },
]);

export default eslintConfig;
