// Stricter, type-aware lint pass, run by `npm run lint:strict` (and `npm run qa`).
// The default `eslint.config.mjs` stays as the everyday Next.js pass; this one adds
// typescript-eslint strict-type-checked, eslint-plugin-security and eslint-plugin-redos (registered
// in the base config) over the app's own code.
// Every rule option below is a deliberate, documented choice (see docs/QA.md).
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import security from "eslint-plugin-security";
import base from "./eslint.config.mjs";

export default defineConfig([
  ...base,
  // Plain-JS tooling (eval scripts, spike prototypes, config files) is not type-checked.
  globalIgnores(["scripts/**", "eval/**", "*.mjs", "*.config.ts"]),
  // A suppression whose problem is gone fails the pass, so stale ones do not pile up.
  { linterOptions: { reportUnusedDisableDirectives: "error" } },
  {
    files: ["app/**/*.{ts,tsx}", "src/**/*.ts", "tests/**/*.ts", "instrumentation.ts"],
    extends: [tseslint.configs.strictTypeChecked, security.configs.recommended],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Style only: `onClick={() => setOpen(false)}` is idiomatic React.
      "@typescript-eslint/no-confusing-void-expression": ["error", { ignoreArrowShorthand: true }],
      // Numbers in template strings are intended (prices, counts, ports).
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      // Reviewed hit by hit (task-18 report): every flagged `obj[key]` is an array index, a key
      // from a closed union/Record type, or an `Object.hasOwn`-guarded lookup; none writes a
      // user-controlled key into a shared object. The rule has no type information, so it flags
      // every bracket access; prototype-pollution sinks are covered by the review, not this rule.
      "security/detect-object-injection": "off",
      // Replaced by redos/no-vulnerable below: detect-unsafe-regex is a star-height heuristic
      // (33 hits, 29 of them linear per recheck); redos runs the recheck analyser itself and
      // reports only regexes with an attack string. Exponential backtracking always fails the
      // pass. Quadratic (2nd degree) is permitted: every regex runs on a store title (cut to
      // MAX_TITLE = 1000 chars in src/lib/pipeline.ts) or a query (capped at 200 chars by the
      // route), where the worst measured case is a few ms. The quadratic "\s*-?\s*" patterns that
      // were cheap to make linear were rewritten (task 18).
      "security/detect-unsafe-regex": "off",
      // ignoreErrors false: a regex recheck cannot analyse (or a timeout) fails the pass instead of
      // being skipped silently. The timeout is per regex: group.ts FOR_BRAND (linear) needs about
      // 7 s on its own, so 10 s timed out under lint load; 30 s leaves headroom. If a slow machine
      // still times out, raise it rather than turning ignoreErrors back on.
      "redos/no-vulnerable": ["error", { timeout: 30000, permittableComplexities: ["polynomial"], ignoreErrors: false }],
      // Off after a hit-by-hit review (task-18 report, 34 hits): without noUncheckedIndexedAccess
      // (trialled, not adopted) TypeScript types array/regex-group/Map reads and parsed JSON,
      // DOM and DB values as always present, so the rule asks to delete guards that protect
      // against real runtime undefined (regex groups, store payloads, request bodies).
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  {
    // Test doubles implement async interfaces without awaiting, and tests assert on values
    // they have just checked exist; both rules only add noise there.
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "security/detect-non-literal-fs-filename": "off",
      // vitest's asymmetric matchers (expect.any, objectContaining) and mock.calls are typed any,
      // and tests wrap fake deps' methods on purpose.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
]);
