# ✓ c2: Typing filters the suggestions as you type.

`tests/prq-3750728.e2e.ts` · passed · 8.8s

Ran on: browser `chromium 156.0.8078.4` · user agent `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/156.0.8078.4 Safari/537.36`

## Steps

1. ✓ `app.open` `/` (274ms) — `tests/prq-3750728.e2e.ts:10`
   - ℹ console: `%cDownload the React DevTools for a better development experience: https://react.dev/link/react-devtools font-weight:bold (at /_next/static/chunks/0-c6_next_dist_1ao04tiemnj5_._.js:720)`
   - ℹ console: `[HMR] connected (at /_next/static/chunks/0-c6_next_dist_1ao04tiemnj5_._.js:720)`
   - ↪ navigated to /
   - screen: 8 nodes at `/`
2. ✓ `agent.waitFor` "The page has finished its initial loading state." (2.0s, 1 model call) — `tests/prq-3750728.e2e.ts:11`
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
3. ✓ `app.screenshot` `before-setup` (72ms) — `tests/prq-3750728.e2e.ts:12`
   - [screenshot](attempt-1/screenshots/001-before-setup.png) `.pr/e2e/9cf886a9-51e9-4aad-a132-e08292b8ffab/results/prq-3750728-c2-typing-filters-the-cc57a0449acfd8a0/attempt-1/screenshots/001-before-setup.png`
4. ✓ `agent.act` "Type a visible suggestion title into the search box. This is setup only: complete this step once the requested actions are performed, regardless of the resulting application behavior. The following assertion will check correctness." (4.2s, 2 model calls) — `tests/prq-3750728.e2e.ts:13`
   - cache: no replay: nothing recorded for this step yet; recording saved (`.e2e/cache/e97fc1c84eee3bbff1f373df050217f9565c51c3390a150b22e1489282870679.json`)
   - type "Custom fields" into searchbox "search suggestions" (36ms)
   - screen: 37 changes since step 2 at `/`, 12 nodes
     - `changed searchbox "search suggestions" value="Custom fields" (was: searchbox "search suggestions")`
     - `removed listitem "0 votes Mobile app"`
     - `removed button "0 votes"`
     - `removed text="0"`
     - `removed text="Mobile app"`
     - `removed listitem "0 votes Public API"`
     - `removed button "0 votes"`
     - `removed text="0"`
     - `removed text="Public API"`
     - `removed listitem "0 votes Bulk edit"`
     - `removed button "0 votes"`
     - `removed text="0"`
     - 25 more
5. ✓ `agent.assert` "Typing filters the suggestions as you type." (2.2s, 1 model call) — `tests/prq-3750728.e2e.ts:14`
   - [screenshot](attempt-1/screenshots/002-assert.png) `.pr/e2e/9cf886a9-51e9-4aad-a132-e08292b8ffab/results/prq-3750728-c2-typing-filters-the-cc57a0449acfd8a0/attempt-1/screenshots/002-assert.png`
   - screen: unchanged since step 4 at `/`

## App log

What the app logged, oldest first, with the step it happened in.

- step 1 · ℹ console: `%cDownload the React DevTools for a better development experience: https://react.dev/link/react-devtools font-weight:bold (at /_next/static/chunks/0-c6_next_dist_1ao04tiemnj5_._.js:720)`
- step 1 · ℹ console: `[HMR] connected (at /_next/static/chunks/0-c6_next_dist_1ao04tiemnj5_._.js:720)`

## Evidence

- [screenshot](attempt-1/screenshots/001-before-setup.png) `.pr/e2e/9cf886a9-51e9-4aad-a132-e08292b8ffab/results/prq-3750728-c2-typing-filters-the-cc57a0449acfd8a0/attempt-1/screenshots/001-before-setup.png`

<sub>e2e 0.22.0 · run `01a1971d-6ac0-7979-b638-f1259fd72ad5` · the whole run is in `report.json`</sub>
