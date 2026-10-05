# Contributing to buildquick

Thanks for helping. The most valuable contribution is a **false positive**: a finding
`buildquick check` reported that was wrong. Precision is this project's top priority -
a checker that cries wolf gets uninstalled.

## Set up

```bash
git clone https://github.com/Oluiy/aggregator
cd aggregator
npm install
npm run dev -- check path/to/a/repo   # run from source
npm run verify                        # typecheck + all tests; must pass before a PR
```

Requires Node 18 or newer.

## Reporting a false positive

Open an issue with: the rule id (e.g. `http-without-timeout`), the file and line it
flagged, and why it is wrong. A link to a public repo is ideal; otherwise paste the
smallest snippet that reproduces it. **Never paste real secrets** - `check` masks them in
its output, but check the text before posting.

## Changing or adding a rule

Rules live in `src/check/`. A rule change is not done until:

1. **A test proves what it must still catch**, not just what it now skips. Every
   false-positive fix needs both: the bad case is silent, and a real case still fires.
   Tests are in `src/check/check.test.ts`.
2. **`npm run verify` passes.**
3. **You've run it on real code.** Point `check` at two or three real repos in different
   stacks and read the source of every new finding. If you keep a corpus of repos,
   `npm run corpus` diffs today's findings against a saved baseline (see
   `corpus/README.md`); give every new `+` line a verdict from the source.

Unit tests prove a rule works on examples written to make it work. Only real code shows
where it is wrong.

## Adding a lesson or concept

Lessons and concepts are content, not code, and live under `content/` and
`src/concepts*`. Each lesson ships a starter that must fail and a reference fix that must
pass - the test suite enforces this.

## Pull requests

- Keep one change per PR, and say why in the description.
- Match the surrounding code's style; there is no separate formatter step.
- Don't commit generated output (`dist/`) or any real credentials.

## License

By contributing you agree that your contribution is licensed under the project's
[MIT License](LICENSE).
