# The UMAXICA Edge UI shell contract

**Status: normative.** This document is the shared definition of the application
shell for every Edge deployment unit that serves HTML. Read it against the unit
you are editing before you change a shell file.

It is prose on purpose. The Edge tier shares no UI code — every unit owns its own
copy of its shell, stylesheet, theme and i18n config — so there is no
module whose signature would break when two units disagree. What holds them
together is this document plus each unit's own shell-contract test, and neither
replaces the other: the tests prove a unit does what it says, this document says
what all of them are supposed to do and why.

"Each unit's own test" is not one file name. The fifteen TanStack Start frames
assert this contract in `test/ui-shell-contract.test.tsx`, by driving a real
router and asserting on the document it emits; the five apex Workers assert it in
`api/ui-shell-contract.hurl`, by XPath over a real response. Both make the same assertions — landmarks, document
order, accessible names, which destinations are reachable, and no CSS class in
sight — and neither is the archetype cutting a corner.

apex is in the other layer on purpose, and the reason is worth keeping because
it looks like an inconsistency until you read it. AGENTS.md puts assertions
about a **response** in Hurl and assertions about **internal logic** in Vitest.
A frame's shell is a router this repository can render in-process, so it is
internal logic; an apex document only exists as a Worker response. `<HeadContent />`
reads router state, so a frame renders its paths through a real router in
`beforeAll` and asserts synchronously afterwards; that is a driver detail, not a
different layer. apex did have a
`test/ui-shell-contract.test.tsx` once, and it was deleted rather than kept —
reaching the document through happy-dom needed a regex that stripped
`<link rel="stylesheet">` out of the HTML before parsing, because happy-dom
would otherwise try to fetch it over a network no unit test has. XPath over a
real response needs none of that. **Do not "restore" the missing file.**

---

## 1. Scope

Normative for the 20 deployment units that serve HTML — every directory with a
`wrangler.jsonc` except `tools/vpc-probe`, which is a `probe.mjs` Worker with no
HTML surface.

| Archetype     | Units                                 | Runtime                        |
| ------------- | ------------------------------------- | ------------------------------ |
| **core**      | `{app,com,org}/core`                  | TanStack Start on Vite/workerd |
| **satellite** | `{app,com,org}/{docs,help,info,news}` | TanStack Start on Vite/workerd |
| **apex**      | `{app,com,dev,net,org}/apex`          | Hono JSX on Vite/workerd       |

Within an archetype the shell sources are byte-identical across `app`/`com`/`org`
(and `net`/`dev` for apex); only the TLD literal differs. Treat an archetype as
one thing: a change that applies to it applies to every unit in it.

`dev/apex` used to sit outside this contract: it had no `wrangler.jsonc` and no
shell, because it was a Vercel edge function that built HTML from template
literals. It moved onto Cloudflare Workers and the apex archetype, so it is now
inside the contract like the other four. `dev/acme`, the application that shared
the `.dev` domain, was deleted.

That move is why the count above is 20 rather than the 19 this document said
for a while: the table below has summed to 20 since `dev/apex` joined, and the
prose had not caught up. 15 frames + 5 apex Workers, and `tools/vpc-probe`
outside.

The one archetype difference worth reading before §15 is where each archetype
puts its failure documents: the satellites render theirs inside the root
document, so they carry the shell; the Cores render theirs outside a pathless
layout route, so they do not. `adr/013-frames-tanstack-start.md` records why that
split is allowed rather than a drift to fix.

## 2. Why the shell is duplicated

A unit that imports from a sibling cannot be extracted into its own repository.
`test/deployment-unit-boundaries.test.ts` enforces that, and every unit's
stylesheet states the working rule in its own header: _"Copy this file when the
rules change; do not import it from a sibling or a shared package."_

So duplication here is not debt. A shared UI package would couple twenty
independently deployed Workers to one release, which is a larger problem than
three copies of a footer. **The thing to avoid is not duplication — it is
duplication without a written reason.** That is what §8 is for.

This is also why Tailwind arrives as twenty `@theme` blocks rather than one
shared preset (§3a). Tailwind v4 keeps its theme in CSS, so there is nothing to
`extends` and nothing to hoist — the duplication has the same reason as the rest.

---

## 3. The AppShell

```text
<header>
  <div>                                           the width carrier (§9)
    <a href="/">UMAXICA</a>                       brand, never an <h1>
    <div>…</div>                                  actions: Menu / Search / Account
  </div>
</header>

<nav id="main-navigation" aria-label="…">…</nav>  only where the unit has one (§5)

<main>…</main>                                    exactly one, carries the <h1>
<aside>…</aside>                                  optional, complementary only (§6)

<footer>
  <nav aria-label="…">…</nav>                     utility navigation (§7)
  <p>…</p>                                        site identity (§7)
</footer>
```

Class attributes are omitted because they carry no structure any more: each of
those elements takes a list of Tailwind utilities, and which utilities is a
styling question the unit answers, not a contract this document sets.

The fence is `text` rather than `html` on purpose: `oxfmt` reformats embedded
HTML and would move the right-hand annotations onto lines of their own, where
they no longer say which element they annotate.

Required:

- Exactly one `<header>`, one `<main>` and one `<footer>` per document, in that
  source order. Layouts wrap `{children}` rather than supplying their own
  `<main>`, because every page already renders one and a second would break the
  landmarks.
- `<nav>` is a **sibling** of `<header>`, never nested inside it. Header and
  navigation are separate responsibilities: the header carries brand and global
  actions, the navigation carries movement inside the application. Keeping them
  apart is what lets a unit later become a desktop sidebar, a tablet rail or a
  mobile bottom bar without the header participating in that decision.
- The brand is an `<a href="/">`, never an `<h1>`. The document's single `<h1>`
  belongs to the page, inside `<main>`.
- ARIA never substitutes for a semantic element. Use `<nav>`, not
  `role="navigation"` on a `<div>`.

The `class` attributes above are illustrative, not normative — and as of the
Tailwind migration they no longer exist. Every visual rule is a utility now, so
a class list describes padding and colour rather than structure, and the shell
is defined by what it emits: the landmark set, the hierarchy, the accessible
names, and which destinations are reachable. The names that remain load-bearing
are the ones a test or another document can point at — `id="main-navigation"`,
and the `aria-label` on each `<nav>`.

Every `test/ui-shell-contract.test.tsx` was rewritten to match: it queries by
role, landmark, accessible name and document order, and asserts no CSS class at
all. That is a stricter test, not a looser one. The old assertions would fail
on a padding change while still passing if a `<nav>` lost its accessible name.

## 3a. Agreed libraries

