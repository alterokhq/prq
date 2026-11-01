# ✗ c3: The search is case-insensitive.

`tests/prq-3750728.e2e.ts` · failed · 9.7s

Ran on: browser `chromium 156.0.8078.4` · user agent `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/156.0.8078.4 Safari/537.36`

**ASSERTION_INCONCLUSIVE**

```text
The search for “CUSTOM FIELDS” shows no matches, but no differently cased matching suggestion or comparison search is visible to establish whether case affects results.
```

Look at: `tests/prq-3750728.e2e.ts:22`  

## Steps

1. ✓ `app.open` `/` (224ms) — `tests/prq-3750728.e2e.ts:18`
   - ℹ console: `%cDownload the React DevTools for a better development experience: https://react.dev/link/react-devtools font-weight:bold (at /_next/static/chunks/0-c6_next_dist_1ao04tiemnj5_._.js:720)`
   - ℹ console: `[HMR] connected (at /_next/static/chunks/0-c6_next_dist_1ao04tiemnj5_._.js:720)`
   - ↪ navigated to /
   - screen: 8 nodes at `/`
2. ✓ `agent.waitFor` "The page has finished its initial loading state." (2.1s, 1 model call) — `tests/prq-3750728.e2e.ts:19`
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
3. ✓ `app.screenshot` `before-setup` (65ms) — `tests/prq-3750728.e2e.ts:20`
   - [screenshot](attempt-1/screenshots/001-before-setup.png) `.pr/e2e/9cf886a9-51e9-4aad-a132-e08292b8ffab/results/prq-3750728-c3-the-search-is-case-11fd056801db3c67/attempt-1/screenshots/001-before-setup.png`
4. ✓ `agent.act` "Type an uppercase version of a visible suggestion title into the search box. This is setup only: complete this step once the requested actions are performed, regardless of the resulting application behavior. The following assertion will ch…" (4.2s, 2 model calls) — `tests/prq-3750728.e2e.ts:21`
   - cache: no replay: nothing recorded for this step yet; recording not saved: no check passed after this step (`.e2e/cache/b3045ff0eecf7b42ca5f4c18f56ae52c40a4f1b9d2e0a2ff6bafa5c33b569758.json`)
   - type "CUSTOM FIELDS" into searchbox "search suggestions" (25ms)
   - screen: 43 changes since step 2 at `/`, 8 nodes
     - `changed searchbox "search suggestions" value="CUSTOM FIELDS" (was: searchbox "search suggestions")`
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
5. ✗ `agent.assert` "The search is case-insensitive." (3.0s, 1 model call) — **ASSERTION_INCONCLUSIVE** — `tests/prq-3750728.e2e.ts:22`
   > The search for “CUSTOM FIELDS” shows no matches, but no differently cased matching suggestion or comparison search is visible to establish whether case affects results.
   - [screenshot](attempt-1/screenshots/002-assert.png) `.pr/e2e/9cf886a9-51e9-4aad-a132-e08292b8ffab/results/prq-3750728-c3-the-search-is-case-11fd056801db3c67/attempt-1/screenshots/002-assert.png`
   - screen: unchanged since step 4 at `/`

## App log

What the app logged, oldest first, with the step it happened in.

- step 1 · ℹ console: `%cDownload the React DevTools for a better development experience: https://react.dev/link/react-devtools font-weight:bold (at /_next/static/chunks/0-c6_next_dist_1ao04tiemnj5_._.js:720)`
- step 1 · ℹ console: `[HMR] connected (at /_next/static/chunks/0-c6_next_dist_1ao04tiemnj5_._.js:720)`

## Screen at failure

`http://127.0.0.1:3000/` · viewport 1280x720 · 8 nodes  

![screenshot at failure](attempt-1/screenshots/003-failure.png)

The screen as the agent reads it, one node per line: `#id role "name" text="…" [states]`.

```text
#root document "Feedback board"
 #n2 main
  #n3 heading "Feedback board"
  #n4 text="Tell us what to build next."
  #n5 textbox "Suggest a feature"
  #n6 button "Suggest"
  #n7 searchbox "search suggestions" value="CUSTOM FIELDS" [focused]
  #n12001 status "no suggestions match"
```

## Evidence

- [screenshot](attempt-1/screenshots/003-failure.png) `.pr/e2e/9cf886a9-51e9-4aad-a132-e08292b8ffab/results/prq-3750728-c3-the-search-is-case-11fd056801db3c67/attempt-1/screenshots/003-failure.png`
- [screen](attempt-1/screen-at-failure.txt) `.pr/e2e/9cf886a9-51e9-4aad-a132-e08292b8ffab/results/prq-3750728-c3-the-search-is-case-11fd056801db3c67/attempt-1/screen-at-failure.txt`
- [screenshot](attempt-1/screenshots/001-before-setup.png) `.pr/e2e/9cf886a9-51e9-4aad-a132-e08292b8ffab/results/prq-3750728-c3-the-search-is-case-11fd056801db3c67/attempt-1/screenshots/001-before-setup.png`

<sub>e2e 0.22.0 · run `01a1971d-6ac0-7979-b638-f1259fd72ad5` · the whole run is in `report.json`</sub>
