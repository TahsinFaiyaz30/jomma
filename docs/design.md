# Jomma — Design system

Everything needed to build the dashboard UI. Read this before writing any
component.

---

## Style: `base-mira`

shadcn ships **eight** styles: Vega, Nova, Maia, Lyra, Mira, Luma, Rhea, and Sera.
A style changes radius, spacing, density, and typography across every component at
once, while the component API stays identical. The old two-style era (Default and
New York) is legacy — New York is now Nova.

The styles differ mainly along a density axis:

| Style | Character | Suits |
|---|---|---|
| **Nova** | Classic shadcn. Medium radius, balanced spacing. Formerly "New York." | Safe default |
| **Vega** | Polished SaaS, still close to stock | Marketing-adjacent product UI |
| **Mira** | Tighter padding, reduced margins, maximum density | **Dashboards, tables, admin** |
| **Maia** | Large radii, often fully rounded, generous spacing | Consumer-facing |
| **Luma** | Spacious, soft, approachable | Onboarding, setup, checkout |
| **Rhea** | Luma's roundness at compact spacing | Rounded product UI |
| Lyra, Sera | — | — |

Jomma uses **Mira**. It is the recommended choice when density matters more than
softness, specifically for dashboards, tables, and admin screens. That is exactly
this product: a monitoring instrument where someone scans hundreds of payment rows
and needs to see 30 at once, not 8.

Rhea is the fallback if Mira reads as too severe — it keeps Luma's rounded
foundation at compact spacing. Every token in this document works unchanged in
either, so switching is a one-word edit in `components.json`.

Do not try to recreate a style's density by lowering `--spacing`. It is a
multiplier, so changing it alters what `p-2` and `w-4` mean across the entire app.
Pick the style instead.

```bash
pnpm dlx shadcn@latest init --base base --style mira
```

```jsonc
// components.json
{
  "style": "base-mira",
  "rsc": true,
  "tailwind": {
    "config": "",
    "css": "app/globals.css",
    "baseColor": "taupe",
    "cssVariables": true
  }
}
```

The `base-` prefix selects Base UI. Radix styles have no prefix.