Two libraries are fixed by decision, so that the archetypes cannot each answer
the same question differently. Neither is a licence to add more: a third library
is a decision, not a detail.

| Concern                                                                 | Library                                                | Where it is installed            |
| ----------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------- |
| Visual styling — every colour, space, size and responsive rule          | **Tailwind CSS v4**, catalog `^4.3.3`                  | All twenty units that serve HTML |
| Interactive shell controls — disclosure, menu, dialog, focus management | **`react-aria-components`** (Adobe), catalog `^1.20.0` | All fifteen frames               |

**`react-aria-components` does not go into apex.** The five apex units run Hono
JSX and carry no React at all (`hono` and `@hono/structured-logger` are their
only dependencies), while the library peer-depends on `react` and `react-dom`.
Adding React to a Hono Worker would be a runtime change, not a library addition,
so apex keeps implementing the same interaction contract by hand. That is an
**allowed** archetype difference (§8), and it is the reason §4's disclosure
requirements are written as behaviour — `aria-expanded`, `aria-controls`,
button semantics — rather than as a component name: apex has to satisfy them
without the library.

### Tailwind goes everywhere, but never through a shared config

Tailwind v4 has no JavaScript config file: the theme is declared in CSS with
`@theme`, inside each unit's own stylesheet. That fits the extraction property
exactly — there is no root preset to inherit and nothing to `extends`. Each unit
owns:

- its own stylesheet carrying its own `@theme` block; and
- its own `@tailwindcss/vite` entry in its own `vite.config.ts`.

All twenty units build through Vite, so all twenty run `@tailwindcss/vite`. There
is no `postcss.config.mjs` anywhere and `@tailwindcss/postcss` is not installed:
there is no PostCSS pipeline anywhere for it to sit in. This
was not always true of apex either — `wrangler deploy` bundles the entrypoint and
copies `public/` byte for byte, so before Vite there was no bundler in that path
at all and those units compiled CSS with `@tailwindcss/cli` into a
`public/style.css` that could not carry a content hash. Vite emits the stylesheet
into the client build with a hash in its name,
which is what lets `public/_headers` mark it `immutable` — an unhashed asset is
revalidated on every document, because Cloudflare serves static assets as
`public, max-age=0, must-revalidate` unless the filename is fingerprinted.

`src/assets.ts` is the single place each unit names the resulting URL. The whole
`dist/` tree is gitignored, like the other generated artefacts in AGENTS.md.

**Do not introduce a shared Tailwind preset, a shared theme package or a root
Tailwind config.** The duplication is the same deliberate duplication as §2, and
`test/deployment-unit-boundaries.test.ts` enforces it.

### React Aria is `<Button>` here, not `<Disclosure>`

The Menu disclosure in `{app,com,org}/core/src/components/app-chrome.tsx` is the
first consumer, as this section anticipated, and their three `knip.jsonc`
suppressions are gone. It imports **`Button`** and keeps `aria-expanded` and
`aria-controls` explicit.

`<Disclosure>` / `<DisclosurePanel>` were evaluated and rejected, for a reason
that is worth recording because it will come up again. React Aria's disclosure
owns its panel's visibility: `useDisclosure` gives the collapsed panel
`hidden` on the server render and `aria-hidden` throughout, then swaps in
`hidden="until-found"` from an effect. §5 requires the navigation to be visible
above the breakpoint **with no JavaScript at all**, which is free today because
visibility is a media query. Handing the panel to the library would mean deriving
`isExpanded` from a client-side media query, so every desktop reader would
receive HTML in which the navigation is hidden and absent from the accessibility
tree until hydration finishes — and `aria-hidden` cannot be undone from CSS.

`Button` is still worth having: it renders a real `<button type="button">`,
normalises press across mouse, touch, pen and keyboard on the one control a
phone user taps, and publishes `data-hovered` / `data-pressed` /
`data-focus-visible`, which `tailwindcss-react-aria-components` turns into the
`hovered:` and `pressed:` variants. That plugin is installed only in the three
core units — the units that actually render a React Aria component.

The error-boundary reset buttons stay native `<button>`s everywhere. They
hand-maintain no keyboard, focus or ARIA behaviour for the library to take over,
and §1 of the decision hierarchy puts semantic HTML above a component library.

### `react-aria-components` is the only entry point

`react-aria-components` is built on `react-aria` and `react-stately`, which it
pins exactly (`3.51.0` and `3.49.0`) and imports at roughly 790 sites across 104
subpaths, down to internals like `react-aria/private/collections/BaseCollection`.
Those packages therefore exist in `pnpm-lock.yaml`, and that is fine — they are
Adobe's implementation of the library we chose, not a second library we picked.

**Our code never imports them.** Everything comes from `react-aria-components`
and nothing else in that family. Two things enforce it:

- No unit declares `react-aria`, `react-stately` or any `@react-aria/*`,
  `@react-stately/*`, `@react-types/*` or `@internationalized/*` package, so
  pnpm's strict layout already makes a direct import unresolvable from a unit.
- Each of the fifteen frames bans them by name in `.oxlintrc.json`, as a second
  `no-restricted-imports` pattern group alongside the `shared/` one. Verified to
  fire: importing `react-aria` fails `lint`, importing
  `react-aria-components` does not.

The one foreseeable exception is `@internationalized/date`, whose `CalendarDate`
is the value type `react-aria-components`' date components require. Nothing uses
those components today. If that changes, unban that single package here and in
the fifteen configs deliberately — do not work around the rule at a call site.

`react-aria-components` is installed across all fifteen frames up front,
ahead of any consumer, so that the first unit to build an interactive control
does not get to choose a different library. The three core units now import it;
the twelve satellites still do not, and each of those twelve keeps an
`ignoreDependencies` entry in its `knip.jsonc` naming it. Those entries are
placeholders for work not yet done: **delete the entry from a unit the moment
that unit gains its first consumer.** Verified that they are load-bearing rather
than decorative — knip reports the dependency as unused the moment the entry is
removed.

`tailwindcss` used to sit in the same list for a different reason — genuinely
used, but only from CSS (`@import 'tailwindcss'`), which knip could not see. It
can now that `.css` is in each unit's `project` globs, so the engine resolves
like any other import and that suppression is gone. The comment above each
remaining entry says why it is there.

## 4. Header

Brand on the left, linking to this FQDN's homepage. Actions on the right.

The actions slot is deliberately empty in the satellite and apex archetypes. A
control that toggles nothing is worse than no control, and those units have no
main navigation to toggle. The slot exists so Search, Preferences, Account and a
Menu disclosure have a defined home when those surfaces are built.

