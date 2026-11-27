# QA: static checks, scanners and how to run them

Two kinds of checks: the repo-local ones (`npm run qa`, all from `devDependencies`, no network)
and external scanners (Semgrep, gitleaks, osv-scanner, npm audit) that are installed outside the
repo. Task 18 (2026-11-27) ran all of them on the whole codebase; the findings and what was done
with each are in `.superpowers/sdd/2026-11-27-deal-search/task-18-report.md` (local notes).

## Repo-local: `npm run qa`

Runs, in order, and stops at the first failure:

| step | command | what it checks |
|---|---|---|
| `npm run lint` | `eslint` (`eslint.config.mjs`) | the everyday Next.js pass (core-web-vitals + typescript) |
| `npm run lint:strict` | `eslint -c eslint.strict.config.mjs` | typescript-eslint `strictTypeChecked`, `eslint-plugin-security`, `eslint-plugin-redos` on `app/`, `src/`, `tests/` (type-aware, slower: about 1 min) |
| `npm run typecheck` | `tsc --noEmit` | the TypeScript compile |
| `npm test` | `vitest run` | unit and route tests |
| `npm run knip` | `knip` (`knip.json`) | unused files, exports, types and dependencies |

Also keep green before a merge: `npm run build`, and when matching code changes, the offline eval
(`node scripts/eval.mjs`, `node scripts/eval-groups.mjs`; see README "Evaluating changes").
The eval scripts rewrite `eval/last-run.json`; restore it if you did not mean to update it.

### Strict lint policy

- Rule options and the rules turned off are explained in `eslint.strict.config.mjs` itself. In
  short: `security/detect-object-injection` is off (it flags every bracket access; reviewed by
  hand), `security/detect-unsafe-regex` is replaced by `redos/no-vulnerable` (a real ReDoS
  analyser, recheck), and `@typescript-eslint/no-unnecessary-condition` is off because, without
  `noUncheckedIndexedAccess`, it asks to delete guards on regex groups, store payloads and request
  bodies that really can be undefined.
- ReDoS: exponential backtracking fails the pass. Quadratic (2nd degree) regexes are allowed
  because their inputs are bounded: store titles are cut to `MAX_TITLE` (1,000 characters) in
  `src/lib/pipeline.ts` and queries to 200 characters by the route. Prefer linear forms anyway:
  write `\s*(?:-\s*)?`, never `\s*-?\s*` (two whitespace runs that can split the same spaces).
- A false positive gets an inline `// eslint-disable-next-line <rule> -- <reason>`, never a
  file- or folder-wide disable. The strict pass reports unused disable comments as errors, so a
  stale suppression has to be removed.
- `noUncheckedIndexedAccess` was trialled (187 errors, 41 of them in the eval-tuned
  `src/lib/match/group.ts`) and not adopted; re-try it when that code is next reworked.

## External scanners

Install these outside the repo (they are not npm dependencies). Paths below are examples.

### Semgrep (SAST)

```sh
python -m venv ~/qa-venv && ~/qa-venv/bin/pip install semgrep      # Windows: qa-venv\Scripts\
semgrep scan --metrics=off \
  --config p/typescript --config p/javascript --config p/nextjs --config p/react \
  --config p/nodejs --config p/security-audit --config p/secrets --config p/owasp-top-ten \
  --exclude eval/recorded --exclude eval/dump --exclude .claude .
```

On Windows set `PYTHONUTF8=1` first. Suppress a reviewed false positive on the line above it:
`// nosemgrep: <rule id> -- <reason>`. A "PartialParsing" warning on the Dockerfile is a parser
limit, not a finding.

### gitleaks (secrets)

Download the release binary from github.com/gitleaks/gitleaks/releases and check its SHA-256
against the release's `checksums.txt`.

```sh
gitleaks git . --redact          # the full git history
gitleaks dir . --redact          # the working tree, including gitignored files
```

`.gitleaks.toml` keeps the default rules and skips gitignored local folders (Chrome profiles,
api-anything homes, `.next`, eval dumps). `.gitleaksignore` lists fingerprints of reviewed false
positives; `// gitleaks:allow` marks one line. `.env.local` is deliberately not skipped: the
working-tree scan reports the local Telegram token (gitignored, never committed) as a reminder.
Always use `--redact` so values are never printed.

### osv-scanner and npm audit (dependencies)

```sh
osv-scanner scan source -L package-lock.json     # release binary from github.com/google/osv-scanner
npm audit --omit=dev                             # production dependencies
npm audit                                        # everything
```

### Optional: ReDoS check of one regex

`eslint-plugin-redos` already runs recheck in `npm run lint:strict`. To inspect one regex (its
complexity and attack string), call `require("recheck").checkSync(source, flags)` from a scratch
script; `recheck` is installed with the plugin.
