# Baseline timings

Local Playwright, unthrottled, mock backend. This is not the throttled budget in `04-architecture.md` §9. D11 has not approved the look.

| Capture | Viewport | Ready (ms) |
| --- | --- | ---: |
| next-sell-390x844 | 390×844 | 1930 |
| next-sell-1280x800 | 1280×800 | 1264 |
| next-stock-390x844 | 390×844 | 907 |
| next-stock-1280x800 | 1280×800 | 1263 |
| legacy-home-390x844 | 390×844 | 1235 |
| legacy-home-1280x800 | 1280×800 | 1033 |

Ready means the first sell tile, stock quantity, or legacy product row was visible after navigation.
