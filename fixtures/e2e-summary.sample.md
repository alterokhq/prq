### 🔴 e2e: 1 failed, 1 passed
2 agent steps · 2 model calls · 4.1k tokens

**🔴 c3: a search box appears above the list**  
`tests/prq-smoke.e2e.ts:11`

**ASSERTION_FAILED** at step 2 of 2: `agent.assert` "a search input is visible above the suggestions", after 561ms and 1 model call

> agent.assert failed: The screen contradicts the assertion (p=0.900, confidence 0.850).

- Screen: `/`

Evidence: screenshot `.e2e/results/prq-smoke-c3-a-search-box-appears-above-65ae98605b5e3970/attempt-1/screenshots/002-failure.png`, screenshot `.e2e/results/prq-smoke-c3-a-search-box-appears-above-65ae98605b5e3970/attempt-1/screenshots/001-assert.png`, log `.e2e/results/prq-smoke-c3-a-search-box-appears-above-65ae98605b5e3970/attempt-1/screen-at-failure.txt` · Trace: `.e2e/results/prq-smoke-c3-a-search-box-appears-above-65ae98605b5e3970/trace.md`

<details>
<summary>All 2 tests in 1 file</summary>

|  | Test | Agent | Time |
| --- | --- | --- | --- |
| 🔴 | **tests/prq-smoke.e2e.ts** · 1 failed, 1 passed | 2 steps · 2 calls | 3.3s |
| 🟢 | c1: the board lists suggestions with vote counts | 1 step · 1 call | 2.5s |
| 🔴 | c3: a search box appears above the list | 1 step · 1 call | 777ms |
</details>

<sub>e2e 0.22.0 · 3.7s · web</sub>
