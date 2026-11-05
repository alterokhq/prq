import { stripVTControlCharacters } from "node:util";
import {
  type Claim,
  coverageIssues,
  coverageSummary,
  type DraftClaim,
  type ProofRequest,
} from "@prq/core";
import stringWidth from "string-width";

export interface TerminalStream {
  write(text: string): unknown;
  isTTY?: boolean;
  columns?: number;
  rows?: number;
}

export interface TerminalView {
  prepare(): void;
  start(input: {
    subject: ProofRequest["subject"];
    claims: readonly DraftClaim[];
    hash: string;
  }): void;
  progress(claimId: string, message: string): void;
  resolve(claim: Claim): void;
  finish(pr: ProofRequest, options: { reportPath: string }): void;
  stop(): void;
}

/** Strip terminal control sequences from untrusted claims, observations and app output. */
function plain(text: string): string {
  return Array.from(stripVTControlCharacters(text), (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || (code >= 127 && code <= 159) ? " " : character;
  })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function wrap(text: string, width: number): string[] {
  const words = plain(text).split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line);
      line = "";
    }
    let rest = word;
    while (rest.length > width) {
      if (line) {
        lines.push(line);
        line = "";
      }
      lines.push(rest.slice(0, width));
      rest = rest.slice(width);
    }
    line = line ? `${line} ${rest}` : rest;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** TTY columns count grapheme cells, not UTF-16 code units. */
function wrapCells(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of plain(text).split(" ")) {
    if (line && stringWidth(`${line} ${word}`) > width) {
      lines.push(line);
      line = "";
    }
    if (line) line += " ";
    for (const { segment } of graphemes.segment(word)) {
      if (line && stringWidth(line + segment) > width) {
        lines.push(line);
        line = "";
      }
      line += segment;
    }
  }
  if (line.trimEnd()) lines.push(line.trimEnd());
  return lines.length ? lines.map((part) => part.trimEnd()) : [""];
}

