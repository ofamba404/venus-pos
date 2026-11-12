# 03 — Design system

In Phase 4, copy §1–§8 of this file to `venus-pos/DESIGN.md`. From then on `DESIGN.md` is the source of truth, and any UI change must follow it.

---

## 1. Direction

**"Ink, paper, and flavour."** Venus POS is the back of the Venus shop: the same black-and-natural-white world as the storefront, set for speed at a counter. The chrome is monochrome ink on paper. **The only colour in the interface is flavour**: each flavour's own colour, taken from the catalog (`CAT_MAP`), appears on tiles, chips, slot meters, cart lines and stock cards. A cashier reads a cart by its colours before reading words. That is the one memorable idea; everything else stays quiet.

Feel: calm, exact, fast. Premium through restraint and precise type, not decoration.

## 2. Protected decisions (do not change without the owner)

1. Light theme only in v2. Tokens are structured so a dark theme can be added later (D10).
2. Fonts: **Geograph** (UI), **Akkurat Mono** (all money, counts, times, IDs), **Self Modern** (display moments only). Self-hosted from `assets/fonts/` (files already exist in POS and match the storefront).
3. Primary actions are solid ink. There is no brand-coloured primary button. Bronze is the accent, from the same family as the store's Rewards page but used tactically, only where it marks state or a delivery context, never as decoration (celebration, focus, active-nav marker, Delivery tag, copy pills, chart bars, quantity badge, selected ring). Green is for paid, done and success only. Red is for overdue and errors. Flavour colours never change.
4. Flavour colours come only from the catalog. Never invent a flavour colour; never use flavour colour for text.
5. Money is always mono, semibold, with tabular numerals, plain ink with no highlight, formatted by `formatUGX`. Akkurat Mono ships one weight (400), so semibold is the browser's synthesised bold until a real bold file is added.
6. One signature motion: the "sale recorded" check (§6.3). Nothing else animates for decoration.
7. Document scroll. No nested scroll containers except inside sheets and the wide-screen cart pane.
8. Bottom nav on phones, left rail at ≥ 960 px.

## 3. Tokens

All values below are the implementation. Hex values appear **only** in `src/styles/tokens.css`. Stylelint enforces this (see `04-architecture.md §8`).

### 3.1 Colour — ramps (from `venus-store/css/global.css`)

| Token | Value | Store source |
|-------|-------|--------------|
| `--ink-900` | `#212121` | `--color-black` |
| `--ink-700` | `#575757` | `--color-light-charcoal` |
| `--ink-500` | `#5f6673` | `--color-gray-500`, darkened from `#6b7280` so meta text clears 4.5:1 on `--bg` |
| `--ink-300` | `#d1d5db` | `--color-gray-300` |
| `--paper-0` | `#ffffff` | `--color-white` |
| `--paper-50` | `#f5f4f1` | `--color-natural-white-25` |
| `--paper-100` | `#ece9e2` | `--color-natural-white-60` |
| `--paper-200` | `#e0dacf` | `--color-natural-white` |
| `--stroke-400` | `#cdcdcd` | `--color-stroke` |
| `--red-700` | `#9c0f0f` | `--color-red` |
| `--green-600` | `#16a34a` | `--color-green-600` |
| `--green-700` | `#15803d` | Success fill (white icon on it ≥ 5:1) |
| `--bronze` | `#8a6a3a` | Store Rewards bronze (`--rewards-bronze`). Solid fill with white text (Delivery tag, quantity badge, 5.0:1), borders, nav marker, chart bars, focus and selected rings. Small text only on white or the page (5.0:1). On the wash use `--bronze-deep` |
| `--bronze-deep` | `#6e542c` | Store `--rewards-bronze-deep`. Small bronze label text on any light surface, including the wash (≥ 5.9:1) |
| `--wash` / `--wash-strong` | `#f3ebe0` / `#e8dcc8` | Store `--rewards-wash` / `--rewards-wash-strong`. Warm panel fill, used tactically for the loaded order, the delivery block, the copy pills, the celebration and the login glow. Everything else stays neutral paper. `--wash-strong` is the Review sale text on ink (≥ 11.9:1) and the low-stock tag fill |
| `--pink-300` | `#f4a6c1` | Storefront pink. Source of `--pink-tint` |

