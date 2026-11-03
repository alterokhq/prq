# prq

**Your agent said it works. Prove it.**

`prq` checks a coding agent's completion message, locks its claims, and saves evidence for each verdict. Inspect results in the terminal or consume the complete JSON report. Fix the application, then rerun the same claims. No report app or generated HTML is needed.

Use Node.js 24.8+, npm, Git, and an OpenAI or OpenRouter key. Run inside your application's Git repository with a committed `HEAD` and installed dependencies. Models need structured output, and browser testing and screenshot judgment also need image input.

Install the CLI once in your project, then use `npx prq`:

```sh
npm install --save-dev @alterok/prq
```

Direct OpenAI uses `OPENAI_API_KEY` and defaults to `gpt-6.1-sol`. For OpenRouter set `PRQ_PROVIDER=openrouter`, `OPENROUTER_API_KEY`, and `PRQ_MODEL` to a model available to your account. `--provider`, `--model`, and `--judge-model` override environment settings. The judge defaults to the selected model in a separate context.

For browser checks:

```sh
export OPENAI_API_KEY="your-key"
npm install --save-dev e2e@0.22.0 @e2e-dev/web@0.15.4 @ai-sdk/openai@4.0.106 ai@7.0.158
npx --no-install e2e-web install chromium
npx prq init
```

Start the app separately and save the agent's message as `done.md`:

```sh
npx prq --claims done.md --app-url http://localhost:3000
npx prq fix
# Apply the fix. Commit it before command checks.
npx prq rerun
npx prq show
npx prq show --json
```

In 0.2, `--json` emits all claims and evidence. `--summary` selects the older compact view. `open` and `render` are replaced by `show`; new runs save JSON and evidence without HTML. Reports include provider/model accounting. Missing costs are unknown, never zero; browser-runner costs are currently unavailable, so any reported subtotal is labeled incomplete. Old 0.1 reports remain readable.

Reports stay in `.pr/runs/`. Browser assertions run live; command checks cover committed `HEAD` in a temporary checkout, not a security sandbox. Command-only checks can skip browser setup. Screenshots and interaction evidence go to model providers.

[User guide](https://github.com/alterokhq/prq/blob/main/docs/user-guide.md) · [Spec](https://github.com/alterokhq/prq/blob/main/SPEC.md) · [Source](https://github.com/alterokhq/prq) · [Apache-2.0](https://github.com/alterokhq/prq/blob/main/LICENSE)
