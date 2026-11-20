# SnagWalk design system

The rules every screen follows. Tokens live in `src/app/globals.css` (CSS variables, light + dark), are mapped to
Tailwind names in `tailwind.config.js`, and are checked for WCAG AA contrast by `src/lib/design-tokens.test.ts`.
Change a colour here, in the CSS and in the test together, never inline in a component.

## Brand

- **Logo:** `src/components/BrandLogo.tsx`. `LogoMark` is the floor-plan "S" (an orthogonal route through rooms with
  an opening on the right edge: the way in). `BrandLogo` is the horizontal lockup, mark + "SnagWalk" wordmark in
  Geist Bold, tracking -0.03em. Master artwork: `public/brand/snagwalk-logo-v2.png`. The SVG is traced from it.
- **Brand blue:** `#193BC4` (rgb 25 59 196). The mark is always one flat colour: brand blue on light surfaces,
  `#6B93FF` on dark (the `--brand` token handles this), or white on a brand-blue tile. No gradients, shadows or
  outlines on the mark.
- **Favicon:** `src/app/icon.svg`, brand-blue mark on a white rounded tile, so it reads in light and dark browser tabs.
- **Clear space:** at least half the mark's width on every side. Minimum size 16px.

## Landing background

The landing page sits on the ThreeUI **Nebula** field (`src/effects/structure-flow/`, exact registered source,
hash-checked) in both themes: `.theme-dark` applies the dark tokens to that page only. Tint is applied through the
component's own props: `hue={-27}` (indigo to the logo blue), `saturation={0.85}`, `brightness={0.9}`. Content over it
uses glass surfaces (`bg-surface/70` + `backdrop-blur-xl`, `border-white/10`). Reduced motion shows a static frame.

## Colour

One accent. Neutrals are slightly cool, to sit with the blue. Warm hues mean severity, nothing else.

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` | 244 245 248 | 11 12 16 | Page |
| `surface` | 252 252 253 | 19 21 27 | Cards, inputs |
| `surface-2` | 235 237 242 | 29 32 40 | Wells, skeletons, minor badge |
| `line` | 221 224 231 | 41 45 56 | Borders, dividers |
| `ink` | 16 16 17 | 236 238 243 | Primary text (matches the wordmark) |
| `ink-2` | 82 86 96 | 164 168 180 | Secondary text |
| `ink-3` | 96 100 110 | 138 143 156 | Hints, placeholders, meta |
| `brand` | 25 59 196 | 107 147 255 | Logo mark only |
| `accent` | 25 59 196 | 107 147 255 | Primary buttons, links, focus ring, Gemini tag |
| `accent-ink` | 255 255 255 | 8 12 32 | Text on accent |
| `accent-soft` | 229 234 251 | 22 34 78 | Accent tint backgrounds |
| `crit` / `crit-soft` | 196 40 32 / 252 231 228 | 255 112 98 / 64 24 22 | Critical severity, errors |
| `major` / `major-soft` | 150 88 0 / 252 240 214 | 240 176 72 / 58 40 12 | Major severity, offline fallback |
| `ok` | 22 116 74 | 88 200 140 | Success, "live" status |

Rules:
- No purple, violet, teal or orange anywhere in the UI. Minor severity is neutral (`surface-2` + `ink-2`).
- Accent is for the one primary action on a screen and for interactive affordances. Do not use it for decoration.
- Use `bg-accent/90` style alpha for hover, never a new colour.
- The builder letter (`.paper`) is a document: it is always light, in both themes and in the PDF.

## Type

- **Geist** for UI (Noto Sans Devanagari as fallback for Hindi and Marathi), **Geist Mono** for numbers in chips.
- Headline: semibold, tracking -0.035em, `clamp(1.85rem, 5.4vw, 4rem)`. Section titles 20-24px semibold.
- Body 15-17px, `leading-relaxed`. Labels 13px medium `ink-2`. Meta 12-13px `ink-3`.
- Numbers in tables and counters use `.tabular`.

## Shape and depth

- Radii: cards 20px (`rounded-card`), inputs 12px (`rounded-field`), buttons, chips and badges full pill.
- Borders do the work; shadows are rare: `shadow-lift` for floating bars, `shadow-paper` for the letter.
- Touch targets at least 44px (buttons `md` = 44px, `lg` = 56px).

## Components

`src/components/ui.tsx`: `Button` (`primary`, `secondary`, `ghost`, `danger`, `ink`; sizes `sm` / `md` / `lg`),
`ButtonLink`, `Card`, `SeverityBadge`, `SourceTag` (Gemini vs offline template), `Skeleton`. Icons are Phosphor,
`weight="bold"` in buttons and `fill` for status. Build new UI from these before adding classes.

## Motion

GSAP via `src/lib/motion.ts` (`useReveal`, `useCountUp`). Ease `cubic-bezier(0.16, 1, 0.3, 1)`, 200ms for state
changes. Everything honours `prefers-reduced-motion`.

## Copy

Plain, direct, second person. No em dashes in UI copy. Say what Gemini did ("Gemini classified this as...") and label
fallbacks honestly ("Offline template").
