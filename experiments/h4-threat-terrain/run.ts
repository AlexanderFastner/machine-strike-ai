/**
 * H4 — the threat term on high ground, as docs/heuristics.md §H4 registers it.
 *
 *   node --import tsx experiments/h4-threat-terrain/run.ts
 *   PAIRS_SCALE=0.05 node --import tsx experiments/h4-threat-terrain/run.ts   # smoke test
 *
 * Four parts, in the order they are allowed to be believed:
 *   1. identity   — splitting the term moved nothing, or nothing below compares to H3
 *   2. confirm    — H3's nineteen points on Mountains, on seeds it has never played
 *   3. which half — the -5 penalty, or the +3 bonus
 *   4. dose       — every board, against how much high ground it has; Flat is the control
 *   5. weight     — a scale on `threatened`, searched then confirmed on fresh seeds
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { agentByName } from "@ms/ai";
import { TEAMS, gameMetrics, mirror, rebuild, recordGame, type MatchSetup } from "@ms/arena";
import { BOARDS } from "@ms/arena/node";
import { TERRAIN_MOD, parseBoard } from "@ms/engine";

const scale = Number(process.env.PAIRS_SCALE ?? 1);
const pairs = (n: number) => Math.max(2, Math.round(n * scale));

type Outcome = {
  label: string;
  a: string; b: string; board: string;
  pairs: number; seed0: number;
  /** Every game's final position, so two agents can be asked whether they played differently. */
  checksums: string[];
  wins: number; losses: number; draws: number;
  score: number; low: number; high: number;
  rounds: number; firstAttack: number; problems: number;
  seconds: number;
};

