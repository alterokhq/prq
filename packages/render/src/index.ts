import type { Claim, Evidence, ProofRequest } from "@prq/core";
import { fixPrompt } from "@prq/core/fix-prompt";
import { imageScript, script } from "./script.js";
import { styles } from "./styles.js";
import { wordmark } from "./wordmark.js";

const glyph = { held: "✓", broken: "✗", needs_human: "?", unverified: "○" };
const word = {
  held: "held",
  broken: "broken",
  needs_human: "needs a human",
  unverified: "unverified",
};

function esc(value: string | number): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function json(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
}

/** App-controlled evidence paths must not cause network requests or escape the run. */
function evidencePath(value: string | undefined): string | undefined {
  if (!value || !/^[a-zA-Z0-9_./ -]+$/.test(value) || value.startsWith("/")) return;
  if (value.split("/").some((part) => part === ".." || part === "")) return;
  return value.split("/").map(encodeURIComponent).join("/");
}

function shortHash(pr: ProofRequest): string {
  return pr.source.hash.replace(/^sha256:/, "").slice(0, 7);
}
function duration(ms: number | undefined): string {
  return ms === undefined ? "" : `${(ms / 1000).toFixed(1)}s`;
}

function summary(pr: ProofRequest): string {
  return `held ${pr.summary.held} <span class="separator">·</span> <span class="${pr.summary.broken ? "broken-text" : ""}">broken ${pr.summary.broken}</span> <span class="separator">·</span> needs a human ${pr.summary.needs_human}${pr.summary.unverified ? ` <span class="separator">·</span> unverified ${pr.summary.unverified}` : ""}`;
}

function copyButton(label: string, value: string, primary = false): string {
  return `<button type="button" class="${primary ? "primary" : ""}" data-copy="${esc(value)}">${esc(label)}</button>`;
}

function screenshotCaption(e: Evidence): string {
  const label = `${e.path?.split("/").at(-1) ?? ""} ${e.text ?? ""}`;
  if (/before[- ]setup/i.test(label)) return "before setup";
  if (/(?:^|[-_ ])assert(?:ion)?(?:[-_. ]|$)/i.test(label)) return "assertion screen";
  if (/(?:^|[-_ ])failure(?:[-_. ]|$)/i.test(label)) return "screen when check stopped";
  return e.step === undefined ? "recorded screen" : `step ${e.step}`;
}

function judgmentNote(claim: Claim): string {
  if (!claim.evidence?.some((e) => e.type === "note" && e.text?.includes("ASSERTION_INCONCLUSIVE")))
    return "";
  return `<p class="judge">The tester marked its assertion inconclusive.${claim.judge ? ` The independent judge assessed the recorded evidence and returned <strong>${word[claim.verdict]}</strong>.` : ""} The tester’s original observation is preserved above.</p>`;
}

function screenshot(e: Evidence, claim: Claim): string {
  const path = evidencePath(e.path);
  if (!path)
    return `<p class="muted">Screenshot unavailable: the evidence path must be local to this run.</p>`;
  return `<figure><a href="${esc(path)}" target="_blank" rel="noopener"><img class="evidence-image" src="${esc(path)}" alt="Recorded screen for claim ${esc(claim.id)}${e.step === undefined ? "" : `, step ${esc(e.step)}`}" loading="lazy"></a><figcaption>${esc(screenshotCaption(e))} <span>↗ open full size</span></figcaption></figure>`;
}

function evidenceItem(e: Evidence, claim: Claim): string {
  if (e.type === "screenshot") return screenshot(e, claim);
  let text: string;
  switch (e.type) {
    case "http":
      text = [[e.method, e.url, e.status].filter((v) => v !== undefined).join(" "), e.text]
        .filter((v) => v !== undefined)
        .join("\n");
      break;
    case "command":
      text = [
        `$ ${e.command ?? "command not recorded"}`,
        `exit ${e.exit_code ?? "not recorded"}`,
        e.stdout,
        e.stderr,
      ]
        .filter((v) => v !== undefined)
        .join("\n");
      break;
    case "console":
      text = `${e.level ? `${e.level}: ` : ""}${e.text ?? "No console text recorded."}`;
      break;
    case "assertion":
      text = `${e.passed === undefined ? "" : e.passed ? "check held · " : "check contradicted · "}${e.text ?? "No assertion text recorded."}`;
      break;
    case "note":
      text = e.text ?? "No note text recorded.";
      break;
  }
  return `<div class="evidence-item"><span class="evidence-kind">${esc(e.type)}</span><pre>${esc(text)}</pre></div>`;
}

