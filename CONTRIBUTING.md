# Contributing

Issues and pull requests are welcome. Keep changes small and focused.

## Setup

```bash
npm i
npm run dev      # http://127.0.0.1:3000
```

Node.js 22.13 or newer. Google Chrome is needed only for the noon and SHEIN stores.

## Checks

```bash
npm run qa       # lint, strict lint, typecheck, tests, knip
npm run build
```

Tests are offline (vitest, store answers from `tests/fixtures/` and `eval/recorded/`). Add
fixture tests under `tests/sites/` for adapter changes. See [docs/QA.md](docs/QA.md).

## Eval

For any change to matching, ranking or grouping, run the offline eval before and after:

```bash
node scripts/eval.mjs
node scripts/eval-groups.mjs
```

Keep a change only when no query set gets worse, and add the round to `eval/RESULTS.md`. The
eval scripts rewrite `eval/last-run.json`; restore it if you did not mean to update it.
`scripts/eval-record.mjs` contacts the live stores: use it sparingly and never in CI.

## Commits

- One logical change per commit, with a short imperative subject (`noon: retry after warm-up`,
  `match: drop watch bands for watch queries`), optionally prefixed by the area.
- Explain the why in the body when it is not obvious.
- Never commit `.env*` files, tokens, Chrome profiles or `.aa-home*/`.

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
