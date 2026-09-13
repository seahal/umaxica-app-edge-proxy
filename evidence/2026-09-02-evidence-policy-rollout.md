# evidence/ convention rollout

## What was being verified

That the newly added `evidence/` layout check works in this repository - that it passes on the
current tree, that it actually fails when the layout is wrong, and that adding it does not break
any check this repository already runs.

## Why

`evidence/` was introduced across this workspace as a flat, Git-tracked record of verification that
was actually performed. The structural rules (flat, `.md` only, `YYYY-MM-DD-<topic>.md`) are only
worth stating if something enforces them, so the check and this record were produced together. This
file is also the first record under the new convention, which means it is its own first test case:
the check has to accept this file's own name.

## Context

- Repository: `umaxica-apps-edge`
- Revision at time of check: `25c19d4f` (feature)
- Host: Linux, node v24.20.0, pnpm 12.2.1, ruby 4.0.6, cargo 1.98.0, bun 1.4.0
- Date: 2026-09-02

## What was added

- `test/evidence-layout.test.ts`
- Wired in via: no wiring needed - the root `pnpm run test` already runs `vitest run --dir test` over the repository-invariant suite, which is gated by the `test` job in `.github/workflows/integration.yaml` and by lefthook pre-push.
- An `Evidence` section in `AGENTS.md`.

## Rules enforced

1. `evidence/` contains no subdirectories.
2. Every direct child is a regular file ending in `.md`.
3. Every filename matches
   `^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])-[a-z0-9]+(-[a-z0-9]+)*\.md$`.

A missing `evidence/` directory is deliberately not a failure, so the check is a no-op until the
directory exists.

## Commands run and what was observed

| Command                                                | Observed                                          |
| ------------------------------------------------------ | ------------------------------------------------- |
| `pnpm exec vitest run --dir test`                      | Test Files 13 passed (13); Tests 405 passed (405) |
| `pnpm exec oxfmt --check test/evidence-layout.test.ts` | exit 0                                            |

## Shared-logic verification

The same rule set exists in five forms across this workspace (Node script, POSIX shell, Vitest,
Minitest, Rust). Before distribution, the Node and shell forms were run against one fixture
directory containing every failure mode at once - a subdirectory, `notes.txt`, `report.pdf`,
`2026-9-2-x.md`, `2026-13-01-x.md`, `2026-09-32-x.md`, `Sep-02-2026-x.md`, `2026-09-02-Topic.md`,
`2026-09-02-.md`, `2026-09-02-a--b.md`, plus one valid record. Both reported exactly the same 10
violations and exited 1; both exited 0 on a valid-only directory and on a missing directory. The
Rust form pins the same accept/reject set in `record_name_rules_are_what_they_claim`.

## Assessment

PASS. The check passes on the current tree and every pre-existing check that could be run in
this environment still passes. No pre-existing behaviour was changed.

## Limitations

The invariant suite was 12 files before this change and is 13 after; all 405 tests pass. The file
was placed in `test/` rather than added to `check:static` deliberately: `test/` is where this
repository already keeps filesystem invariants (`deployment-unit-boundaries.test.ts`,
`package-manager-invariants.test.ts`), so no package.json, CI or hook edit was required.

This repository's formatter also owns Markdown, so evidence records are subject to it: this file
had to be run through `pnpm run format:check` (oxfmt) before that gate passed. Future records land the same way -
write the record, then let the formatter reflow it.

Nothing was committed; the change is left in the working tree. This record covers the layout check
only - whether any given evidence record is honest is not mechanically checkable and remains a
review question.