### 3.2 Colour — semantic roles (use these in components, never ramps)

| Role | Value | Use |
|------|-------|-----|
| `--bg` | `var(--paper-50)` | App background |
| `--surface` | `var(--paper-0)` | Tiles, cards, sheets, bars |
| `--surface-sunk` | `var(--paper-100)` | Wells, inputs, segmented track |
| `--surface-selected` | `var(--paper-200)` | Selected rows/chips (non-primary) |
| `--fg` | `var(--ink-900)` | Primary text and icons |
| `--fg-2` | `var(--ink-700)` | Secondary text (≥ 4.5:1 on `--bg`) |
| `--fg-3` | `var(--ink-500)` | Meta text on plain surfaces (≥ 4.77:1 on every light surface except selected-row grey). On a tint, step up to `--fg-2` |
| `--fg-disabled` | `var(--ink-300)` | Disabled text/icons (never for information) |
| `--line` | `var(--paper-200)` | Dividers, card borders |
| `--line-strong` | `var(--stroke-400)` | Input borders, swatch outlines |
| `--action` | `var(--ink-900)` | Primary button fill, active tab or filter pill, cart bar |
| `--accent` / `--accent-ink` | `var(--ink-900)` | Brand ink for chart lines, bars and links. It was green before the retheme |
| `--money` | `var(--ink-900)` | Money and key numbers (totals, amounts): ink, 16:1 on white and ≥ 14:1 on every tint, plain, with no decoration behind it. Semibold (600) with tabular numerals. Bronze is never used for money |
| `--pink-tint` | `#fdeef4` | KPI tiles. Not for product tiles, and the loaded order uses `--wash`, not pink |
| `--on-action` | `var(--paper-0)` | Text on primary |
| `--danger` | `var(--red-700)` | Destructive buttons, debt amounts, errors |
| `--success` | `var(--green-700)` | Green means paid, done or success only: success check, "Paid" tag, Live dot, copied tick |
| `--success-ink` / `--success-tint` | `#14532d` / `#e5f6f1` | Small text on a paid tag; paid chips |
| `--warn-bg` / `--warn-fg` | `var(--wash-strong)` / `var(--bronze-deep)` | Low-stock tags and banners |
| `--scrim` | `rgb(33 33 33 / 0.32)` | Behind sheets and dialogs |
| `--focus` | `var(--bronze)` | 2 px bronze focus ring + 2 px offset |

### 3.3 Flavour colour

- Source: `CAT_MAP[id].color` in `src/domain/catalog.ts` (ported from `js/config.js:104-116` and `COOKIE_FLAVORS`).
- Rendered through one component, `FlavorDot` / `FlavorSwatch`, which sets `--flavor` inline. That is the only place a non-token colour enters the UI.
- Every swatch has a 1 px inset `--line-strong` ring so pale flavours (Coconut `#ffffff`, Grape `#D5C7E8`, Bangis 70/30 `#FFFFA5`) stay visible.
- Text on a flavour fill (slot meter segments with labels): choose `--ink-900` or `--paper-0` by relative luminance (threshold 0.5). Unit-test this helper.
- Hollow dot (ring only) = out of stock.

### 3.4 Typography

Load with `@font-face`, `font-display: swap`, preload Geograph 400 and Akkurat Mono (the two above-the-fold faces). Self Modern loads on demand.

