# Baseline timings (latest capture)

Local Playwright, mock backend. Unthrottled rows are not the budget in `04-architecture.md` §9. The throttled row uses a Fast 4G approximation (150 ms latency, 1.6 Mbps down, 750 kbps up) and 4× CPU. It is one sample on the mock, not a pass against the 2.0 s cold-start budget. D11 approved the current look on 2026-11-12. Legacy home at 1280 still crops the product grid below the first screen. This file is the latest capture only. The kept record is perf.md.

| Capture | Viewport | Ready (ms) |
| --- | --- | ---: |
| next-sell-360x740 | 360×740 | 293 |
| next-sell-390x844 | 390×844 | 214 |
| next-sell-768x1024 | 768×1024 | 190 |
| next-sell-1280x800 | 1280×800 | 194 |
| next-stock-360x740 | 360×740 | 205 |
| next-stock-390x844 | 390×844 | 187 |
| next-stock-768x1024 | 768×1024 | 213 |
| next-stock-1280x800 | 1280×800 | 229 |
| legacy-home-360x740 | 360×740 | 223 |
| legacy-home-390x844 | 390×844 | 145 |
| legacy-home-768x1024 | 768×1024 | 132 |
| legacy-home-1280x800 | 1280×800 | 197 |
| next-sell-390x844-throttled | 390×844 | 11637 |

Ready means the first sell tile, stock quantity, or legacy product row was visible after navigation.
