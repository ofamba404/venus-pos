# Baseline timings

Local Playwright, mock backend. Unthrottled rows are not the budget in `04-architecture.md` §9. The throttled row uses a Fast 4G approximation (150 ms latency, 1.6 Mbps down, 750 kbps up) and 4× CPU. It is one sample on the mock, not a pass against the 2.0 s cold-start budget. D11 has not approved the look. Legacy home at 1280 still crops the product grid below the first screen.

| Capture | Viewport | Ready (ms) |
| --- | --- | ---: |
| next-sell-360x740 | 360×740 | 1949 |
| next-sell-390x844 | 390×844 | 1431 |
| next-sell-768x1024 | 768×1024 | 968 |
| next-sell-1280x800 | 1280×800 | 786 |
| next-stock-360x740 | 360×740 | 815 |
| next-stock-390x844 | 390×844 | 797 |
| next-stock-768x1024 | 768×1024 | 850 |
| next-stock-1280x800 | 1280×800 | 811 |
| legacy-home-360x740 | 360×740 | 1011 |
| legacy-home-390x844 | 390×844 | 891 |
| legacy-home-768x1024 | 768×1024 | 775 |
| legacy-home-1280x800 | 1280×800 | 674 |
| next-sell-390x844-throttled | 390×844 | 7922 |

Ready means the first sell tile, stock quantity, or legacy product row was visible after navigation.

The throttled row above was captured against the Vite dev server (one request per module), not a production bundle. That is why 7922 ms is far from the 2.0 s cold-start budget in `04-architecture.md` §9.

A later sample loaded `vite build` output (`dist/next`, static server on port 4174, SPA fallback) at 390×844 with the same 4× CPU and Fast 4G profile. The Scout tile was visible at **2094 ms**. That is one run, taken while the contract suite was also running, so it is a ceiling rather than a quiet median of five. It still misses the 2.0 s budget by about 0.1 s. The residual is font preload plus the throttled main bundle, not the dev-server waterfall. This sample is not a budget pass.