| Token | Family | Size / line-height | Weight | Use |
|-------|--------|--------------------|--------|-----|
| `--t-display` | Self Modern | 32 / 1.1 | 400 | Success total, back-office page heroes (max one per screen) |
| `--t-title` | Geograph | 20 / 1.25 | 500 | Sheet titles, section heads |
| `--t-title-sm` | Geograph | 17 / 1.3 | 500 | Tile names, top-bar title, card titles |
| `--t-body` | Geograph | 16 / 1.45 | 400 | Body, inputs (never below 16 px in inputs) |
| `--t-label` | Geograph | 14 / 1.3 | 500 | Buttons, chips, nav labels |
| `--t-meta` | Geograph | 13 / 1.35 | 400 | Timestamps, helper text |
| `--t-money-xl` | Akkurat Mono | 28 / 1.1 | 600 | Cart total, stock counts |
| `--t-money` | Akkurat Mono | 16 / 1.3 | 600 | Prices, line totals |
| `--t-mono-micro` | Akkurat Mono | 11 / 1.2, `letter-spacing: 0.06em`, uppercase | 400 | Group headers ("JOINTS"), order IDs. The only uppercase in the app |

- All numerals: `font-variant-numeric: tabular-nums`.
- Max line length 68ch on back-office text.
- Geograph has no 600/700; never synthesise bold. Emphasis = size or 500 weight.

### 3.5 Space, size, radius, elevation

- **Space scale** (4 px base): `--s-1` 4, `--s-2` 8, `--s-3` 12, `--s-4` 16, `--s-5` 20, `--s-6` 24, `--s-8` 32, `--s-10` 40, `--s-12` 48.
- Page gutter: 16 px phone, 24 px ≥ 600 px. Tile gap: 10 px phone, 12 px wide.
- **Hit targets**: `--hit` 48 px (minimum), `--hit-lg` 56 px (steppers, flavour chips, list rows), `--hit-xl` 64 px (Charge, CartBar, nav).
- **Radius** — two values plus pill, nothing else:
  - `--r-lg` **20 px** (store `--radius`): tiles, cards, sheets (top corners), dialogs.
  - `--r-md` **12 px** (store `--radius-xl`): buttons, inputs, chips, stock steppers.
  - `--r-pill` 999 px: badges, segmented thumb, nav indicator, flavour dots.
- **Elevation**: `--e-0` none (default; surfaces separate by colour and `--line`). `--e-1` `0 1px 2px rgb(33 33 33 / .06)` for the CartBar and NavBar only. `--e-2` `0 12px 32px rgb(33 33 33 / .14)` for sheets and dialogs only. No other shadows.

### 3.6 Motion tokens

| Token | Value |
|-------|-------|
| `--d-instant` | 80 ms |
| `--d-fast` | 140 ms |
| `--d-base` | 220 ms |
| `--d-slow` | 320 ms |
| `--ease-out` | `cubic-bezier(.2, .8, .2, 1)` |
| `--ease-in-out` | `cubic-bezier(.4, 0, .2, 1)` (store `--ease-in-out`) |
| `--ease-spring` | `linear(0, .55 12%, .92 24%, 1.04 36%, 1.01 52%, 1)` (sampled spring; fallback `--ease-out`) |

`@media (prefers-reduced-motion: reduce)`: every duration token becomes `1ms`; the check ring renders fully drawn; no transforms on press (opacity change only).

## 4. Components (`src/ui/`)

Each component has one `.tsx` and one co-located `.css` file, class prefix `v-` (e.g. `.v-btn`). Each appears in the `/system` gallery with every variant and state.

