# 01 — Research: what good POS looks like, and what to borrow

Research done Nov 2026. Sources are linked so the implementer can check details. This file explains *why* the product spec makes the choices it does.

## 1. Reference products and the lesson taken from each

| Product | What they do well | Lesson for Venus |
|---------|-------------------|------------------|
| **Square POS** ([item grid](https://squareup.com/help/us/en/article/8334-set-up-item-grid), [item details](https://squareup.com/help/gb/en/article/8634-customize-item-details-settings)) | Fixed tile grid with stock on the tile; variant sheet preselects the first option and auto-advances; quantity can be set before tapping an item | Tiles in fixed positions. Config sheet that does the common case in one or two taps |
| **Square community feedback** ([thread](https://community.squareup.com/t5/Payments-Troubleshooting/Why-Square-Why-Payment-Screen/m-p/851625)) | Staff hate moving buttons; change due must be the biggest thing on screen | Never reorder tiles by popularity. Totals in the largest type on the cart |
| **Shopify POS** ([smart grid](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/customize-pos/smart-grid-management/edit), [split/partial](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/payment-management/multiple-partial-payments), [offline](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/selling-offline/offline-checkout)) | Payment method chosen first, amount defaults to remaining balance; "mark as partially paid"; offline orders get register-prefixed numbers | Payment segment on the cart (D1). Partial payment maps onto v1's existing credit model |
| **Loyverse** ([open tickets](https://help.loyverse.com/help/open-tickets), [shifts](https://help.loyverse.com/help/shift-management-loyverse-pos)) | Named "open tickets" for interrupted orders; shift close compares expected vs actual cash | Hold / park sale (D6). Shift close later (D5) |
| **Toast** ([quick order](https://support.toasttab.com/en/article/New-POS-Experience-Ordering-Screens), [orders hub](https://doc.toasttab.com/doc/platformguide/platformOrdersHubOverview.html), [offline](https://support.toasttab.com/en/article/Using-Toast-in-Offline-Mode)) | One hub for all online, takeout and delivery orders, with "snooze online ordering"; offline banner after ~40 s | One Orders tab; the busy-until control lives there as "Store status"; a clear offline chip |
| **Odoo POS** ([customer account](https://www.odoo.com/documentation/20.0/applications/sales/point_of_sale/payment_methods/customer_credit.html)) | Credit is a payment method that requires a customer; balance shown beside the name; settle from the customer row | "Owes UGX X" beside clients in the picker; Settle on the client row |
| **Lightspeed** ([features](https://www.lightspeedhq.com/pos/retail/features/)) | On-account sales with per-customer limits | Credit limit is a possible later decision (not in scope) |
| **SumUp POS Lite** ([orders](https://help.sumup.com/en-GB/articles/3gFIiSs4irLHDkX54p86oB-pos-lite-orders)) | Receipt choice on the success screen | WhatsApp receipt button on success (D3) |
| **Duuka** (Uganda, [site](https://zenjiaapp.com/)) | Cash, MTN, Airtel, bank, credit, or a mix in one sale; offline-first; UGX | Confirms the payment set for D1 |
| **F-Biz** (Kenya, [site](https://f-biz.fayvad.com/)) | Records mobile-money amount plus an optional transaction reference copied from the customer's SMS | Optional "MoMo reference" field (D1) |
| **EliteTeQ** (Uganda, [site](https://eliteteqpos.com/ug/mobile-payment-pos/)) | Close-out totals per method per cashier | Per-method totals in Insights once D1 exists |

## 2. Counter-POS UX principles (the rules the product spec follows)

1. **Speed is the product.** Starbucks targeted 80 % of orders in one tap with fixed positions for muscle memory ([case study](https://www.karminmauritz.design/case-study-a-new-pos-at-starbucks/)). Mashgin cut transactions from 48 s to 35 s with image tiles and in-cart quantity edits ([case](https://griffinwooldridge.com/design/cashier-ui)). **Venus target: a single-pack cash sale for a returning client in ≤ 6 taps; v1 measured 9–12.**
2. **Big targets.** NN/g recommends ~1 cm × 1 cm ([NN/g](https://www.nngroup.com/articles/touch-target-size/)); 44 pt / 48 dp are floors. **Venus: 48 px minimum, 56 px for steppers and flavour chips, 64 px for the Charge bar.**
3. **Thumb zone.** Primary action in a full-width bottom bar; content in the middle ([Hoober](https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php)).
4. **Undo over confirm.** Routine actions (remove line, clear cart) get an undo toast. Confirm only irreversible or costly actions (void a sale, cancel a customer's order, delete a client), and label buttons with the action ([NN/g confirmation dialogs](https://www.nngroup.com/articles/confirmation-dialog/)).
5. **Light, high contrast by default.** Positive polarity reads better in most lighting ([NN/g dark mode](https://www.nngroup.com/articles/dark-mode/)). Tabular numerals for money.
6. **Colour never alone.** Every status (paid, credit, pending, offline, low stock) pairs colour with an icon or a word.
7. **Visible state after every tap.** Double entries are a real failure mode: every tap gets feedback within 50 ms, and submit buttons lock while in flight.

## 3. Uganda specifics

- **UGX has no minor unit.** Store integers. Never show ".00". v1's `formatUGX` (`js/utils.js:1-3`) is the display authority. Port it exactly; do not switch to `Intl` currency formatting, which outputs "USh".
- **Phones:** display `0772 123 456`, store as v1 stores them (do not normalise existing data).
- **Mobile money:** MTN MoMo and Airtel Money dominate. POS apps record the method, amount, and optionally the transaction ID from the customer's SMS. MTN settles T+1 to T+3, so mobile payments are "received", not "settled".
- **Receipts:** WhatsApp is the norm. A `https://wa.me/<number>?text=<urlencoded>` link needs no API, no cost, and no backend.
- **EFRIS compliance:** URA's e-receipt mandate extends to some non-VAT businesses. **Out of scope** for this overhaul, but the receipt model should not make a future integration harder. The owner should confirm applicability with their accountant ([URA notice](https://ura.go.ug/en/additional-taxpayers-required-to-use-efris/)).

## 4. Open-source projects

| Project | License | Verdict |
|---------|---------|---------|
| [FreeKasir](https://github.com/jipraks/kasirgratisan) (React 18, TS, Dexie, Workbox) | MIT | **Best reference.** Read its phone-first cashier screen that becomes side-by-side in landscape, and its open bills. Small pieces may be adapted with attribution in `docs/image-credits.md`-style `docs/third-party.md` |
| [Small POS](https://github.com/longnick/small-pos-open-source) (React 19, Dexie, Vitest, Playwright) | MIT | Read its test harness setup for ideas |
| [Simpos](https://github.com/hieuhani/simpos) (bakery POS, XState checkout) | MIT | Patterns only; its checkout state machine is a good mental model for ours |
| Odoo `point_of_sale` | LGPLv3 | Patterns only: numpad button spec and customer-account flow |
| OpenSourcePOS, uniCenta, Floreant, Saleor | Various | Not useful (wrong stack, restrictive licenses, or desktop admin) |

**Decision: do not clone a POS project.** Venus's hard parts (flavour pools, bulk tiers, partner settlement, SafeBoda quotes, storefront order deck) are custom. Copy patterns, not code. If any code is adapted, record the source, license and file in `docs/third-party.md`.

## 5. Her Voice: what to port, and what not to

Her Voice (`C:\Users\Admin\Desktop\Projects\her-voice-app`) is the owner's highest-craft PWA. Its principles carry over; its brand does not.

### Port these principles

| Her Voice principle | Where it lives in Her Voice | How it applies to POS |
|---------------------|-----------------------------|-----------------------|
| A written design constitution with protected decisions and a banned list | `DESIGN.md` | `venus-pos/DESIGN.md` (draft in `03-design-system.md`) |
| One token file with ramps → semantic roles; one UI kit | `packages/shared/design/tokens.css`, `packages/shared/ui.tsx` | `src/styles/tokens.css`, `src/ui/*` |
| Persistent chrome that never remounts on navigation | `FloatingChrome` in `packages/shared/ui.tsx`, mounted once in `apps/student/src/App.tsx` | `TopBar` and `NavBar` mounted once in `App.tsx` |
| History-backed sheets: Android back closes the sheet, not the app | `useHistorySheet` in `packages/shared/router.tsx` | Every `Sheet` registers a history entry |
| Tiny custom history router with lazy route chunks and idle prefetch | `packages/shared/router.tsx`, `apps/student/src/App.tsx` | `src/app/router.ts` |
| Fit screens: fixed-layout screens use `100dvh`, document scroll elsewhere, no trapped inner scroll | `Screen fit`, `useFitRoute` | Register uses document scroll with a sticky cart bar; auth and success fit the viewport |
| Press feedback: scale 0.965 + haptic on meaningful taps | `components.css` `.btn:active`, `haptic()` in `ui.tsx` | Same on tiles, steppers, Charge |
| One signature motion moment; everything else quiet | Get help disc | "Sale recorded" check on the Charge bar |
| Reduced motion collapses durations globally | `tokens.css` media query | Same |
| Build ID baked in; service worker cache named per build; `build.txt` | `packages/shared/build.ts`, `scripts/vite-perf.ts` | `__BUILD_ID__`, SW precache from the Vite manifest |
| Route chunks + preload hints generated at build time | `scripts/vite-perf.ts` (`routeChunks`) | Same idea for POS routes |
| Low-end and Save-Data guards | `lowEnd()` in `packages/shared/fx.ts` | Skip non-essential motion and prefetch |
| Copy rules: sentence case, verbs on buttons, errors say how to fix | `DESIGN.md` §Copy | Same rules |
| Design QA gallery route | `/system`, `/screens` | `/system` route, admin only |

Files worth reading for implementation reference (read only; adapt to Preact and POS needs):
- `packages/shared/router.tsx` — history router, `useHistorySheet`, leave guards
- `packages/shared/ui.tsx` — `Sheet` drag-to-dismiss, `ToastHost`, `Button` loading state, `haptic`
- `packages/shared/tabslide.ts` — sliding tab indicator
- `packages/shared/build.ts` — build check
- `scripts/vite-perf.ts` — SW precache injection and route chunk meta
- `apps/student/public/sw.js` — build-stamped shell cache

### Do not port

- The rose / paper / plum palette, Bricolage and Hanken fonts, illustrations — wrong brand.
- Privacy cover, quick exit, PIN lock, decoy exit — a safety product's threat model, not a staff register's.
- Canvas water, 3D orb, TTS greeting — consumer emotion; POS needs density and speed.
- localStorage-only data — POS already has a real backend.
- Lenis smooth scroll — app UI should use native scrolling.
- GSAP on the critical path — POS uses CSS and the Web Animations API (see `03-design-system.md §6`).
