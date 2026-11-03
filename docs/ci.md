# Continuous integration

The CI workflow runs on pull requests, pushes to `main`, and manual dispatch. It uses read-only repository access and no provider keys. Fork pull requests run the same checks without deployment or publishing credentials.

Checks cover a frozen dependency installation, build, typecheck, lint, unit/integration tests and installation of the packed CLI outside the workspace. Linux runs on the minimum supported Node 24.8 and current Node 24; macOS 15 Intel runs on current Node 24. The explicit `macos-15-intel` label avoids the ARM runner capacity shortage that cancelled jobs before any steps ran. This matrix does not currently cover macOS ARM; restore that coverage when runner availability permits. Build runs before tests because CLI tests execute the built binary.

The separate secret scan checks full checked-out Git history and working files with Gitleaks. Findings are redacted in logs. Its release binary is pinned and verified against a committed SHA-256 checksum; GitHub Actions are pinned to commit SHAs.

Run the same checks locally:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm lint
pnpm test
node scripts/smoke-package.mjs
```

The package check installs production dependencies with lifecycle scripts disabled, checks the published file list and runs the installed command without model credentials. On CLI versions with `show`, it also reads a historical report as full JSON.

These checks do not evaluate live models, run an application browser journey, publish npm packages or deploy anything. Paid evaluations and releases need separate, explicit workflows. A green CI run establishes the checks above, not that every claim about a change is true.