| Component | Variants / props | Notes |
|-----------|------------------|-------|
| `Button` | `primary` (ink), `secondary` (surface + `--line-strong` border), `ghost` (text), `danger` (danger fill); sizes `md` 48, `lg` 56, `xl` 64; `loading`, `disabled`, `icon` | Loading keeps width, shows spinner, sets `aria-busy`. Disabled: `--surface-sunk` fill, `--fg-disabled` text (must look different from primary) |
| `IconButton` | `md` 48, `sm` 40 (only inside dense rows, with 48 px hit area via padding) | Requires `label` (aria-label) |
| `Tile` | product tile (§02 4.2) | Press scale 0.97 |
| `FlavorDot`, `FlavorSwatch` | size 8/10/16/24; `hollow` | Only consumer of raw flavour colour |
| `SlotMeter` | `slots`, `filled[]` | Segment fill transitions `--d-fast` |
| `FlavorChip` | count, stock, disabled reason | 56 px; body tap = +1; steppers appear when count > 0 |
| `Stepper` | `size: md 48 / lg 56`, min, max | Long-press repeats after 400 ms at 8/s |
| `Keypad` | integer UGX / count; keys 1–9, 0, 000, ⌫; optional quick keys | Keys 64 px; no decimal key |
| `Segmented` | 2–5 options | Sliding thumb (`--d-base`, spring) |
| `Field`, `TextInput`, `NumberInput` | label, hint, error | 16 px text minimum; error text in `--danger` with icon |
| `Autocomplete` | async options, create option | `role="combobox"`, keyboard support |
| `Chip` | `default`, `selected`, `copy` (copies value, toast "Copied") | 40 px min height |
| `Badge` | count, dot | Pop animation on increase |
| `Tag` | `paid`, `credit`, `low`, `out`, `delivery`, `store`, `reward` | Always icon + word |
| `Money` | `size: md / xl`, `tone` | Wraps `formatUGX` |
| `Sheet` | `size: auto / full`; `dismissible: true / 'handle-only' / false` | History-backed; focus trap; drag on handle; right panel at ≥ 960 px |
| `Dialog` | `title`, `body`, `confirmLabel`, `cancelLabel`, `tone: danger` | Destructive confirmations only |
| `Toast` | message, optional action | `ToastHost` in shell; `role="status"` |
| `ListRow` | leading, title, meta, trailing, chevron | 56 px min |
| `Section` | `title` (mono micro), `action` | Sticky option for group headers |
| `Skeleton` | text, block, tile | Matches final geometry; shimmer disabled in reduced motion |
| `EmptyState` | icon, title, body, action | One per screen, never decorative filler |
| `TopBar`, `NavBar`, `Rail`, `CartBar` | shell | Mounted once |
| `Icon` | name | From `src/ui/icons.tsx` |

States every interactive component must show in the gallery: default, hover (pointer devices), pressed, focus-visible, disabled, loading (where relevant), error (where relevant).

## 5. Iconography

- Custom inline SVG set in `src/ui/icons.tsx`, 24 × 24 viewBox, 1.75 px stroke, round caps and joins, `currentColor`. No icon library dependency, and no icons inside rounded-square containers.
- **Hand-drawn for Venus** (brand glyphs): `sell` (price tag with a cut corner), `orders` (shop bag with a notch), `stock` (three stacked jars), `insights` (rising line with one node), `more` (three dots in a soft row), `delivery` (adapt `assets/icon-motorbike.svg` to the stroke spec), `cookie` (round with three bite marks), `pack` (rolled pack), `credit` (ledger page), `cash` (folded note), `momo` (phone with a signal arc), `receipt` (torn-edge slip).
- **Generic glyphs** (plus, minus, close, check, chevron-left/right, search, undo, copy, phone, pin, clock, bell, user, offline, sync, warning, star, trash, edit): simple geometric paths drawn to the same spec. The WhatsApp button uses the official WhatsApp glyph.
- Nav icons have an outline (inactive) and a filled (active) variant.

## 6. Motion

**Rule: motion answers a tap or a state change. It never decorates.** CSS transitions and the Web Animations API only. No GSAP, no Lenis.

### 6.1 Allowed motion

| Moment | Spec |
|--------|------|
| Press (buttons, tiles, chips, steppers) | `transform: scale(.97)` on `:active`, `--d-instant`; spring back `--d-fast` |
| Haptic | `navigator.vibrate(10)` on add-to-sale, stepper, charge; 15 ms on sale recorded. Guarded by support and a Settings toggle (default on) |
| Sheet open/close | translateY 100% → 0, `--d-base` `--ease-out`; scrim opacity `--d-base`. Wide: translateX from right |
| Segmented / nav indicator | thumb slides `--d-base` `--ease-spring` |
| Slot meter fill | segment fill colour `--d-fast` |
| Line added to cart | the CartBar total cross-fades (`--d-fast`), and the bar does one 2 px lift (`--d-fast`). No flying elements |
| Line removed | height collapse `--d-fast` then Undo toast |
| Badge increase | scale 1 → 1.2 → 1, `--d-base` spring |
| Toast | translateY 8 px + fade, `--d-base` |
| Skeleton | 1.2 s shimmer loop; off in reduced motion |

