# 2026-09-03 Astro Rails entries boundary

Completed offline verification for the Rails entries data-access boundary in all twelve Astro content units.

- `pnpm --dir <unit> run test -- rails-entries.test.ts` passed for app/com/org × docs/help/info/news; each run used injected fake `RailsClient` results and made no Rails or Workers VPC connection.
- `pnpm --dir <unit> run typecheck` passed for all twelve units.
- `pnpm --dir <unit> run build` passed for all twelve units with `CLOUDFLARE_ENV=`; no VPC mode was enabled.
- `pnpm run check:architecture`, targeted `oxfmt --check`, and `git diff --check` passed.

Live integration: BLOCKED — Workers VPC unavailable on 2026-09-03. No live VPC/Rails connectivity test was run.
