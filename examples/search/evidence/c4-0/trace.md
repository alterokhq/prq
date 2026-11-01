# ✓ c4: When nothing matches, the board shows "no suggestions match".

`tests/prq-3750728.e2e.ts` · passed · 9.4s

Ran on: browser `chromium 156.0.8078.4` · user agent `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/156.0.8078.4 Safari/537.36`

## Steps

1. ✓ `app.open` `/` (175ms) — `tests/prq-3750728.e2e.ts:26`
   - ℹ console: `%cDownload the React DevTools for a better development experience: https://react.dev/link/react-devtools font-weight:bold (at /_next/static/chunks/0-c6_next_dist_1ao04tiemnj5_._.js:720)`
   - ℹ console: `[HMR] connected (at /_next/static/chunks/0-c6_next_dist_1ao04tiemnj5_._.js:720)`
   - ↪ navigated to /
   - screen: 8 nodes at `/`
2. ✓ `agent.waitFor` "The page has finished its initial loading state." (2.3s, 1 model call) — `tests/prq-3750728.e2e.ts:27`
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
3. ✓ `app.screenshot` `before-setup` (66ms) — `tests/prq-3750728.e2e.ts:28`
   - [screenshot](attempt-1/screenshots/001-before-setup.png) `.pr/e2e/9cf886a9-51e9-4aad-a132-e08292b8ffab/results/prq-3750728-c4-when-nothing-matches-the-29f47bb85f1f73b0/attempt-1/screenshots/001-before-setup.png`
4. ✓ `agent.act` "Type a visible suggestion title followed by extra characters into the search box. This is setup only: complete this step once the requested actions are performed, regardless of the resulting application behavior. The following assertion wi…" (4.2s, 2 model calls) — `tests/prq-3750728.e2e.ts:29`
   - cache: no replay: nothing recorded for this step yet; recording saved (`.e2e/cache/8d3ee33edd8d2684cdc4c1d828c309ce61833dcb97139382f4fb6d4501a7b304.json`)
   - type "Custom fields xyzabc" into searchbox "search suggestions" (19ms)
   - screen: 43 changes since step 2 at `/`, 8 nodes
     - `changed searchbox "search suggestions" value="Custom fields xyzabc" (was: searchbox "search suggestions")`
     - `added status "no suggestions match"`
     - `removed list`
     - `removed listitem "0 votes Custom fields"`
     - `removed button "0 votes"`
     - `removed text="0"`
     - `removed text="Custom fields"`
     - `removed listitem "0 votes Mobile app"`
     - `removed button "0 votes"`
     - `removed text="0"`
     - `removed text="Mobile app"`
     - `removed listitem "0 votes Public API"`
     - 31 more
5. ✓ `agent.assert` "When nothing matches, the board shows "no suggestions match"." (2.6s, 1 model call) — `tests/prq-3750728.e2e.ts:30`
   - [screenshot](attempt-1/screenshots/002-assert.png) `.pr/e2e/9cf886a9-51e9-4aad-a132-e08292b8ffab/results/prq-3750728-c4-when-nothing-matches-the-29f47bb85f1f73b0/attempt-1/screenshots/002-assert.png`
   - screen: unchanged since step 4 at `/`

## App log

What the app logged, oldest first, with the step it happened in.

- step 1 · ℹ console: `%cDownload the React DevTools for a better development experience: https://react.dev/link/react-devtools font-weight:bold (at /_next/static/chunks/0-c6_next_dist_1ao04tiemnj5_._.js:720)`
- step 1 · ℹ console: `[HMR] connected (at /_next/static/chunks/0-c6_next_dist_1ao04tiemnj5_._.js:720)`

## Evidence

- [screenshot](attempt-1/screenshots/001-before-setup.png) `.pr/e2e/9cf886a9-51e9-4aad-a132-e08292b8ffab/results/prq-3750728-c4-when-nothing-matches-the-29f47bb85f1f73b0/attempt-1/screenshots/001-before-setup.png`

<sub>e2e 0.22.0 · run `01a1971d-6ac0-7979-b638-f1259fd72ad5` · the whole run is in `report.json`</sub>
