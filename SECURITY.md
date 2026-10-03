# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Report it privately via
GitHub: <https://github.com/Oluiy/aggregator/security/advisories/new>

Include what you found, how to reproduce it, and the impact. You'll get an acknowledgement
and a fix or a decision as soon as I can manage - this is a one-maintainer project, so
please be patient.

## What counts

buildquick runs entirely on your machine and sends nothing anywhere. The things worth
reporting are the ones that could harm the person running it:

- **Secret leakage:** `check` printing a credential or key value instead of masking it.
  Findings are meant to show only `file:line` and a redacted line.
- **Unsafe file writes:** scaffolding (`buildquick` with no arguments) writing outside the
  target directory, for example through a crafted project name.
- **Unintended code execution:** the graded lessons run `node --test` or `cargo` against
  code *you* write in a lesson file. Anything that runs code you didn't write, or that
  escapes that scope, is a vulnerability.
- **Path traversal or crashes** from reading a hostile repository with `check`.

## Not in scope

A missed finding (a false negative) or a wrong finding (a false positive) is a normal bug,
not a vulnerability - please open a regular issue. `check` is a set of text heuristics and
says so in its output; it is not a substitute for a security audit.

## Supported versions

Only the latest release receives fixes.
