# Design — Prior-Art India (AiPatentAgent)

A locked design system for this app. Every page redesign reads this file before emitting code.
Do not regenerate per page — extend or amend this file when the system needs to grow.

Written after a full-app audit: the UI was judged **too congested — too many simultaneous
panels, too many facts repeated, the primary action below the fold**. The system below exists
to enforce *one screen, one job, one primary column*.

## Genre

**modern-minimal** — Stripe / Linear register. Monochrome restraint, one accent, generous
whitespace, pill primary CTA, motion-cut. Glassmorphism is **banned** (genre rule): no
`backdrop-filter`, no translucent layering, no nested tinted cards.

## Macrostructure family

One base family for the whole product. Pages within the family share the shape; they vary only
in component archetypes and in how much of the "details" disclosure is open.

- **App pages: `Workbench`** — a working surface, not a brochure.
  - *Intake variant* (`/`): headline → lede → **composer is the hero** → 4-step strip → recent runs.
  - *Run variant* (`/analyses/:id`): single sticky header row (title · 4 steps · meter · status)
    → `doc | narration rail` two-column grid → one collapsed "Run details" disclosure.
- **Marketing pages (`/home` static landing):** `Bento Grid` (already shipped, theme "Nocturne")
  — out of scope for this system; it may be amended separately.

Diversification is **inverted** for this project: pages must share this system, not differ.

## Theme

Flat light, cool. Every colour is a token; no inline hex in component code.

```css
:root {
  --color-paper:      #ffffff;   /* surfaces                       */
  --color-paper-2:    #f4f6fb;   /* page canvas                    */
  --color-paper-3:    #eaedf6;   /* wells, hover fills             */
  --color-ink:        #111426;   /* primary text                   */
  --color-ink-2:      #454b66;   /* secondary text                 */
  --color-ink-3:      #6d748f;   /* tertiary / captions            */
  --color-rule:       #e3e7f0;   /* 1px borders, dividers          */
  --color-rule-strong: #cfd5e6;
  --color-accent:     #4f46e5;   /* one accent — ≤5% per viewport  */
  --color-accent-ink: #3730a3;
  --color-accent-soft:#eef0fe;
  --color-accent-rule:#d3d6fb;
  --color-ok:         #0f9d76;   /* verdict: clear / not found     */
  --color-ok-soft:    #e7f7f2;
  --color-ok-rule:    #bfe9dc;
  --color-warn:       #c2740b;   /* verdict: partial               */
  --color-warn-soft:  #fdf3e3;
  --color-warn-rule:  #f4dcb6;
  --color-risk:       #dc3b31;   /* verdict: disclosed / no novelty*/
  --color-risk-soft:  #fdeceb;
  --color-risk-rule:  #f8cdca;
}
```

Rules: hairline `1px solid var(--color-rule)` instead of shadow-stacking; at most **one**
whisper shadow (`0 1px 2px rgba(...)` via `--shadow-whisper`) on hovering cards; semantic
red/amber/green appear **only** on verdict states, chart cells, and claim badges.
Tinted panels (`--color-*-soft`) always carry a matching `--color-*-rule` hairline all around —
never a left-border "side stripe".

## Typography

Two families + one data register. All headings roman (`font-style: normal`) — italic emphasis
words in headings are banned.

- **Display / body:** Inter — body `400`, UI `500`, headings `700` at `letter-spacing: -0.03em`
  (genre permits Inter; the pairing discipline is satisfied by the mono register).
- **Outlier (one role only):** JetBrains Mono `500` — *technical identifiers*: novelty score,
  publication numbers, run ids, stage numerals, timestamps, dotted metrics. Nothing else.
- **Scale:** major third `1.25` — `--text-xs .6875rem · sm .8125rem · base 1rem · md 1.25rem ·
  lg 1.5625rem · xl 1.9531rem · display clamp(2.25rem, 4.5vw + .5rem, 3.5rem)`.
- **Rules:** body ≥ 16px, measure `max-width: 65ch`, display line-height `1.06`, body `1.6`,
  `font-variant-numeric: tabular-nums` on every number column, ≤ 5 sizes per page.

## Spacing

4-pt named scale. Pages use `var(--space-*)`, never raw values.