Where a menu exists it is a **disclosure**, so it is a `<button type="button">`,
not a link: it toggles content in place and navigates nowhere. It carries
`aria-expanded` reflecting its state and `aria-controls` pointing at the id of
the element it toggles.

Reference: `app/core/src/components/app-chrome.tsx` (the only client component the
shell needs — a disclosure has state; everything else stays a Server Component,
and labels arrive as plain strings so the dictionary is never shipped to the
browser).

## 5. Main navigation

Every entry must be a route the unit actually serves. The cautionary example is
real: `/rails-health` sat in `*/core`'s navigation and had been dead since ADR 009
removed the route.

Absent where the unit serves a single surface — inventing destinations to fill a
navigation produces dead links, which is worse than no navigation.

Visibility state may only apply **below** the breakpoint. Above it the navigation
is always shown, so no menu state — and no absent JavaScript — can strand a
desktop user. This is encoded in the navigation's own utilities in
`app/core/src/components/app-chrome.tsx`: `hidden data-[open=true]:grid
wide:grid`. Below the breakpoint the `data-open` attribute decides; at `wide:`
the media query shows it unconditionally, with no state consulted.

This requirement is the reason the trigger is a React Aria `<Button>` rather
than a `<Disclosure>`; see §3a.

Current entries (`*/core` only, from `src/components/app-chrome.tsx`): Home, Explore,
Messages, Notifications, Configuration, About. All six are served routes.

## 6. Main and aside

`<main>` is the single page-content landmark and carries the page's `<h1>`.

`<aside>` is **complementary** content — related links, contextual panels,
supplementary notes. It is not navigation; navigation is `<nav>`. Note that
`*/core`'s left sidebar is correctly a `<nav>` today, not an aside.

No unit renders an `<aside>` yet. The rules are stated here first so that the
three archetypes do not each invent their own meaning for it:

- Optional. A unit without complementary content does not get an empty one.
- A sibling of `<main>`, not nested inside it. An `<aside>` nested inside
  `<article>`, `<section>`, `<nav>` or another `<aside>` does **not** expose the
  `complementary` landmark role, so nesting silently removes the thing it was
  added for.
- In DOM order it follows `<main>`, so source order matches reading priority even
  where CSS places it first.
- More than one per document requires distinct accessible names
  (`aria-labelledby` pointing at its own heading, or `aria-label`).
- It never carries the page's `<h1>`, and it is never the only route to a
  destination — anything reachable solely from an aside is unreachable to a
  reader who skips complementary content.

## 7. Footer

Two layers, in this order.

**Upper — utility navigation.** A `<nav>` with an accessible name. It links only
to routes that exist:

| Item        | Where it points | Status                                                                                   |
| ----------- | --------------- | ---------------------------------------------------------------------------------------- |
| About       | `/about`        | present on all 20 units                                                                  |
| Preferences | —               | **route removed** — every `test/ui-shell-contract.test.tsx` now asserts it is not linked |
| Privacy     | —               | **no route, no reusable text** → not linked                                              |
| Terms       | —               | **no route, no reusable text** → not linked                                              |

A plausible dead link is worse than a missing one. Privacy and Terms stay
unlinked until a route exists and its text has been written and reviewed; legal
copy is not invented to fill a footer slot.

**Lower — site identity.** `© {year} UMAXICA` on the left, this unit's canonical
homepage URL on the right, displayed as the URL and linked to itself:

```html
<a href="https://jp.umaxica.app/">https://jp.umaxica.app/</a>
```

Every unit renders both halves, and every `test/ui-shell-contract.test.tsx`
asserts the link's `href` and its text. The row is
`flex flex-wrap justify-between`, which gives `copyright ⟷ URL` on a wide
viewport and natural stacking on a phone, with no media query.

Where the canonical origin comes from — and it is **not** `wrangler.jsonc`. Every
unit pins `"routes": []` deliberately: the development Cloudflare Tunnel owns the
hostname, and a custom domain and a Tunnel Public Hostname cannot both own one
name (ADR 008). `vars` carries only `EDGE_ENV`, `NODE_ENV` and `BRAND_NAME`. The
origin literals that do exist in-repo are:

| Archetype       | Source                                                                           | Example                                                 |
| --------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------- |
| core, satellite | `src/lib/canonical.ts` `CANONICAL_ORIGIN`, used by the sitemap and robots routes | `https://jp.umaxica.app`, `https://docs-jp.umaxica.app` |
| core also       | `src/lib/core-dispatch.ts` `PUBLIC_CORE_HOST`                                    | `jp.umaxica.app`                                        |
| apex            | `src/page-content.tsx` `ABOUT_CANONICAL_URL`; `src/root-redirect.ts` `SITE_URL`  | `https://umaxica.app`                                   |

Never derive the origin from a folder name. There is no origin resolver — the
literal is simply repeated two or three times per unit, which is itself a drift
risk worth collapsing when the URL is implemented.

---

## 8. The three archetypes: allowed difference vs drift

This table is the point of the document. A difference that is **allowed** follows
from what the unit is. A difference marked **drift** has no reason anyone
recorded, and the archetypes should converge on one value when someone next has
cause to touch it.

### Allowed

| Difference                  | core                                       | satellite                                | apex                                           | Why it is allowed                                                                                                                                              |
| --------------------------- | ------------------------------------------ | ---------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main navigation             | yes, 6 routes                              | none                                     | none                                           | Satellites and apex serve a single surface; inventing destinations produces dead links                                                                         |
| Menu button                 | yes                                        | none                                     | none                                           | A disclosure with nothing to disclose is a dead control                                                                                                        |
| Where the shell is wired    | `src/routes/_page.tsx`                     | `src/routes/__root.tsx`                  | `src/renderer.tsx`                             | core puts the shell on a pathless layout route, so `/offline` and the failure documents sit outside it and stay chrome-free (§15)                              |
| CSS delivery                | `src/globals.css` → hashed `/assets/*.css` | `src/style.css` → hashed `/assets/*.css` | `src/style.css` → hashed `/assets/style-*.css` | every unit builds through Vite, so the stylesheet is fingerprinted and served `immutable` by the assets layer (§3a)                                            |
| Client components           | one (the disclosure)                       | none                                     | n/a                                            | Only state justifies a client component                                                                                                                        |
| Breakpoint                  | 800px (`wide:`)                            | none                                     | none                                           | Only core has a layout that must reflow; wrapping flex rows need no media query                                                                                |
| React Aria                  | **`Button`, imported**                     | installed, no importer                   | **not possible**                               | apex carries no React; both agreed libraries peer-depend on it, so apex satisfies §4's behaviour by hand (§3a)                                                 |
| Tailwind RAC plugin         | installed                                  | none                                     | none                                           | The plugin only earns its place where a React Aria component is actually rendered                                                                              |
| `aria-current`              | on the matching entry                      | none                                     | none                                           | Only core has a main navigation, so only core has an entry to mark (§12)                                                                                       |
| `error.tsx`, `/offline`     | outside the shell                          | **inside the shell**                     | n/a                                            | Follows from where the shell is wired: core scopes it to `(page)`, the satellites wire it into the root layout (§15)                                           |
| Where the shell is asserted | `test/ui-shell-contract.test.tsx`          | `test/ui-shell-contract.test.tsx`        | `api/ui-shell-contract.hurl`                   | A frame's router is something this repo can render in-process; an apex document only exists as a response, and AGENTS.md puts response assertions in Hurl (§1) |