function matchup(label: string, a: string, b: string, board: string, nPairs: number, seed0: number): Outcome {
  const setup: MatchSetup = { board: BOARDS[board], teams: mirror(TEAMS.standard), corruption: true };
  const A = agentByName(a), B = agentByName(b);
  let wins = 0, losses = 0, draws = 0, rounds = 0, firstAttack = 0, problems = 0;
  const pairScores: number[] = [];
  const checksums: string[] = [];
  const t0 = performance.now();

  for (let seed = seed0; seed < seed0 + nPairs; seed++) {
    let pairScore = 0;
    for (const aFirst of [true, false]) {
      const replay = aFirst ? recordGame(A, B, setup, seed) : recordGame(B, A, setup, seed);
      const m = gameMetrics(replay, rebuild(replay));
      checksums.push(replay.result.checksum);
      problems += m.problems.length;
      rounds += m.rounds;
      firstAttack += m.firstAttackRound ?? m.rounds;

      const w = replay.result.winner;
      const s = w === "draw" ? 0.5 : w === (aFirst ? 1 : 2) ? 1 : 0;
      if (s === 1) wins++; else if (s === 0) losses++; else draws++;
      pairScore += s / 2;
    }
    pairScores.push(pairScore);
  }

  // Pairs, not games, are the independent unit: the two games of a pair share a seed.
  const n = pairScores.length;
  const mean = pairScores.reduce((x, y) => x + y, 0) / n;
  const sd = Math.sqrt(pairScores.reduce((x, y) => x + (y - mean) ** 2, 0) / Math.max(n - 1, 1));
  const half = 1.96 * (sd / Math.sqrt(n));

  return {
    label, a, b, board, pairs: n, seed0, checksums,
    wins, losses, draws,
    score: mean, low: Math.max(0, mean - half), high: Math.min(1, mean + half),
    rounds: rounds / (n * 2), firstAttack: firstAttack / (n * 2), problems, seconds: (performance.now() - t0) / 1000,
  };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const gain = (r: Outcome) => (r.score - 0.5) * 100;

const run = (label: string, a: string, b: string, board: string, n: number, seed0: number) => {
  const r = matchup(label, a, b, board, pairs(n), seed0);
  console.log(
    `${label}: ${pct(r.score)} [${pct(r.low)}, ${pct(r.high)}] over ${r.pairs * 2} games on ${board} — ` +
      `${gain(r) >= 0 ? "gains" : "costs"} ${Math.abs(gain(r)).toFixed(1)} points ` +
      `(${r.rounds.toFixed(1)} rounds, ${r.seconds.toFixed(0)}s, ${r.problems} replay problems)`,
  );
  return r;
};

/** Hill and mountain tiles: how much high ground a board has for the term to fight. */
function highGround(board: string) {
  const grid = parseBoard(BOARDS[board]);
  let tiles = 0, total = 0;
  for (const row of grid)
    for (const t of row)
      if (TERRAIN_MOD[t] > 0) { tiles++; total += TERRAIN_MOD[t]; }
  return { tiles, total };
}

// 1 — instrument check: the split changed no behaviour -----------------------------
console.log("Instrument check — splitting the term must not have moved the plain agent\n");
const split = matchup("split", "heuristic:threatened=1:threatening=1", "greedy", "mountains", pairs(15), 1);
const plain = matchup("plain", "heuristic", "greedy", "mountains", pairs(15), 1);
const identical = split.checksums.filter((c, i) => c === plain.checksums[i]).length;
console.log(`threatened=1,threatening=1 played ${identical} of ${plain.checksums.length} games identically to plain heuristic\n`);

// 2 — confirmation on fresh seeds ---------------------------------------------------
console.log("Confirmation — H3 measured threat=0 on Mountains over seeds 1-50; these are seeds 1001 on\n");
const confirm = run("threat=0, Mountains, fresh seeds", "heuristic:threat=0", "heuristic", "mountains", 100, 1001);

// 3 — which half of the term ---------------------------------------------------------
console.log("\nWhich half — the -5 for being in reach, or the +3 for having one of theirs in mine\n");
const halves = [
  run("threatened=0 (penalty off)", "heuristic:threatened=0", "heuristic", "mountains", 100, 1001),
  run("threatening=0 (bonus off)", "heuristic:threatening=0", "heuristic", "mountains", 100, 1001),
];

// 4 — dose-response across every board ------------------------------------------------
console.log("\nDose-response — threat=0 on every board, against how much high ground it has\n");
const boards = Object.keys(BOARDS).sort((x, y) => highGround(y).total - highGround(x).total);
const dose = boards.map((board) => ({
  board,
  off: run(`threat=0, ${board}`, "heuristic:threat=0", "heuristic", board, 50, 2001),
  base: matchup(`baseline, ${board}`, "heuristic", "heuristic", board, pairs(50), 2001),
}));

// 5 — the weight, not the switch -------------------------------------------------------
console.log("\nSearch — a scale on `threatened` alone, on seeds 1 onwards. Selection, not evidence\n");
const SCALES = [0, 0.5, 2];
const search = SCALES.map((k) => ({
  k,
  r: run(`threatened=${k}`, `heuristic:threatened=${k}`, "heuristic", "mountains", 100, 1),
}));
const best = search.reduce((x, y) => (y.r.score > x.r.score ? y : x));
console.log(`\nSelected threatened=${best.k} — ${pct(best.r.score)} in the search. Confirming it on seeds it has never played.\n`);
const bestConfirm = run(`threatened=${best.k}, fresh seeds`, `heuristic:threatened=${best.k}`, "heuristic", "mountains", 100, 1001);

// ---------------------------------------------------------------- write up
const all = [confirm, ...halves, ...dose.flatMap((d) => [d.off, d.base]), ...search.map((s) => s.r), bestConfirm];
const sha = execSync("git rev-parse --short HEAD").toString().trim();
const dirty = execSync("git status --porcelain").toString().trim() ? " (with uncommitted changes)" : "";
const lines: string[] = [];
lines.push(`# H4 results`, ``);
lines.push(`Generated by \`experiments/h4-threat-terrain/run.ts\` at commit \`${sha}\`${dirty}, ${new Date().toISOString().slice(0, 10)}.`);
lines.push(`Standard team, corruption on, paired games (each seed played twice, sides swapped).${scale !== 1 ? ` **Scaled run: PAIRS_SCALE=${scale}.**` : ""}`, ``);
lines.push(`Intervals are ±1.96·sd/√n over pair scores (docs/arena.md, "Reading the error bars").`, ``);

lines.push(`## Instrument check`, ``);
lines.push(`\`threatened=1,threatening=1\` played **${identical} of ${plain.checksums.length}** games identically to plain`);
lines.push(`\`heuristic\`. ${identical === plain.checksums.length ? "The split moved nothing, so every number below compares with H3." : "**The split changed behaviour — nothing below compares with H3.**"}`, ``);

lines.push(`## Confirmation, and which half of the term`, ``);
lines.push(`All on Mountains against plain \`heuristic\`, seeds 1001 onwards — seeds neither agent has played.`, ``);
lines.push(`| Agent | Games | Score | 95% interval | Gain | W / L / D | Rounds | First attack |`);
lines.push(`|---|---|---|---|---|---|---|---|`);
for (const r of [confirm, ...halves])
  lines.push(`| \`${r.a}\` | ${r.pairs * 2} | ${pct(r.score)} | ${pct(r.low)} – ${pct(r.high)} | ${gain(r) >= 0 ? "+" : ""}${gain(r).toFixed(1)} | ${r.wins} / ${r.losses} / ${r.draws} | ${r.rounds.toFixed(1)} | ${r.firstAttack.toFixed(1)} |`);

lines.push(``, `## Dose-response — every board`, ``);
lines.push(`\`threat=0\` against plain \`heuristic\`, 50 pairs per board, seeds 2001 onwards. **High ground** counts`);
lines.push(`hill and mountain tiles and sums their Combat Power modifiers. **Baseline rounds** is \`heuristic\` against`);
lines.push(`itself on the same seeds, so the two round figures are comparable.`, ``);
lines.push(`| Board | High ground (tiles / total) | Score | 95% interval | Gain | Rounds without the term | Baseline rounds |`);
lines.push(`|---|---|---|---|---|---|---|`);
for (const d of dose) {
  const h = highGround(d.board);
  lines.push(`| ${d.board} | ${h.tiles} / +${h.total} | ${pct(d.off.score)} | ${pct(d.off.low)} – ${pct(d.off.high)} | ${gain(d.off) >= 0 ? "+" : ""}${gain(d.off).toFixed(1)} | ${d.off.rounds.toFixed(1)} | ${d.base.rounds.toFixed(1)} |`);
}

lines.push(``, `## A scale on \`threatened\``, ``);
lines.push(`The search picks the best of three noisy measurements and so flatters itself; only the confirmation counts.`, ``);
lines.push(`| Scale | Games | Seeds | Score | 95% interval | W / L / D | Rounds |`);
lines.push(`|---|---|---|---|---|---|---|`);
for (const { k, r } of search)
  lines.push(`| \`threatened=${k}\` | ${r.pairs * 2} | ${r.seed0}– | ${pct(r.score)} | ${pct(r.low)} – ${pct(r.high)} | ${r.wins} / ${r.losses} / ${r.draws} | ${r.rounds.toFixed(1)} |`);
lines.push(`| **confirmation: \`threatened=${best.k}\`** | ${bestConfirm.pairs * 2} | ${bestConfirm.seed0}– | **${pct(bestConfirm.score)}** | ${pct(bestConfirm.low)} – ${pct(bestConfirm.high)} | ${bestConfirm.wins} / ${bestConfirm.losses} / ${bestConfirm.draws} | ${bestConfirm.rounds.toFixed(1)} |`);

lines.push(``, `Replay problems across every game: **${all.reduce((n, r) => n + r.problems, 0)}**.`);
writeFileSync(resolve(import.meta.dirname, "results.md"), lines.join("\n") + "\n");
console.log(`\nwrote experiments/h4-threat-terrain/results.md`);