```css
--space-3xs: .125rem;  --space-2xs: .25rem;  --space-xs: .5rem;
--space-sm:  .75rem;   --space-md: 1rem;     --space-lg: 1.5rem;
--space-xl:  2.5rem;   --space-2xl: 4rem;    --space-3xl: 6rem;
```

Shell `max-width: 1120px`; prose `65ch`; page gutter `clamp(1rem, 4vw, 2.5rem)`.
Rhythm is deliberately uneven: hero `--space-2xl` top, strip `--space-xl`, recent `--space-2xl`.

## Motion

- `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)` · `--dur-short: 160ms`.
- Reveals: **none** — the page is composed, it does not fade in on scroll.
- Animate only `background-color`, `border-color`, `color`, `transform` on direct interaction.
- Focus rings appear **instantly** (never transitioned). `prefers-reduced-motion` → opacity ≤150ms.

## Microinteractions stance

Silent success (no "done!" toasts) · hover delay 0 / focus delay 0 · tooltips only where a
plain-language hint is genuinely needed · optimistic delete with no confirm dialog.

## CTA voice

- **Primary (exactly one per screen):** solid `--color-accent` pill, `border-radius: 999px`,
  label is a verb + object — `Run analysis`.
- **Secondary:** ghost text link with an arrow, `border: 1px solid var(--color-rule)`.
- **Never:** two filled buttons side by side, never a button that does nothing.

## Per-page allowances

- Marketing pages MAY use enrichment (Tier-A CSS art only).
- **App pages MUST NOT use enrichment** — function carries the page.
- Content pages: typography only.

## What pages MUST share

- The wordmark (`Prior-Art` in a mono-marked square) and its placement.
- The accent colour and its placement (≤ 5 % per viewport).
- The body/display font pair and the mono data register.
- The CTA voice (pill shape, radius, padding rhythm).
- **Progressive disclosure discipline:** at most one open details region per screen.

## What pages MAY differ on

- Which of the four blocks the run screen foregrounds (scorecard vs chart).
- Whether the narration rail is visible on a narrow viewport (it stacks below the doc).
- Ordinal step strips may or may not be present (max 1 per page, and only when genuinely ordinal).

## Removals (standing bans for this project)

| Removed | Why |
|---|---|
| Eyebrow labels on sections (`READY TO GO`, `HOW IT WORKS`) | labelled-list tic; the one ordinal strip may carry a step count only |
| Ticker / stat strips with unsupplied numbers | invented-metric tell, repeated information |
| Glassmorphism, `backdrop-filter`, translucent panels | genre ban + the main source of visual noise |
| Left-border "side-stripe" cards | 2018-SaaS tell |
| Card-in-card (bento card holding a widget) | nested containment with no reason |
| Emoji as feature/section icons (⚠️ 🚩 ✏️ 🔍 🇮🇳 💡) | emoji are not an icon system |
| Italic emphasis words in headings | most reliable AI tell |
| Dead controls (`View docs`) | affordance that does nothing |
| Undefined tokens `--t1 --t2 --t3` | silently drop emphasis colour |
| Three equal columns of equal cards | the AI feature grid |
| PayPal / metering / token telemetry in the persistent footer | buyer-facing jargon; behind a disclosure |

## Exports

```css
:root { /* tokens — see § Theme, § Typography, § Spacing, § Motion */
  --space-3xs: 0.125rem; --space-2xs: 0.25rem; --space-xs: 0.5rem;
  --space-sm: 0.75rem;   --space-md: 1rem;     --space-lg: 1.5rem;
  --space-xl: 2.5rem;    --space-2xl: 4rem;    --space-3xl: 6rem;
  --text-xs: 0.6875rem;  --text-sm: 0.8125rem; --text-base: 1rem;
  --text-md: 1.25rem;    --text-lg: 1.5625rem; --text-xl: 1.9531rem;
  --text-display: clamp(2.25rem, 4.5vw + 0.5rem, 3.5rem);
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1); --dur-short: 160ms;
  --radius-sm: 6px; --radius-md: 10px; --radius-lg: 16px; --radius-pill: 999px;
  --z-base: 1; --z-raised: 10; --z-sticky: 200; --z-modal: 400; --z-toast: 500;
}
```