### Drift — resolved

The three archetypes carried three token sets: three container widths, three body
backgrounds, three body-text colours, two border greys, two unit systems and two
Japanese labels for About. That table is gone because the values are.

Adopting Tailwind forced the decision rather than deferring it — a utility names
a scale step, so `1200px`, `1120px` and `80rem` cannot all survive as
`max-w-*`. One token set now applies to all twenty shell units, drawn from
Tailwind's stock scale except where §9 pins a value:

| Concern           | Resolved value                                             |
| ----------------- | ---------------------------------------------------------- |
| Container         | `max-w-7xl` (80rem)                                        |
| Shell row padding | `px-4`, `wide:px-8` where the unit has a breakpoint        |
| Header separator  | `border-b border-gray-200` — the apex box-shadow is gone   |
| Footer border-top | `border-t border-gray-200`                                 |
| Body background   | `bg-gray-50`                                               |
| Surfaces          | `bg-white` (header, footer, core's navigation)             |
| Body text         | `text-gray-900`; muted `text-gray-600`                     |
| Brand             | `text-xl font-bold tracking-wide`, inheriting the body ink |
| Link colour       | `text-brand` — `--color-brand`, the one pinned value (§9)  |
| Units             | Tailwind's scale throughout; `min-h-11` is exactly 44px    |
| `<main>` class    | none — `<main>` is the landmark, utilities do the layout   |
| About label (ja)  | `概要` on core, `このサイトについて` on satellite and apex |

The About label is deliberately **not** resolved here: it is a copy decision, not
a token, and merging two Japanese phrasings needs someone who owns the wording.
It stays recorded as open gap 6 in §16.

**Rule for any future drift:** a surface adopts the token set above. Do not invent
a second one. A new value belongs in `@theme` in every unit that needs it, with
the same name, or it is not a token.

### 8a. Inside `<main>`: the page body

Everything above this line is chrome. This section is what goes under it, and it
is here for the same reason the token set is: twenty units that each answer the
question separately drift.

Three rules hold across all three archetypes. They are not a style preference —
each one replaced something measurably wrong:

1. **The page body sits on the shell's width carrier.** Whatever run the header
   and footer rows use (§9), `<main>`'s content uses the same one, so the `<h1>`
   starts on the same left edge as the brand above it and the copyright below
   it. Both frame archetypes failed this before it was written down: the
   satellites centred a `max-w-3xl` block inside a `px-5` main, putting the
   heading 224px right of the brand on a desktop viewport, and core's `<main>`
   was `px-5` against the shell's `px-4`, so on a phone the gutters differed by
   four pixels. A gutter that is nearly equal reads as a mistake in a way an
   obviously different one does not.
2. **Body copy has a reading measure.** `max-w-prose` — Tailwind's stock 65ch,
   so no new token. `<main>` is `max-w-7xl` because the header and footer rows
   are, and copy set that wide runs past 150 characters a line.
3. **Vertical rhythm is parent `gap`, never `space-y-*` or per-child `mt-*`.**
   Margins on children collapse against one another and have to be re-tuned
   whenever one is added or removed.

Type scale is per archetype, because the role differs and §8's test is whether
the reason can be written down:

| Archetype | `<h1>`                      | Under it                                      | Why that size                                                                                            |
| --------- | --------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| core      | `text-2xl`                  | `text-lg` lead, or `text-gray-600` for a stub | An application screen reached from a persistent navigation; a landing-page heading competes with the nav |
| satellite | `text-4xl`, `wide:text-5xl` | `text-sm` site name, then `text-lg` body      | The opening page of a content site, which is the one place a large heading is the content                |
| apex      | `text-3xl`                  | `text-xl` lead, base copy, `text-sm` caption  | A domain directory: bigger than an app screen, smaller than a landing page                               |

All three carry `leading-heading` and `tracking-tight`, and within an archetype
the value is identical in every unit — that is the part that is not negotiable.

**core's headings had no treatment at all until this was written.** Every page
rendered a bare `<h1>`, and Preflight resets a heading to the surrounding size
and weight, so all nine pages shipped a title pixel-identical to the paragraph
under it. `PageHeading` exists so that cannot recur silently.

**The satellites' eyebrow is gone.** A small label above a large heading is the
form that arrives when nothing was decided, and this one was `text-brand` — the
link colour — on a label that is not a link. The site name now follows the
heading as attribution, in muted grey, which also means a screen reader reaches
the page's own `<h1>` first. Accent stays on interactive elements.

**The current navigation entry is styled off `aria-[current=page]:`, not off a
second class.** core is the only archetype with a main navigation (§5), and it
marked the current entry in the accessibility tree only — a sighted reader had
no indication of where they were. Driving the fill and the weight off the same
attribute the assistive technology reads means the two cannot drift apart, and
fill plus weight is two cues rather than colour alone (§12).

#### apex only

The five apex Workers are the only units whose page body is written in this
repository rather than in a frame's route, and the five of them serve one
composition — the same on `/about` everywhere, and on `/` where `net` and `dev`
have one.

| Concern        | Value                                                                                               | Why                                                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Identifiers    | `font-mono` on every host name and every health-page value                                          | A host name is a string the reader may retype, not running copy; the mono column is also what makes the directory rows align            |
| Directory rows | one `<a>` per row at `min-h-11`, host and purpose on one baseline, `flex-wrap` for narrow viewports | Adds no media query, so §11's "apex emits none at all" still holds                                                                      |
| Row hover      | surface step to `bg-white` / `dark:bg-gray-900` under `group-hover`, plus an underline on the host  | The same surface the header and footer sit on; hovering the purpose text, which is not itself a link, shows the whole row is the target |

Two consequences worth keeping:

- **`--font-mono` is Tailwind's stock stack and is deliberately not declared in
  `@theme`.** `--font-sans` is named face by face because which face resolves
  decides how Japanese body text sets (§10); every string set in mono here is
  ASCII — a host name or a version id — so the stock stack has nothing to get
  wrong, and apex still downloads no font.
- **The host a page is served from is a label, not a link.** It used to be an
  `<a>` pointing at its own origin — a control returning the reader to where
  they already are.
- **`/about` describes the host it is served from, and the description is
  checked against the routes.** It used to say the domain "is not operated as a
  public-facing website" on all five, and that was true on none of them: `app`,
  `com` and `org` answer `/` with a 301 to a regional host, so the domain is
  exactly how a visitor reaches the service, and `net` and `dev` serve an
  `index,follow` homepage of their own. It also contradicted the
  `<meta name="description">` on the same page. The three redirectors now say
  that opening the domain takes you to the regional site; `net` and `dev` say
  the host carries no service of its own. Copy that describes behaviour is
  checkable — read `src/root-redirect.ts` and `api/routes.hurl` before changing
  either sentence.

## 9. Shared tokens

These resolve to the same computed value in all three archetypes and must stay
that way. They are now written the same way too — as Tailwind utilities off one
scale — which is what removed the `Units` row from §8.

| Token          | Utilities                                                                     | Value                     |
| -------------- | ----------------------------------------------------------------------------- | ------------------------- |
| Focus ring     | `:focus-visible` base rule using `var(--color-brand)`                         | `2px` solid, offset `2px` |
| Minimum target | `min-h-11` on brand, actions, utility links                                   | 44px, exactly             |
| Header height  | `min-h-14` on the header row                                                  | 56px, exactly             |
| Width carrier  | `mx-auto w-full max-w-7xl px-4` (`wide:px-8` where the unit has a breakpoint) | 80rem                     |
| Header row     | `flex flex-wrap items-center justify-between gap-4`                           | gap 16px                  |
| Footer padding | `py-4`                                                                        | 16px                      |
| Utility nav    | `flex flex-wrap gap-x-6`; links `text-sm text-brand min-h-11`                 | gap 24px, 0.875rem        |
| Identity row   | `flex flex-wrap justify-between gap-2 text-sm text-gray-600`                  | gap 8px, 0.875rem         |
| Link colour    | `text-brand`                                                                  | `#2563eb`, `#93c5fd` dark |

`--color-brand` is the only colour this document pins by literal value, and the
only one that is not a Tailwind stock colour. It is declared in every unit's
`@theme`. The focus ring is the one place a base element rule is still correct:
prose links inside page copy are not components, and a per-component utility
would miss them.

It is the one token with two values, and §9a is why. Against the two body
backgrounds: `#2563eb` is 4.95:1 on `gray-50` and 3.90:1 on `gray-950` — over
the 4.5:1 body-text threshold in light and under it in dark — and `#93c5fd` is
11.17:1 on `gray-950` and 1.73:1 on `gray-50`. Neither value serves both, so
the token carries one per scheme. It is set by overriding the token itself
rather than by writing `dark:text-blue-300` at every call site, so `text-brand`
and the focus ring keep moving together — which is the whole point of them
sharing a token.

### 9a. Colour scheme

Two schemes, decided in this order:

1. `data-theme="light"` / `data-theme="dark"` on `<html>`, from a `theme`
   cookie read on the server (`src/theme.ts`).
2. `prefers-color-scheme`, whenever that attribute is absent — which is every
   request today.

`style.css` declares the `dark` variant around exactly that split, so `dark:`
in the markup means "the cookie says dark, or the OS does and the cookie has
not said otherwise". `color-scheme` is declared alongside it so the UA's own
surfaces — scrollbar, form controls — follow.

Because the scheme is decided on the server, every negotiated HTML document
carries `Vary: Cookie, Accept-Language`. Two cookies change what is returned —
`theme` here and `language` in §13 — and neither appears in the URL, so nothing
else tells a cache that two requests for one path are not one response. It is
appended rather than assigned, so a directive another layer set survives.

Two limits are deliberate rather than pending:

- **The five apex Workers only.** A frame never sees the cookie: its
  `src/worker.ts` strips the inbound `Cookie` from every application-owned
  request (ADR 007). A frame that wants a scheme has `prefers-color-scheme`
  and Tailwind's stock `dark` variant, and none uses either yet.
- **Nothing sets the cookie.** The header's actions slot is still empty (§4),
  and a control that writes it is a browser-cookie decision bound by
  `docs/development/browser-cookie-access.md`. Reading a cookie something else
  sets costs one header; the OS preference works without it.

The three interaction states React Aria publishes on the menu trigger —
`hovered:`, `pressed:`, `focus-visible:` — come from
`tailwindcss-react-aria-components` (§3a). Do not reimplement them as bespoke
`[data-…]` selectors.

## 10. Typography

**Ownership moved with the Tailwind migration.** There is no longer a separate
`typography.css` (apex: `typography-style.ts`) — those twenty files are gone,
and each unit has exactly one stylesheet. The facts below are split between two
places inside it, by whether Tailwind can express them:

| Fact                                                                                            | Where it lives now                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Font stack                                                                                      | `--font-sans` in `@theme`. Preflight applies it to `html` on its own, because `--default-font-family` resolves to `--font-sans`; nothing carries a `font-sans` class. |
| Body and heading leading                                                                        | `--leading-body` / `--leading-heading` in `@theme` → `leading-body` on `<body>`, `leading-heading` on headings                                                        |
| `line-break`, `word-break: auto-phrase`, `text-spacing-trim`, `text-autospace`, `overflow-wrap` | An `@layer base` block. Tailwind has no utility for most of these, and they must reach every element in the document rather than the ones a unit happens to write.    |

The split is the point: a fact that Tailwind can name is a token, so it is
reusable and greppable; a fact it cannot name stays an element rule with the
reason written above it. Nothing declares a typographic property twice.

On the frames `--font-sans` names `var(--font-inter, 'Noto Sans JP')` first. That
variable is `--font-inter`, **not** `--font-sans`: pointing both at the same name
would make the theme token reference itself.

Inter is self-hosted. The CSP is `font-src 'self' data:`, so a CDN is not an
option: each frame `@import`s `@fontsource-variable/inter`, which ships the woff2
files and the `@font-face` rules, and Vite fingerprints them into the client
build like any other asset. `--font-inter` is a plain `@theme` token rather than
a class on one element, so every document the unit serves resolves the same
stack — including the failure documents. The `'Noto Sans JP'` fallback inside the
`var()` costs nothing and keeps the declaration valid if the token is ever
removed.

- **Font stack**: `--font-sans` (Inter, `latin` subset only) then `Noto Sans JP`,
  Hiragino, Yu Gothic, Meiryo, then the generic keywords. Noto Sans JP is named
  first and deliberately **not** downloaded — it is already the system face on
  Android, ChromeOS and most Linux, and Hiragino and Yu Gothic sit close behind
  on macOS and Windows. Order matters: `ui-sans-serif` and `system-ui` resolve to
  a face that already has Japanese glyphs, so anything after them is unreachable.
- `line-height: 1.75` — Japanese body text needs more leading than a Latin-tuned
  1.5. Headings drop to `1.3`, because Japanese glyphs fill the em box and
  Latin-tight leading collides them.
- `line-break: strict` — 行頭禁則: small kana, 長音符 and punctuation never begin a
  line.
- `word-break: normal` for body text, never `break-all`. Identifiers (`code`,
  `kbd`, `samp`, `pre`) are the exception and may break mid-token.
- `overflow-wrap: anywhere` — without it a long URL, UUID or FQDN overflows its
  box. This is what will keep the footer's canonical URL inside the identity row
  on a narrow viewport.
- `word-break: auto-phrase` + `text-wrap: balance` on headings — break at 文節
  boundaries, and even out line lengths. Separate concerns: one picks where a
  break may fall, the other how many lines there are.
- `text-align: justify` is deliberately absent. Japanese can break between almost
  any two characters so justification "works", but `text-justify` is unimplemented
  in WebKit, and at 320px a single overflowing character opens gaps across the
  whole line. Readability outranks a flush right edge.

Applied unconditionally rather than under `:lang(ja)`: every rule is either
CJK-only in effect or desirable in both languages, and the error and offline
documents are separate root documents a `:lang()` selector would miss.

## 11. Responsive behaviour

Phone, tablet and desktop must all work. Requirements:

- DOM order equals visual order. Do not reorder the header, navigation or footer
  visually against their source order.
- The footer identity row stacks rather than reorders: `copyright ⟷ URL` on a wide
  viewport, copyright above URL on a narrow one, achieved by wrapping, not by a
  media query.
- **800px is the only breakpoint in the repository, and the theme now enforces
  it.** Every unit's `@theme` opens with

  ```css
  --breakpoint-*: initial;
  --breakpoint-wide: 50rem;
  ```

  The first line deletes Tailwind's five stock breakpoints, so `sm:`, `md:`,
  `lg:`, `xl:` and `2xl:` do not exist and a second breakpoint cannot be written
  without editing that block. The rule is mechanical rather than a convention
  someone has to remember, and the compiled CSS is checkable: a frame emits
  exactly one `@media (min-width: 50rem)`, and apex emits none at all.

  Header and footer rows are wrapping flex rows, so they hold from phone to
  desktop without a media query at all; reach for `wide:` only when a layout
  genuinely has to reflow, as `*/core`'s sidebar does.

## 12. Accessibility

Required, and already true:

- Landmarks: `<header>`, `<nav>`, `<main>`, `<footer>`, each once per document.
- One `<h1>` per document, inside `<main>`.
- Links navigate, buttons act. A disclosure is a button.
- Visible focus, at the shared focus-ring value in §9.
- 44px minimum interactive target.
- Accessible names on every `<nav>` — there is more than one per document, so
  `aria-label` is required to tell main navigation from utility navigation.
- The disclosure is operable by keyboard and reflects state in `aria-expanded`.
- A skip link, first in the document, pointing at a `<main>` that can take focus.
- `aria-current="page"` on the navigation entry the reader is on, where the unit
  has a navigation.

The last two closed together across all 20 units, and the rest of this section
is what that landed as.

### The skip link

`<a href="#main-content">` as the first focusable element of every document that
carries the shell, targeting `<main id="main-content" tabindex="-1">`.

The `tabindex` is the half that is easy to leave out and the half that does the
work. Without it the browser scrolls to the fragment and leaves focus on the
link, so the reader's next Tab returns to the header they just asked to skip —
the control appears to work and does not. Every unit asserts both halves, and
asserts the link is the **first focusable element** rather than merely the first
link — a skip link a reader has to Tab to is not one. In Vitest that is a
`querySelector` over every focusable selector; in Hurl it is the same union in
XPath:

```
xpath "string((//a|//button|//input|//select|//textarea|//*[@tabindex])[1]/@href)" == "#main-content"
```

Where it is placed follows where each archetype already puts its shell:

| Archetype | Placed in                    | Target                                                               |
| --------- | ---------------------------- | -------------------------------------------------------------------- |
| core      | `src/routes/_page.tsx`       | `<PageMain>`                                                         |
| satellite | `src/routes/__root.tsx`      | `<PageHero>`, **and** the failure documents and `/offline` — see §15 |
| apex      | `src/shell.tsx` (`AppShell`) | the `<main>` `AppShell` renders                                      |

**It is hidden by a transform, not by `sr-only`.** Both keep the link in the
accessibility tree and focusable, which `display: none` and `visibility: hidden`
would not. The difference is that `sr-only` has to be undone by `not-sr-only`,
whose `position: static` then has to be overridden back to `absolute` in the
same `focus:` variant — two utilities fighting over one property, decided by the
order Tailwind happens to emit them in. `-translate-y-full` and
`focus:translate-y-0` set one custom property, and the second compiles to
`.focus\:translate-y-0:focus`, which carries a pseudo-class the first does not —
so it wins on specificity, not on emission order. That was checked in the
compiled stylesheet rather than assumed:

```css
.-translate-y-full {
  --tw-translate-y: -100%;
  translate: …;
}
.focus\:translate-y-0:focus {
  --tw-translate-y: 0px;
  translate: …;
}
```

There is deliberately no `transition`: an instant position change is not motion,
which is what keeps the last row of the table below vacuous.

### `aria-current`

`aria-current="page"` on the main-navigation entry matching the current route.
Only `*/core` has a main navigation, so only `*/core` marks anything; a unit that
gains one later inherits the rule. `app-chrome.tsx` reads `usePathname()`, which
is free — it is already the one client component the shell needs.

**The match is exact.** ARIA defines `page` as "the current page within a set of
pages", so an ancestor is not it: on `/configuration/account` the
`/configuration` entry stays unmarked rather than announcing a page the reader
is not on. `/home` and `/doctor` are unmarked for the same reason — served, but
not entries in this set. Entries that do not match carry no attribute at all
rather than `aria-current="false"`, which is what the default already means.

### Still open

| Gap                                      | Target behaviour when implemented                                                                                                                                                                                                                                                                          |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No reduced-motion handling** (0 units) | There is currently **no motion anywhere** — no `transition`, `animation`, `@keyframes` or `scroll-behavior` in any shell stylesheet. So nothing is broken today. The rule is a precondition: any motion introduced into the shell ships with `@media (prefers-reduced-motion: reduce)` in the same change. |

Do not close a gap like this unit-by-unit. Each is an archetype-wide change, and
a skip link that exists on four units out of twenty is worse than none, because
a reader learns to expect it. That is why the two closed above closed everywhere
in one change, including on the archetype that had no shell test to close them
against until the same change gave it one.

## 13. Internationalisation

Three mechanisms coexist. This is recorded as fact, not endorsed:

| Archetype | Mechanism                                                                                          | Negotiates?                                                                                       |
| --------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| core      | `src/i18n/dictionaries/{en,ja}.json` via `getDictionary()`                                         | **No** — every call site passes `defaultLocale` literally, so `en.json` exists but is unreachable |
| satellite | `src/i18n/config.ts` holds `defaultLocale` only; labels are Japanese literals in the components    | No                                                                                                |
| apex      | inline `LABELS: Record<'en'\|'ja', …>` in `src/shell.tsx`, plus `hono/language` `languageDetector` | **Yes** — `supportedLanguages: ['en','ja']`, `fallbackLanguage: 'en'`                             |

Labels that must correspond in meaning across locales regardless of mechanism —
About, Privacy, Terms, Preferences, Menu, Skip to main content. In use today:

| Concept                              | ja                                                     | en                     |
| ------------------------------------ | ------------------------------------------------------ | ---------------------- |
| About                                | `概要` (core) / `このサイトについて` (satellite, apex) | `About`                |
| Preferences                          | `環境設定`                                             | `Preferences`          |
| Menu                                 | `メニュー`                                             | `Menu`                 |
| Skip to main content                 | `本文へスキップ`                                       | `Skip to main content` |
| Main navigation (accessible name)    | `メインナビゲーション`                                 | `Main navigation`      |
| Utility navigation (accessible name) | `ユーティリティナビゲーション`                         | `Utility navigation`   |

The skip link is the first label added since the three mechanisms were recorded,
and it went through each of them rather than around any: `nav.skip` in core's
two dictionaries, a Japanese literal in the satellites' `SkipLink`, an entry in
apex's `LABELS` record. That is the rule working as intended — the machinery
stayed put, and what had to agree was the meaning.

It is also the first label whose English half is reachable in production.
`labelsFor()` in apex returns the English shell for a reader who negotiates
`en`, so `Skip to main content` renders; core's `en.json` still has no call site
that asks for it (open gap 5).

### Unresolved: apex declares a language it may not be writing in

`src/create-apex-app.ts` installs `languageDetector({ supportedLanguages: ['en','ja'],
fallbackLanguage: 'en' })`, and `src/shell.tsx` (`labelsFor()`) and
`src/page-content.tsx` both switch on the negotiated value — so an apex response
can be rendered entirely in English. But `src/renderer.tsx` emits
`<html lang={defaultLocale}>`, always `ja`, and `test/html-lang-contract.test.tsx`
pins exactly that, even though its own docstring says `<html lang>` _"must state
the language the document is actually written in."_

So on the code path, an English-negotiated apex page declares Japanese. This is
stated rather than fixed because a change has consequences on both sides: `lang`
drives `word-break: auto-phrase`, which is meant to run on Japanese text only, and
the four apex HTML emitters (renderer, health page, status pages, offline page)
currently derive `lang` from one constant on purpose. Confirm with a request-level
check (`Accept-Language: en`) before changing either half.

Do not unify the three mechanisms just to have one. Each stays inside its unit;
what has to match is the meaning of the labels, not the machinery.

## 14. Title and metadata

```
Root:  UMAXICA ({TLD})
Page:  {LOCALIZED_PAGE_TITLE} — UMAXICA ({TLD})
```

- EM DASH `—`. Not a hyphen, not a pipe.
- `UMAXICA` in exact uppercase; TLD uppercase and matching the deployment family.
- Exactly one non-empty `<title>` in the final HTML.
- Satellite roots carry the product name: `Docs — UMAXICA (APP)`.
- **No surface or runtime name may appear in a user-facing title** — not `auth`,
  `core`, `apex`, `side`, `edge`, `next`, `hono`, `workers`, `cloudflare` or
  `vite`. This is what lets Rails and Edge split routes inside one FQDN
  invisibly to the reader.

Two mechanisms, one emitted contract: each frame composes the suffix in
`brandTitle()` in `src/lib/title.ts` and passes a finished string to a route's
`head.meta`; apex uses `buildBrandTitle()` in `src/brand.ts` rendered through
`<SeoHead>` in `src/seo.tsx`. TanStack Router has no template primitive and a
nested title simply overrides its ancestor's, so that one function per unit is
the whole mechanism — and a route that sets a title without calling it is the
two-title trap the repository-wide test exists to catch. `test/html-title-contract.test.ts` at the repository
root is the single owner and checks the **final HTML**, not the source, across
every unit, page, error document and 429 response.

## 15. Surfaces that must not get the shell

A machine-readable or failure document with navigation in it is worse than one
without.

| Surface                                 | What it is                                                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `/health` (core, Astro, Hono aggregate) | **text/plain**, `Cache-Control: no-store`. Human-readable aggregate of startup/liveness/readiness. Not a page. No JSON, no HTML, no chrome. |
| `/health/startups`                      | Kubernetes `startupProbe`. `text/plain` `ok`.                                                                                               |
| `/health/livenesses`                    | Kubernetes `livenessProbe`. Runtime only; downstream outages must not fail it.                                                              |
| `/health/readinesses`                   | Kubernetes `readinessProbe`. `text/plain`; `503` only when this instance must not receive traffic.                                          |
| `/health.html`, `/health.json`          | **Not health documents.** Apex, cores and Astro answer 404 HTML. `Accept: application/json` does not change that.                           |
| `/revision`                             | **text/plain** compact Worker version id. Not JSON, not HTML.                                                                               |
| `/api/v0/revision.json`                 | **application/json** `{ id, tag, timestamp }`. Same metadata authority as `/revision`. Not health.                                          |
| `robots.txt`, `sitemap.xml`             | Generated routes.                                                                                                                           |
| apex `/`                                | A region redirect, not a document.                                                                                                          |
| 429 responses                           | Hand-written HTML; title contract applies, shell does not.                                                                                  |
| 404 and 500 documents, `/offline`       | **Archetype-dependent — see below.** Chrome-free on core; inside the shell on the satellites.                                               |

The four probe URLs are the same on Core, Astro, and Hono. `/health.html` and
`/health.json` are not served.

### The failure documents are only chrome-free on core

This table used to list them as chrome-free everywhere, and that was wrong for
the twelve satellites. It follows from where each archetype wires the shell
(§8): core puts it on the pathless `_page.tsx` layout route, so `offline.tsx`
and the router's `notFoundComponent` / `defaultErrorComponent` sit outside it and
render bare. The satellites wire the shell into `__root.tsx`, so those documents
render inside it and carry the header, the footer — and, since §12, the skip link
the root places ahead of them.

**On the satellites this is a known cost, not an oversight.** Everything a
satellite serves renders inside `__root.tsx`, so there is no way to give the 404
and the 500 a chrome-free document short of a second root that duplicates it.
`adr/013-frames-tanstack-start.md` records the trade.

The skip link is the consequence worth stating, because it is a way to ship a
broken control: a skip link on a document whose `<main>` has no `id` lands
nowhere, and the document it would land nowhere on is the one a reader reaches
when something has already failed. So on the satellites the failure documents and
`/offline` carry `id="main-content"` and `tabIndex={-1}` exactly as `PageHero`
does, and their unit's `test/ui-shell-contract.test.tsx` asserts it.

The difference itself is allowed — a failure document that keeps the shell and
one that drops it are both defensible — but it is a difference, and a change to
either archetype's status surfaces has to ask which one it is editing.

## 16. Conformance and open gaps

Conforming today, all 20 units: landmark set and order; brand as link, not
heading; single `<h1>` in `<main>`; header actions slot; navigation as a sibling
of the header; two-layer footer with a named utility nav and a rendered canonical
URL; no dead links; the title contract; chrome-free status surfaces; the shared
tokens in §9; the typography rules in §10; one token set across all three
archetypes (§8); one breakpoint, enforced by the theme (§11); a skip link ahead
of the header targeting a focusable `<main>` (§12); `aria-current="page"` where
the unit has a navigation (§12); and a `test/ui-shell-contract.test.tsx` that
proves it (§1).

Closed since the last revision:

- The footer identity row now renders the canonical URL on all 20 units (§7).
- **The page body is written down (§8a).** It had never been: §9 pinned the
  chrome and stopped at `<main>`, so what went inside was whatever each
  archetype had grown. Three things were wrong rather than merely undecided —
  both frame archetypes misaligned the page against the shell's own gutter,
  core's `<h1>` had no treatment at all and rendered identically to body copy on
  all nine pages, and core marked the current navigation entry only in the
  accessibility tree. All three are fixed in all 20 units, and §8a is what
  stops them recurring. It is a page convention rather than a shell one, so it
  sits beside §8 instead of inside §9's token table.
- The three token sets are one (§8).
- The status surfaces that shipped unstyled — apex's 404/500/offline and health
  error documents, and the frames' error documents — are styled, because a linked
  or imported stylesheet costs nothing. On the frames this is structural now
  rather than remembered: the 404 and 500 render inside the root document, so
  they cannot lose the stylesheet without every page losing it.
- **The skip link and `aria-current` landed on all 20 units (§12).** They were
  gap 2 in the previous revision. Each landed with its assertions in the layer
  that archetype already uses — Vitest on the fifteen frames, Hurl on the five
  apex Workers — which is now stated in §1 and in §8's allowed table, because
  the split had been left for a reader to infer from a missing file name.
- **§15 corrected.** It claimed `error.tsx` and `/offline` were chrome-free on
  every archetype; on the twelve satellites both render inside the root layout
  and always did. The document, not the code, was wrong.
- **The unit counts corrected.** The prose said 19 HTML-serving units and
  twenty-one `@theme` blocks; both are 20, and have been since `dev/apex`
  joined the contract (§1).

Open:

1. No `<aside>` exists anywhere (§6) — the slot is defined, nothing is drawn.
2. No reduced-motion handling (§12) — currently vacuous; becomes required the
   moment motion is added. Note that Tailwind ships a `motion-reduce:` variant,
   so the precondition is now one utility rather than a media query to author.
3. Two Japanese labels for About: `概要` vs `このサイトについて` (§8, §13). Left
   open deliberately — it is a copy decision, not a token.
4. Three i18n mechanisms; core carries an `en.json` it never reaches (§13).
5. apex may declare `lang="ja"` on an English document (§13). The skip link
   makes this slightly more visible, not worse: an English-negotiated apex page
   now opens with `Skip to main content` inside a document declaring `lang="ja"`.
6. Privacy and Terms have no route and no text (§7).
7. The canonical origin literal is repeated 2–3× per unit with no resolver (§7).
8. `react-aria-components` is installed in twelve satellite units with no
   importer, so twelve `knip.jsonc` files carry an `ignoreDependencies`
   suppression (§3a). Each is deleted when its unit gains a consumer. The three
   core entries are already gone.
9. The satellites' 429 document, built as a string in `src/rate-limit.ts`, is
   the one HTML surface with no stylesheet. The limiter runs before the route
   that knows the hashed CSS chunk's URL, so there is nothing to link; it stays
   unstyled semantic HTML rather than gaining a hand-maintained inline copy.
   It has no skip link either, for the same reason it has no shell.
10. The shell test is named `app-shell.test.tsx` in `app/core` and
    `application-shell.test.tsx` in `com/core` and `org/core`. Nothing depends
    on the name, but §1 of this document calls the three units one archetype,
    and two names for one file is the kind of drift that makes a reader check
    whether the contents differ too. Rename when someone next touches all three.

## 17. Changing this contract

- A shell change lands in the unit, in this document, and in that unit's
  `test/ui-shell-contract.test.tsx` — in the same commit. A contract that is
  edited in only one of the three stops being a contract.
- A change that applies to an archetype applies to **every** unit in it. Partial
  rollouts of an accessibility feature are worse than not shipping it.
- An intentional difference goes in the §8 _allowed_ table with its reason. If you
  cannot write the reason, it is drift, and it belongs in the _drift_ table
  instead — where the next reader can find it rather than rediscover it.
- Do not resolve duplication by introducing a shared UI package, a shared
  Tailwind preset, a shared theme file or a root Tailwind config. The extraction
  property is load-bearing and machine-checked.
- Visual rules belong in the markup as utilities. A new CSS rule needs a written
  reason for why a utility cannot express it — the two that qualify today are the
  focus ring, which has to reach prose links, and the Japanese line-breaking
  properties, which Tailwind has no utility for. `@apply` is not a reason: it
  rebuilds the class layer this migration removed.
- A repeated run of utilities is a component, not a CSS class. That is what
  `PageMain`, `PageHero`, `SiteHeader` and `SiteFooter` are for.