> Preview Mira, Rhea, and Nova side by side in
> [shadcn/create](https://ui.shadcn.com/create) before committing. Two minutes,
> and far easier to judge by eye than by description.

---

## Base color: Taupe

Available base colors are Neutral, Stone, Zinc, Mauve, Olive, Mist, and Taupe.

Use **Taupe**. Neutral and Zinc are the ecosystem defaults and produce the
instantly-recognisable grey that reads as a generated app. Taupe is warm-tinted,
which suits a money-handling tool — warmth reads as trustworthy where cool grey
reads as clinical.

Alternatives if Taupe feels wrong once you see it in situ: **Mist** for a cooler,
more technical feel, or **Olive** for something more distinctive. Do not fall back
to Neutral or Zinc.

Preview all three in shadcn/create before deciding. This is a five-minute decision
that shapes every screen.

---

## Three-mode theming

Light, dark, and system. Non-negotiable — someone will have this open at 2am.

**Design dark first.** Ops tools live in dark mode. Build the `.dark` token block
as the primary design surface, then derive light from it. Doing it the other way
round produces a dark mode that is just an inverted light mode, which is the most
common failure.

Use `next-themes` per the shadcn dark mode docs, with `attribute="class"`,
`defaultTheme="system"`, and `enableSystem`. Add `disableTransitionOnChange` so
switching doesn't animate every token at once.

The toggle is three-state, not two: Light / Dark / System. Put it in the user
menu, not the top bar — it's set once, not adjusted.

Guard against the flash of wrong theme with the standard inline script in
`<head>`. On a monitoring dashboard a white flash at 2am is genuinely unpleasant.

---

## Tokens

Rhea supplies the base tokens: `background`, `card`, `popover`, `primary`,
`secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`,
`chart-1..5`, the `sidebar-*` family, and `radius`.

Radius derives a full scale from a single `--radius`, so change that one value and
the whole app follows. Don't hardcode corner values anywhere.

### Status tokens

Jomma needs status colours that Rhea doesn't ship. Add them using the documented
pattern — define under `:root` and `.dark`, then expose via `@theme inline`:

```css
:root {
  --matched:               oklch(0.62 0.13 155);
  --matched-foreground:    oklch(0.98 0.01 155);
  --matched-subtle:        oklch(0.95 0.03 155);

  --pending:               oklch(0.75 0.14 75);
  --pending-foreground:    oklch(0.26 0.06 75);
  --pending-subtle:        oklch(0.96 0.04 75);

  --ambiguous:             oklch(0.68 0.17 55);
  --ambiguous-foreground:  oklch(0.98 0.01 55);
  --ambiguous-subtle:      oklch(0.95 0.05 55);

  --offline:               oklch(0.58 0.21 27);
  --offline-foreground:    oklch(0.98 0.01 27);
  --offline-subtle:        oklch(0.95 0.04 27);
}

.dark {
  --matched:               oklch(0.70 0.14 155);
  --matched-foreground:    oklch(0.18 0.02 155);
  --matched-subtle:        oklch(0.26 0.05 155);
  /* …same shape for pending, ambiguous, offline */
}

@theme inline {
  --color-matched:              var(--matched);
  --color-matched-foreground:   var(--matched-foreground);
  --color-matched-subtle:       var(--matched-subtle);
  /* …etc */
}
```

Now `bg-matched-subtle text-matched-foreground` works as a utility.

**Semantics, enforced:**

| Token | Meaning | Where |
|---|---|---|
| `matched` | Resolved, no action needed | Feed rows, intent status |
| `pending` | Waiting, normal | Open intents, queue depth |
| `ambiguous` | A human must decide | Manual queue, multi-candidate |
| `offline` | Something is actually broken | Device down, balance drift |
| `destructive` | Irreversible actions | Reverse match, revoke device |

`offline` and `destructive` are the only reds in the product. Do not use red for
"unmatched" — unmatched is normal and expected. **Alarm fatigue in a payments
tool is a real failure mode**, and it starts by colouring ordinary states red.

---

## Typography

Two families, distinct roles.

```
Interface   Instrument Sans     Headings, labels, body, buttons
Figures     IBM Plex Mono       TrxIDs, reference codes, msisdns
Bengali     Hind Siliguri       If localised — check numeral rendering early
```

Not Inter, not Geist. Both are the defaults everyone reaches for and both read as
templated.

### Amounts are not monospace

This distinction matters and is usually got wrong.

**Amounts** use the interface sans with tabular figures:

```css
.amount { font-variant-numeric: tabular-nums; }
```

Tabular figures align decimal points vertically in a column so a mis-keyed digit
is visible at a glance, while keeping the readability of a proportional sans.
Amounts stay in the interface font.

**True monospace is reserved** for strings where character-by-character
disambiguation is the point: TrxIDs (`BK7X2M9QP1`), reference codes (`K7M2`),
phone numbers, API keys, and request IDs. These are read as sequences, not
quantities.

Do not extend mono to labels, headings, or small caption text. Monospace as a
decorative device for "technical feel" is one of the clearest generated-UI tells.

### Scale

Rhea is compact. Keep the scale tight and let density do the work.

```
display   24px / 1.2   -0.02em    Page titles only
title     18px / 1.3   -0.01em    Section headings
body      14px / 1.5    0         Default
small     13px / 1.4    0         Table cells, secondary
micro     11px / 1.3    0.01em    Timestamps, badges
```

Sentence case everywhere. No ALL-CAPS labels.

### Typeset for prose

Use **shadcn/typeset** for the API docs and any rendered markdown. It's one CSS
file you own, driven by three controls — size, leading, and flow — with everything
else derived. It uses your theme tokens, so dark mode needs nothing extra.

```css
.typeset-docs {
  --typeset-font-body:    var(--font-instrument);
  --typeset-font-heading: var(--font-instrument);
  --typeset-font-mono:    var(--font-plex-mono);
  --typeset-size: 15px;
  --typeset-leading: 1.7;
  --typeset-flow: 1.35em;
}
```

Do not apply `typeset` to the dashboard chrome. It's for documents, not UI.

---

## Layout

```
┌────────────┬──────────────────────────────────────────────┐
│            │  Feed                              [account] │
│  Jomma     ├──────────────────────────────────────────────┤
│            │                                              │
│  ● Feed  3 │   14:35:12  ৳1,200.00  ●matched   K7M2  →   │
│    Queue 2 │   14:33:48  ৳  850.00  ●matched   P2W9  →   │
│    Intents │   14:31:02  ৳1,200.00  ●ambiguous  —    →   │
│    Accounts│   14:29:55  ৳  340.00  ●matched   R8K1  →   │
│    Reconcile                                              │
│            │                                              │
│  ─────────  │                                             │
│  bKash ●    │                                             │
│  …7766  ok  │                                             │
│  Nagad ●    │                                             │
│  …2211  ok  │                                             │
└────────────┴──────────────────────────────────────────────┘
```

Use the shadcn `Sidebar` component with its dedicated `sidebar-*` tokens — it has
its own surface, accent, and border tokens so it reads as distinct chrome without
hand-rolled colours.

**Account health lives in the sidebar footer, always visible.** Not on a settings
page. If a device goes down while you're looking at the queue, you should see it
without navigating. This is the single most important layout decision in the
product.

### Screens

| Route | Purpose |
|---|---|
| `/` | **Feed.** Live stream of incoming payments. The hero. |
| `/queue` | Payments needing a human. Sorted oldest first. |
| `/intents` | Open and recent payment requests. |
| `/accounts` | Receiving accounts, devices, health, limits. |
| `/accounts/:id/devices` | Device detail, provisioning QR, token rotation. |
| `/reconcile` | Statement import, unmatched money, integrity checks. |
| `/apps` | API keys, webhook endpoints, delivery log. |
| `/settings` | Theme, alerts, adapters (including the Messages bridge flag). |

### The feed is not a dashboard

No KPI tiles across the top. The first thing on screen is the payment stream,
newest first, updating live. Everything else is secondary.

Counts belong as badges on sidebar items, where they're always visible, not as
cards competing with the content.

---

## Components

```bash
pnpm dlx shadcn@latest add sidebar data-table table badge button input \
  select dialog sheet dropdown-menu command tooltip toast tabs skeleton \
  empty field item kbd separator popover alert-dialog chart spinner
```

`empty`, `field`, `item`, and `kbd` are newer additions and all earn their place
here — empty states, form rows, list rows, and keyboard hints.

### Table density

The feed and queue are `@tanstack/react-table` with `@tanstack/react-virtual`.

```
row height     36px
cell padding   px-3 py-2
header         sticky, bg-background/95, backdrop-blur
zebra          none — use border-b border-border/50
hover          bg-accent
selected       bg-accent, border-l-2 border-l-primary
```

No zebra striping. With a compact row height it creates visual noise that
competes with the status colour, which is the thing that actually matters.

Status renders as a small filled dot plus a label, never colour alone. Colour
alone fails for colour-blind users and fails in a screenshot pasted into a
support chat.

### Keyboard

An ops tool that needs a mouse is a slow tool.

```
j / k          move down / up
enter          open detail
a              approve highlighted
r              reject highlighted
/              focus search
cmd+k          command palette
esc            close panel
```

Use the `command` component for the palette. Show shortcuts with `kbd` in
tooltips and menus, so they're discoverable rather than folklore.

---

## Motion

Small budget, all functional. Motion 13, `import { motion } from "motion/react"`.

**Allowed:**

- New feed row enters: fade plus 4px translate, spring `{ stiffness: 400, damping: 30 }`. You should notice something arrived.
- Status change: colour transition, 150ms. You should see it resolve.
- Sheet and dialog: Base UI defaults, unmodified.
- Device status dot going offline: single pulse, then hold. Not a loop — a looping alert is ignored within a minute.

**Not allowed:**

- Section entrance animations
- Card hover lifts
- Skeleton shimmer on anything that loads under 200ms
- Anything decorative

Wrap everything in `useReducedMotion`.

Try CSS first. Scroll-driven animations and View Transitions are baseline now and
cost zero JavaScript. Motion is for gestures, springs, and layout morphs only.

---

## Accessibility

- Visible focus ring on every interactive element, using the `ring` token.
- Status conveyed by dot **and** text, never colour alone.
- Live regions on the feed so screen readers announce arrivals.
- Contrast checked in both themes, including the status tokens against their
  subtle backgrounds.
- Full keyboard operation of the queue. Approving a payment must never require a
  pointer.

---

## Do not

These read as machine-generated regardless of subject:

- KPI tiles across the top because that's what dashboards look like
- Content chopped into identical rounded cards with one shared shadow
- Tracked-out ALL-CAPS eyebrow labels above headings
- Meta strings joined with middle dots (`A · B · C`)
- `→` appended to button text
- Numbered markers on content that isn't a sequence
- Accenting one word in a heading with colour
- Gradient washes as decoration
- Monospace on labels and captions for "technical feel"
- Red for states that are merely waiting

---

## Build order

1. `shadcn init --base base --style mira`, base colour Taupe
2. Fonts wired via `next/font`, `--font-instrument` and `--font-plex-mono`
3. Status tokens in `:root` and `.dark`, exposed through `@theme inline`
4. `next-themes` with three-mode toggle and flash guard
5. `/dev/tokens` page showing every token and every component state in all three
   modes — this is how you catch inconsistency before it spreads
6. Sidebar shell with live account health in the footer
7. Feed table: virtualized, keyboard nav, live updates
8. Queue, then Intents, then Accounts, then Reconcile

Do not build screens before step 5. Retrofitting tokens across a finished UI is
miserable and always leaves stragglers.

---

## Notes for the agent

shadcn ships Skills for AI coding agents at
[ui.shadcn.com/docs/skills](https://ui.shadcn.com/docs/skills). Read that page
before starting — it may cover component installation and composition workflows
more accurately than this document can.

There is also an MCP server for the registry, which lets you search and install
components directly. Prefer it over guessing component names.