### 6.2 Banned

- Entrance animations on lists or re-renders (v1's `animateModalContent` stagger).
- Fade-up on scroll, counters that count up, parallax, smooth-scroll hijacking.
- Page transitions between tabs (switching is instant; views are kept alive).
- Anything that delays input or the next sale.
- Looping motion outside skeletons and the Live dot (which uses a 2 s opacity pulse, off in reduced motion).

### 6.3 The signature moment: "Sale recorded"

1. The Charge button's label fades out (`--d-instant`).
2. The button narrows to a 64 px circle (`--d-base`, `--ease-out`), keeping its ink fill.
3. A paper-coloured check stroke draws inside it via `stroke-dashoffset` (`--d-slow`), with the 15 ms haptic at the start.
4. The success content (total in display serif, method, client) cross-fades in beneath it (`--d-base`), and `New sale` receives focus.

Total ≈ 420 ms. The success content and `New sale` are interactive from the first frame. In reduced motion, the check appears drawn and content appears instantly.

## 7. Layout rules

- 4 px grid; every spacing value is a token.
- Phone baseline 360 × 640 (smallest supported). Every fixed layout (auth, success, config sheet footer) must fit without scrolling at 360 × 640.
- Sell must show at least 6 tiles above the CartBar on a 360 × 740 screen.
- Wide two-pane at ≥ 960 px; max content width 1280 px, centred.
- Sticky elements: TopBar, group headers (Sell), CartBar, sheet footers. Nothing else sticks.
- Safe areas: `env(safe-area-inset-*)` on TopBar, NavBar, CartBar, sheets.

## 8. Banned list

- Jade/green brand chrome, gradients, glossy or 3D treatments, coloured shadows, grain.
- Figtree, Inter, Roboto, or system fonts as the brand face (system fonts are fallbacks only).
- More than two radii (plus pill).
- Shadows outside `--e-1` and `--e-2`.
- `!important` (except inside the reduced-motion media query).
- Hex or `rgb()` literals outside `tokens.css` (flavour colours enter only via `FlavorDot`/`FlavorSwatch`).
- Emoji in UI, `→` appended to button labels, exclamation marks in copy.
- Hover-lift on cards; identical card grids where items differ in role.
- Hidden gestures as the only way to do something (every swipe has a visible button equivalent).

## 9. Theme colour and manifest

- `<meta name="theme-color" content="#f5f4f1">` on every entry (matches `--bg`).
- Manifest: `background_color: "#f5f4f1"`, `theme_color: "#f5f4f1"`. Keep `name`, `short_name`, `scope`, `launch_handler`, icons. **Keep `start_url: "/"` and add `"id": "/"`.** The v1 manifest has no `id`, so browsers identify the installed app by its start URL. Changing `start_url` without pinning `id` can make installed phones treat v2 as a different app. Update shortcuts to `/orders` and `/stock`.
- Regenerate maskable icons only if the owner provides new art; otherwise keep the current icon files.


## Contrast rules (enforced)

`node scripts/check-contrast.mjs` prints every token pair and `tests/unit/contrast.test.ts` fails the build below the threshold. `tests/e2e/contrast-render.spec.ts` runs axe on the rendered tint screens.

- Text is at least 4.5:1 on every surface it can sit on. Key numbers (money, totals, body ink) are at least 7:1.
- Where same-hue tinted text looks muddy (bronze on the wash, green on green tint), the text is ink and the tint stays the surface. Bronze is a pill fill, a border, a dot or a ring. Small bronze text uses `--bronze-deep` on the wash, and bronze is never a stroke behind a number.
- Grey meta (`--fg-3`) is for plain surfaces. On pink, the wash, grape, berry and success tints it steps up to `--fg-2`.
- No stylesheet outside `tokens.css` hard-codes a text colour.