export function createTerminalView(
  options: { quiet?: boolean; json?: boolean; stream?: TerminalStream } = {},
): TerminalView {
  const stream = options.stream ?? process.stderr;
  const enabled = !options.quiet && !options.json;
  const live = Boolean(stream.isTTY) && enabled;
  const color = live && !process.env.NO_COLOR;
  const width = Math.max(24, Math.min(stream.columns ?? 92, 100) - 8);
  const columns = Math.max(24, Math.min(stream.columns ?? 80, 120));
  const contentWidth = columns - 4;
  const tint = (code: number, text: string) => (color ? `\u001b[${code}m${text}\u001b[0m` : text);
  const muted = (text: string) => tint(90, text);
  const write = (text: string) => {
    if (enabled) stream.write(text);
  };
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const ascii = /^(C|POSIX)$/.test(process.env.LC_ALL ?? process.env.LANG ?? "");
  const glyph = ascii
    ? { held: "+", broken: "x", needs_human: "?", unverified: "o" }
    : { held: "✓", broken: "✗", needs_human: "?", unverified: "○" };
  const resolved = new Map<string, Claim>();
  const steps = new Map<string, string>();
  let claims: readonly DraftClaim[] = [];
  let timer: ReturnType<typeof setInterval> | undefined;
  let tick = 0;
  let drawnLines = 0;
  let started = 0;
  let subject: ProofRequest["subject"] = { head: "" };
  let hash = "";
  let finished: ProofRequest | undefined;
  let staticTTY = false;
  let preparing = false;
  const printed = new Set<string>();

  function clear() {
    if (live && drawnLines) {
      stream.write(`\u001b[${drawnLines}A\r\u001b[0J`);
      drawnLines = 0;
    }
  }

  function row(claim: DraftClaim, result?: Claim): string[] {
    const symbol = result
      ? glyph[result.verdict]
      : ascii
        ? "."
        : (frames[tick % frames.length] ?? "⠋");
    const painted =
      result?.verdict === "held"
        ? tint(32, symbol)
        : result?.verdict === "broken"
          ? tint(31, symbol)
          : muted(symbol);
    const lines = wrap(claim.text, width - 4);
    const output = lines.map((line, i) => `${i === 0 ? `  ${painted} ` : "    "}${line}`);
    if (result?.verdict === "broken") {
      output.push(
        ...wrap(`- claimed  ${claim.text}`, width - 4).map((line) => tint(31, `    ${line}`)),
      );
      output.push(
        ...wrap(`+ observed ${result.observed ?? "See the recorded evidence."}`, width - 4).map(
          (line) => `    ${line}`,
        ),
      );
    } else if (result?.observed)
      output.push(...wrap(result.observed, width - 4).map((line) => muted(`    ${line}`)));
    const meta = result
      ? [
          result.verdict.replaceAll("_", " "),
          result.duration_ms === undefined ? "" : `${(result.duration_ms / 1000).toFixed(1)}s`,
          result.cached ? "setup replayed · assertions checked live" : "",
        ]
          .filter(Boolean)
          .join(" · ")
      : (steps.get(claim.id) ??
        (claim.kind === "human" ? "waiting for a person" : "waiting to check"));
    output.push(...wrap(meta, width - 4).map((line) => muted(`    ${line}`)), "");
    return output;
  }

  function pair(left: string, right: string, available: number): string {
    return `${left}${" ".repeat(Math.max(2, available - stringWidth(left) - stringWidth(right)))}${right}`;
  }

  function summary(pr: ProofRequest): string {
    const s = pr.summary;
    return `held ${s.held} · ${s.broken ? tint(31, `broken ${s.broken}`) : "broken 0"} · needs a human ${s.needs_human}${s.unverified ? ` · unverified ${s.unverified}` : ""}`;
  }

  function header(): string[] {
    const wide = columns >= 80 && !ascii;
    const inset = wide ? 18 : 2;
    const available = columns - inset - 2;
    const elapsed = `${((Date.now() - started) / 1000).toFixed(1)}s`;
    const state = finished
      ? summary(finished)
      : steps.size || resolved.size
        ? `running · ${resolved.size} of ${claims.length} resolved · ${elapsed}`
        : `${claims.length} claims · checking`;
    const head = /^[a-f0-9]{40,64}$/i.test(subject.head) ? subject.head.slice(0, 7) : subject.head;
    const lines = [
      pair(tint(1, "proof request"), muted("v0.1"), available),
      ...wrapCells(`${subject.repo ?? "local project"} · ${head}`, available).map(muted),
      ...wrapCells(plain(state), available).map((line) =>
        finished ? line.replace(/broken [1-9]\d*/, (text) => tint(31, text)) : muted(line),
      ),
      muted(`locked #${hash}`),
    ];
    const logo = [
      `${muted("█▀▀█ █▀▀ ")}█▀▀█`,
      `${muted("█▄▄█ █   ")}█▄▄█`,
      `${muted("█        ")}   █`,
    ];
    return [
      "",
      ...lines.map(
        (line, index) => `${wide ? `  ${logo[index] ?? " ".repeat(13)}   ` : "  "}${line}`,
      ),
      "",
    ];
  }

  function details(label: string, text: string, red = false): string[] {
    const prefix = `${label} `.padEnd(12);
    return wrapCells(text, Math.max(4, contentWidth - 15)).map((line, index) => {
      const lead = index === 0 ? prefix : " ".repeat(prefix.length);
      return `     ${red ? tint(31, `${lead}${line}`) : `${muted(lead)}${line}`}`;
    });
  }

  function liveRow(claim: DraftClaim, result?: Claim): string[] {
    const symbol = result
      ? glyph[result.verdict]
      : claim.kind === "human"
        ? glyph.unverified
        : ascii
          ? "."
          : (frames[tick % frames.length] ?? "⠋");
    const painted =
      result?.verdict === "held"
        ? tint(32, symbol)
        : result?.verdict === "broken"
          ? tint(31, symbol)
          : muted(symbol);
    const meta = result
      ? result.verdict === "needs_human"
        ? "needs a human"
        : result.verdict === "unverified"
          ? "unverified"
          : result.duration_ms === undefined
            ? result.verdict
            : `${(result.duration_ms / 1000).toFixed(1)}s`
      : claim.kind === "human"
        ? "human"
        : steps.has(claim.id)
          ? `${((Date.now() - started) / 1000).toFixed(1)}s`
          : claim.kind;
    const available = Math.max(4, contentWidth - 3 - meta.length - 2);
    const lines = wrapCells(claim.text, available);
    const output = lines.map((line, index) =>
      index === 0 ? `  ${painted}  ${pair(line, muted(meta), contentWidth - 3)}` : `     ${line}`,
    );
    if (result?.verdict === "broken") {
      output.push(...details("- claimed", claim.text, true));
      output.push(...details("+ observed", result.observed ?? "See the recorded evidence."));
    } else if (result?.verdict === "unverified" && result.observed) {
      output.push(...details("○ reason", result.observed));
    } else if (result?.cached) {
      output.push(
        ...wrapCells("└ setup replayed · assertions checked live", contentWidth - 3).map((line) =>
          muted(`     ${line}`),
        ),
      );
    } else if (!result && steps.has(claim.id)) {
      output.push(
        ...wrapCells(`└ ${steps.get(claim.id)}`, contentWidth - 3).map((line) =>
          muted(`     ${line}`),
        ),
      );
    }
    if (
      result?.evidence?.some(
        (item) => item.type === "note" && item.text?.includes("ASSERTION_INCONCLUSIVE"),
      )
    ) {
      const explanation =
        result.judge && result.probability !== undefined
          ? "tester inconclusive · judge assessed recorded evidence"
          : "tester inconclusive · see recorded evidence";
      output.push(...wrapCells(explanation, contentWidth - 3).map((line) => muted(`     ${line}`)));
    }
    return output;
  }

  function draw() {
    if (!live || staticTTY) return;
    clear();
    const lines = [
      ...header(),
      ...claims.flatMap((claim) => liveRow(claim, resolved.get(claim.id))),
    ];
    if (!finished && lines.length >= (stream.rows ?? 24) - 1) {
      // Never move the cursor above a frame that has scrolled out of the viewport.
      staticTTY = true;
      stop();
      write(`${header().join("\n")}\n`);
      for (const claim of resolved.values()) {
        write(`${liveRow(claim, claim).join("\n")}\n`);
        printed.add(claim.id);
      }
      return;
    }
    write(`${lines.join("\n")}\n`);
    drawnLines = lines.length;
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = undefined;
    if (preparing) {
      stream.write("\r\u001b[2K");
      preparing = false;
    }
    if (live) stream.write("\u001b[?25h");
  }

  return {
    prepare() {
      if (!live) return;
      stop();
      preparing = true;
      const drawPreparation = () =>
        write(
          `\r  ${muted(ascii ? "." : (frames[tick++ % frames.length] ?? "⠋"))} prq · preparing checks`,
        );
      drawPreparation();
      timer = setInterval(drawPreparation, 80);
      timer.unref();
    },
    start(input) {
      stop();
      claims = input.claims;
      resolved.clear();
      steps.clear();
      started = Date.now();
      subject = input.subject;
      finished = undefined;
      staticTTY = false;
      printed.clear();
      hash = plain(input.hash.replace(/^sha256:/, "").slice(0, 7));
      if (!live) {
        write(`\n  ${tint(1, "prq")}  proof request${muted(`  #${hash}`)}\n`);
        write(
          `${wrap(`${input.subject.repo ?? "local project"} · ${input.subject.head}`, width)
            .map((line) => muted(`       ${line}`))
            .join("\n")}\n`,
        );
        write(`${muted(`       ${claims.length} claims locked before checking`)}\n\n`);
      }
      if (live) {
        stream.write("\u001b[?25l");
        draw();
        if (staticTTY) return;
        timer = setInterval(() => {
          tick++;
          draw();
        }, 80);
        timer.unref();
      }
    },
    progress(claimId, message) {
      steps.set(claimId, plain(message));
      draw();
    },
    resolve(claim) {
      resolved.set(claim.id, claim);
      if (live && staticTTY) {
        write(`${liveRow(claim, claim).join("\n")}\n`);
        printed.add(claim.id);
      } else if (live) draw();
      else write(`${row(claim, claim).join("\n")}\n`);
    },
    finish(pr, { reportPath }) {
      stop();
      if (live) {
        finished = pr;
        for (const claim of pr.claims) resolved.set(claim.id, claim);
        if (staticTTY) {
          for (const claim of pr.claims) {
            if (!printed.has(claim.id)) write(`${liveRow(claim, claim).join("\n")}\n`);
          }
          write(
            `\n${wrapCells(plain(summary(pr)), contentWidth)
              .map((line) => `  ${line}`)
              .join("\n")}\n`,
          );
        } else draw();
        drawnLines = 0;
      }
      const coverageProblems = coverageIssues(pr);
      const coverageLines = [coverageSummary(pr), ...coverageProblems.slice(0, 5)];
      if (coverageProblems.length > 5)
        coverageLines.push("More coverage issues are in the full report.");
      for (const line of coverageLines)
        write(`  ${wrapCells(plain(line), contentWidth).join("\n  ")}\n`);
      const s = pr.summary;
      const reported = pr.timing?.reported_cost_usd;
      const cost = pr.timing?.cost_usd;
      const costLine =
        typeof cost === "number"
          ? `cost $${cost.toFixed(6)}`
          : typeof reported === "number"
            ? `reported cost $${reported.toFixed(6)} · total unavailable`
            : "cost unavailable";
      const models = [
        ...new Set((pr.model_usage ?? []).map((row) => `${row.provider}/${row.model}`)),
      ];
      if (!models.length && pr.configuration)
        models.push(`${pr.configuration.provider}/${pr.configuration.model}`);
      if (models.length)
        write(`  ${wrap(`models ${models.join(" · ")}`, contentWidth).join("\n  ")}\n`);
      write(`  ${costLine}\n`);
      if (live) {
        const duration =
          pr.timing?.total_ms === undefined ? "" : `${(pr.timing.total_ms / 1000).toFixed(1)}s`;
        write(`\n  ${pair(muted(`locked #${hash}`), duration, contentWidth)}\n`);
        const testers = [
          ...new Set(pr.claims.flatMap((claim) => (claim.tester ? [claim.tester] : []))),
        ];
        const judges = [
          ...new Set(pr.claims.flatMap((claim) => (claim.judge ? [claim.judge] : []))),
        ];
        for (const [label, identities] of [
          ["tester", testers],
          ["judge", judges],
        ] as const) {
          if (identities.length)
            write(
              `${wrapCells(`${label} ${identities.join(" · ")}`, contentWidth)
                .map((line) => `  ${muted(line)}`)
                .join("\n")}\n`,
            );
        }
        write(
          `\n${wrapCells(`→ ${reportPath}`, contentWidth)
            .map((line) => `  ${line}`)
            .join("\n")}\n`,
        );
        if (s.broken || pr.claims.some((claim) => claim.signoff?.decision === "rejected"))
          write(
            `${wrapCells("→ prq fix  hand the repair items back to the agent", contentWidth)
              .map((line) => `  ${line}`)
              .join("\n")}\n`,
          );
        write("\n");
        return;
      }
      const result = `held ${s.held} · ${s.broken ? tint(31, `broken ${s.broken}`) : "broken 0"} · needs a human ${s.needs_human}${s.unverified ? ` · unverified ${s.unverified}` : ""}`;
      write(`  ${result}\n`);
      write(
        `  ${muted(`${pr.timing?.total_ms === undefined ? "" : `${(pr.timing.total_ms / 1000).toFixed(1)}s · `}locked #${plain(pr.source.hash.replace(/^sha256:/, "").slice(0, 7))}`)}\n\n`,
      );
      write(
        `${wrap(`→ ${reportPath}`, width)
          .map((line) => `  ${line}`)
          .join("\n")}\n`,
      );
      if (s.broken || pr.claims.some((claim) => claim.signoff?.decision === "rejected"))
        write(`  ${muted("→")} prq fix  ${muted("hand the repair items back to the agent")}\n`);
      write("\n");
    },
    stop,
  };
}