function signoff(claim: Claim): string {
  if (claim.signoff)
    return `<div class="signoff-record"><strong>${esc(claim.signoff.decision)} by ${esc(claim.signoff.by)}</strong><span>${esc(claim.signoff.at)}</span>${claim.signoff.reason ? `<p>${esc(claim.signoff.reason)}</p>` : ""}</div>`;
  if (claim.verdict !== "needs_human") return "";
  return `<form class="signoff-form" data-claim="${esc(claim.id)}"><p>Make the call, then run the command in your project to record it.</p><div class="form-fields"><label>Your name<input name="by" required placeholder="Name" value="${esc(claim.assignee ?? "")}" autocomplete="name"></label><label>Decision<select name="decision"><option value="accept">accept</option><option value="reject">reject</option></select></label><label class="reason"><span>Reason <span class="muted">optional</span></span><input name="reason" placeholder="What informed your decision?"></label></div><button type="submit">Prepare signoff command</button><div class="prepared-command" hidden><pre tabindex="0"></pre><button type="button" data-copy-command>Copy command</button><p class="muted">This page does not save your decision. Run the command to update the report.</p></div></form>`;
}

function claimRow(claim: Claim): string {
  const observed =
    claim.observed ??
    (claim.verdict === "needs_human"
      ? "A person needs to decide this claim."
      : claim.verdict === "unverified"
        ? "No completed check was recorded."
        : "No observation recorded.");
  const main =
    claim.verdict === "broken"
      ? `<div class="claim-copy"><div class="minus"><span>- claimed</span><s>${esc(claim.text)}</s></div><div class="plus"><span>+ observed</span><span>${esc(observed)}</span></div></div>`
      : `<div class="claim-copy"><p class="claim-text">${esc(claim.text)}</p><p class="observation">${esc(observed)}</p></div>`;
  const evidence = claim.evidence ?? [];
  return `<details class="claim-row ${claim.verdict}"${claim.verdict === "broken" ? " open" : ""}><summary><span class="glyph" aria-label="${word[claim.verdict]}">${glyph[claim.verdict]}</span>${main}<span class="row-meta"><span class="verdict">${word[claim.verdict]}</span><span>${esc(duration(claim.duration_ms))}</span><span class="expand-label">evidence <span class="chevron">⌄</span></span></span></summary><div class="claim-detail"><div class="provenance"><span>${esc(claim.id)} · ${esc(claim.kind)}</span>${claim.tester ? `<span>tester ${esc(claim.tester)}</span>` : ""}${claim.cached ? "<span>setup replayed · assertions checked live</span>" : ""}</div>${judgmentNote(claim)}${evidence.length ? `<div class="evidence-grid">${evidence.map((e) => evidenceItem(e, claim)).join("")}</div>` : '<p class="muted">No machine evidence recorded.</p>'}${claim.judge ? `<p class="judge">judge ${esc(claim.judge)}${claim.probability === undefined ? "" : ` · probability the claim holds <strong>${claim.probability.toFixed(2)}</strong>`}</p>` : ""}${signoff(claim)}</div></details>`;
}

function document(title: string, body: string, extra = "", className = ""): string {
  return `<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><meta name="referrer" content="no-referrer"><title>${esc(title)} · proof request</title><style>${styles}</style></head><body class="${className}">${body}${extra}</body></html>`;
}

