# Architecture Decision Records (ADR)

This directory contains completed architecture decisions and implementation plans that have been executed.

## Format

Each file follows the naming convention: `NNN-short-title.md`

Files are promoted here from `/plans/` when the corresponding implementation is complete and merged.

Each ADR should end with a `## Outcome` section describing what was implemented and linking the relevant PR(s).

ADR 017 records the Edge self-health machine API (`GET /api/v0/health.json`)
as distinct from Rails health consumption (ADR 016) and from operational
`text/plain` probes.

Some ADRs may record an accepted architecture boundary before implementation.
Those records should state that implementation is deferred in their `## Outcome`
section.
