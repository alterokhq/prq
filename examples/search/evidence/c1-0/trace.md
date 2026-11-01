# ✓ c1: A search box appears above the list.

`tests/prq-3750728.e2e.ts` · passed · 12.2s

Ran on: browser `chromium 156.0.8078.4` · user agent `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/156.0.8078.4 Safari/537.36`

## Steps

1. ✓ `app.open` `/` (408ms) — `tests/prq-3750728.e2e.ts:4`
   - ℹ console: `%cDownload the React DevTools for a better development experience: https://react.dev/link/react-devtools font-weight:bold (at /_next/static/chunks/0-c6_next_dist_1ao04tiemnj5_._.js:720)`
   - ℹ console: `[HMR] connected (at /_next/static/chunks/0-c6_next_dist_1ao04tiemnj5_._.js:720)`
   - ↪ navigated to /
   - screen: 8 nodes at `/`
2. ✓ `agent.waitFor` "The page has finished its initial loading state." (9.2s, 2 model calls) — `tests/prq-3750728.e2e.ts:5`
   - waitFor passed after 2 reads in 0ms
   - screen: 42 changes since step 1 at `/`, 48 nodes
     - `added list`
     - `added listitem "0 votes Custom fields"`
     - `added button "0 votes"`
     - `added text="0"`
     - `added text="Custom fields"`
     - `added listitem "0 votes Mobile app"`
     - `added button "0 votes"`
     - `added text="0"`
     - `added text="Mobile app"`
     - `added listitem "0 votes Public API"`
     - `added button "0 votes"`
     - `added text="0"`
     - 30 more
3. ✓ `agent.assert` "A search box appears above the list." (2.3s, 1 model call) — `tests/prq-3750728.e2e.ts:6`
   - [screenshot](attempt-1/screenshots/001-assert.png) `.pr/e2e/9cf886a9-51e9-4aad-a132-e08292b8ffab/results/prq-3750728-c1-a-search-box-appears-above-3f1f9b5c781e17da/attempt-1/screenshots/001-assert.png`
   - screen: unchanged since step 2 at `/`

## App log

What the app logged, oldest first, with the step it happened in.

- step 1 · ℹ console: `%cDownload the React DevTools for a better development experience: https://react.dev/link/react-devtools font-weight:bold (at /_next/static/chunks/0-c6_next_dist_1ao04tiemnj5_._.js:720)`
- step 1 · ℹ console: `[HMR] connected (at /_next/static/chunks/0-c6_next_dist_1ao04tiemnj5_._.js:720)`

## Evidence

- [screenshot](attempt-1/screenshots/001-assert.png) `.pr/e2e/9cf886a9-51e9-4aad-a132-e08292b8ffab/results/prq-3750728-c1-a-search-box-appears-above-3f1f9b5c781e17da/attempt-1/screenshots/001-assert.png`

<sub>e2e 0.22.0 · run `01a1971d-6ac0-7979-b638-f1259fd72ad5` · the whole run is in `report.json`</sub>