/** Render only the supplied proof request. No file access, network, or model calls. */
export function renderPage(pr: ProofRequest): string {
  const fix = fixPrompt(pr);
  const title = pr.subject.title ?? "Proof request";
  const body = `<main class="report"><header class="topbar"><a class="brand" href="#top" aria-label="Proof request"><img src="${wordmark}" alt="prq"><span>proof request</span></a><div class="toolbar"><button type="button" data-theme-toggle aria-label="Switch to light theme">light theme</button><button type="button" data-download>Download JSON</button></div></header><section class="overview" id="top"><div class="run-context"><span>${esc(pr.subject.repo ?? "local project")} · ${esc(pr.subject.head)}</span><span>${esc(pr.created_at)}</span></div><h1>${esc(title)}</h1><p class="summary">${summary(pr)}</p><div class="lock-line"><span class="lock-icon" aria-hidden="true">▣</span><span>${pr.claims.length} ${pr.claims.length === 1 ? "claim" : "claims"} locked <code title="${esc(pr.source.hash)}">#${esc(shortHash(pr))}</code></span><span>before any check ran</span></div><div class="actions">${fix ? copyButton("Copy fix prompt", fix, true) : ""}${copyButton("Copy rerun command", "prq rerun")}<a class="button" href="card.html">Open share card ↗</a></div></section><details class="source"><summary><span>claims from <strong>${esc(pr.source.kind.replaceAll("_", " "))}</strong></span><span class="chevron">⌄</span></summary><blockquote>${esc(pr.source.text)}</blockquote><p>The original source is shown in full. The locked claims appear below.</p></details><section class="claims" aria-label="Claim verdicts">${pr.claims.length ? pr.claims.map(claimRow).join("") : `<div class="empty"><h2>No claims recorded</h2><p>Provide the agent's completion message with <code>prq --claims done.md</code>.</p></div>`}</section><footer><div><span class="hash-pattern" aria-hidden="true">${hashPattern(shortHash(pr))}</span><code title="${esc(pr.source.hash)}">#${esc(shortHash(pr))}</code></div><span>${esc(duration(pr.timing?.total_ms))}</span><p>Claims locked before checking. Judgment is recorded per claim.</p><span>prq ${esc(pr.version)} · Apache-2.0</span></footer></main><div class="copy-notice" role="status" aria-live="polite"></div><dialog class="copy-fallback"><form method="dialog"><h2>Copy this text</h2><textarea aria-label="Text to copy" readonly></textarea><button type="submit">Done</button></form></dialog>`;
  return document(
    title,
    body,
    `<script type="application/json" id="proof-data">${json(pr)}</script><script>${script}</script>`,
  );
}

function hashPattern(hash: string): string {
  return Array.from(hash)
    .map((ch) => {
      const n = Number.parseInt(ch, 16);
      return Number.isNaN(n) ? "·" : `${n & 1 ? "▪" : "·"}${n & 2 ? "▪" : "·"}${n & 4 ? "▪" : "·"}`;
    })
    .join(" ");
}

/** A fixed 1200 × 630 standalone page ready to capture as an image. */
export function renderCard(pr: ProofRequest): string {
  const broken = pr.claims.find((c) => c.verdict === "broken");
  const screen = broken?.evidence?.findLast((e) => e.type === "screenshot" && evidencePath(e.path));
  const content = broken
    ? `<div class="card-proof"><div class="card-broken"><p class="minus"><span>- claimed</span><s>${esc(broken.text)}</s></p><p class="plus"><span>+ observed</span><span>${esc(broken.observed ?? "See the recorded evidence.")}</span></p></div>${screen && broken ? screenshot(screen, broken) : ""}</div>`
    : `<ul class="card-claims">${pr.claims
        .slice(0, 4)
        .map(
          (c) =>
            `<li class="${c.verdict}"><span class="glyph">${glyph[c.verdict]}</span><span>${esc(c.text)}</span></li>`,
        )
        .join(
          "",
        )}${pr.claims.length > 4 ? `<li class="muted">+ ${pr.claims.length - 4} more claims in the report</li>` : ""}</ul>`;
  return document(
    "Proof request card",
    `<main class="share-card"><header><img src="${wordmark}" alt="prq"><span>proof request</span><code>#${esc(shortHash(pr))}</code></header><div class="card-heading"><p class="muted">${esc(pr.subject.repo ?? "local project")} · ${esc(pr.subject.head)}</p><h1>${esc(pr.subject.title ?? "Proof request")}</h1><p class="summary">${summary(pr)}</p></div>${content}<footer><strong>Your agent said it works. Prove it.</strong><span>${pr.claims.length} ${pr.claims.length === 1 ? "claim" : "claims"} locked${pr.timing?.total_ms === undefined ? "" : ` · ${esc(duration(pr.timing.total_ms))}`}</span></footer></main>`,
    `<script>${imageScript}</script>`,
    "card-body",
  );
}

export function renderMarkdown(pr: ProofRequest): string {
  const safe = (text: string) =>
    text
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replace(/[\\`*_[\]]/g, "\\$&")
      .replaceAll("\n", " ");
  return [
    `**proof request** #${safe(shortHash(pr))} · held ${pr.summary.held} · broken ${pr.summary.broken} · needs a human ${pr.summary.needs_human} · unverified ${pr.summary.unverified}`,
    "",
    ...pr.claims.map(
      (c) =>
        `- ${glyph[c.verdict]} ${safe(c.text)} _(${word[c.verdict]})_${c.observed ? `\n  observed: ${safe(c.observed)}` : ""}`,
    ),
  ].join("\n");
}
