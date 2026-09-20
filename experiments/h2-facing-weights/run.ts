/**
 * H2 — weights for a term that now fires constantly. Runs the two stages in
 * docs/heuristics.md §H2 and writes results.md beside this file.
 *
 *   node --import tsx experiments/h2-facing-weights/run.ts
 *   PAIRS_SCALE=0.05 node --import tsx experiments/h2-facing-weights/run.ts   # smoke test
 *
 * The stages are separate on purpose. The **search** plays a grid of scales
 * against `heuristic` and picks the best; being the best of six noisy
 * measurements, that number flatters itself, so it selects and nothing more.
 * The **confirmation** then replays the winner on seeds it has never seen,
 * beside the unscaled agent and against it. Only the confirmation is evidence.
 *
 * Every game goes through recordGame → the arena's own game loop, and is then
 * re-executed and checked, so a result can't rest on a game that didn't replay.
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { agentByName, type Agent } from "@ms/ai";
import { TEAMS, gameMetrics, mirror, rebuild, recordGame, type MatchSetup } from "@ms/arena";
import { BOARDS } from "@ms/arena/node";
import type { Owner } from "@ms/engine";

const scale = Number(process.env.PAIRS_SCALE ?? 1);

type SideStats = {
  games: number;
  facing: { forward: number; sideways: number; backward: number };
  hits: { weak: number; armour: number; neutral: number };
  attacks: number;
  declined: number;
  decisions: number;
  thinkMs: number;
};

type Outcome = {
  label: string;
  a: string;
  b: string;
  board: string;
  pairs: number;
  seed0: number;
  /** Every game's final position, so two scales can be asked whether they played differently. */
  checksums: string[];
  wins: number; losses: number; draws: number;
  score: number; low: number; high: number;
  rounds: number; firstAttack: number; problems: number;
  sides: Record<string, SideStats>;
  seconds: number;
};

/** Wrap an agent to measure how long it thinks, without changing what it does. */
function timed(agent: Agent, into: SideStats): Agent {
  return {
    ...agent,
    choose(state, rng) {
      const t0 = performance.now();
      const act = agent.choose(state, rng);
      into.thinkMs += performance.now() - t0;
      into.decisions++;
      return act;
    },
  };
}

const blank = (): SideStats => ({
  games: 0,
  facing: { forward: 0, sideways: 0, backward: 0 },
  hits: { weak: 0, armour: 0, neutral: 0 },
  attacks: 0, declined: 0, decisions: 0, thinkMs: 0,
});

function matchup(label: string, a: string, b: string, board: string, pairs: number, seed0 = 1): Outcome {
  const setup: MatchSetup = { board: BOARDS[board], teams: mirror(TEAMS.standard), corruption: true };
  const sides: Record<string, SideStats> = { [a]: blank(), [b]: blank() };
  const A = timed(agentByName(a), sides[a]);
  const B = timed(agentByName(b), sides[b]);

  let wins = 0, losses = 0, draws = 0, rounds = 0, firstAttack = 0, problems = 0;
  const pairScores: number[] = [];
  const checksums: string[] = [];
  const t0 = performance.now();

  for (let seed = seed0; seed < seed0 + pairs; seed++) {
    let pairScore = 0;
    for (const aFirst of [true, false]) {
      const replay = aFirst ? recordGame(A, B, setup, seed) : recordGame(B, A, setup, seed);
      const m = gameMetrics(replay, rebuild(replay));
      checksums.push(replay.result.checksum);
      problems += m.problems.length;
      rounds += m.rounds;
      firstAttack += m.firstAttackRound ?? m.rounds;

      for (const owner of [1, 2] as Owner[]) {
        const st = sides[replay.agents[owner]];
        st.games++;
        st.attacks += m.attacks[owner];
        st.declined += m.declinedAttacks[owner];
        for (const k of ["forward", "sideways", "backward"] as const) st.facing[k] += m.facing[owner][k];
        for (const k of ["weak", "armour", "neutral"] as const) st.hits[k] += m.hitsTaken[owner][k];
      }

      const aOwner: Owner = aFirst ? 1 : 2;
      const w = replay.result.winner;
      const s = w === "draw" ? 0.5 : w === aOwner ? 1 : 0;
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
    label, a, b, board, pairs, seed0, checksums,
    wins, losses, draws,
    score: mean, low: Math.max(0, mean - half), high: Math.min(1, mean + half),
    rounds: rounds / (n * 2), firstAttack: firstAttack / (n * 2), problems,
    sides, seconds: (performance.now() - t0) / 1000,
  };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const elo = (p: number) => {
  const q = Math.min(Math.max(p, 0.001), 0.999);
  return Math.round(400 * Math.log10(q / (1 - q)));
};

/** The grid of scales. 1 is the unscaled agent; 0 removes facing scoring altogether. */
const GRID = [0, 0.25, 0.5, 1, 2, 4];
const agentFor = (k: number) => (k === 1 ? "heuristic-facing-own" : `heuristic-facing-own:w=${k}`);
const pairs = (n: number) => Math.max(2, Math.round(n * scale));

const run = (label: string, a: string, b: string, board: string, n: number, seed0 = 1) => {
  const r = matchup(label, a, b, board, pairs(n), seed0);
  console.log(
    `${label}: ${a} ${pct(r.score)} [${pct(r.low)}, ${pct(r.high)}] vs ${b} over ${r.pairs * 2} games ` +
      `(seeds ${r.seed0}–${r.seed0 + r.pairs - 1}, ${r.seconds.toFixed(0)}s, ${r.problems} replay problems)`,
  );
  return r;
};

// --- stage 1: the search. These numbers choose a candidate; they are not evidence for it.
console.log("Search — a grid of scales against heuristic, seeds 1 onwards\n");
const search = GRID.map((k) => run(`w=${k}`, agentFor(k), "heuristic", "plains-and-forests", 100));
const unscaled = search[GRID.indexOf(1)];
/** How often a scale changed the game at all, against the same opponent on the same seeds. */
const changed = (r: Outcome) => r.checksums.filter((c, i) => c !== unscaled.checksums[i]).length;

const best = search.reduce((x, y) => (y.score > x.score ? y : x));
const bestK = GRID[search.indexOf(best)];
console.log(`\nSelected w=${bestK} — ${pct(best.score)} in the search. Confirming it on seeds it has never played.\n`);

// --- stage 2: confirmation, on fresh seeds, plus the terrain check.
const FRESH = 1001;
// If the grid picks the unscaled agent, the confirmation is one matchup, not three:
// there is nothing to confirm it against but itself.
const confirm =
  bestK === 1
    ? [run("Confirmation: w=1 vs heuristic", agentFor(1), "heuristic", "plains-and-forests", 100, FRESH)]
    : [
        run(`Confirmation: w=${bestK} vs heuristic`, agentFor(bestK), "heuristic", "plains-and-forests", 100, FRESH),
        run("Confirmation: w=1 vs heuristic", agentFor(1), "heuristic", "plains-and-forests", 100, FRESH),
        run(`Confirmation: w=${bestK} vs w=1`, agentFor(bestK), agentFor(1), "plains-and-forests", 100, FRESH),
      ];
const terrain = ["mountains", "coastal"].map((board) =>
  run(`Terrain: w=${bestK} vs heuristic, ${board}`, agentFor(bestK), "heuristic", board, 50, FRESH),
);
const results = [...search, ...confirm, ...terrain];

// ---------------------------------------------------------------- write up
const sha = execSync("git rev-parse --short HEAD").toString().trim();
const dirty = execSync("git status --porcelain").toString().trim() ? " (with uncommitted changes)" : "";
const lines: string[] = [];
lines.push(`# H2 results`, ``);
lines.push(`Generated by \`experiments/h2-facing-weights/run.ts\` at commit \`${sha}\`${dirty}, ${new Date().toISOString().slice(0, 10)}.`);
lines.push(`Standard team, corruption on, paired games (each seed played twice, sides swapped).${scale !== 1 ? ` **Scaled run: PAIRS_SCALE=${scale}.**` : ""}`, ``);
lines.push(`Selected **w=${bestK}** in the search, confirmed on seeds ${FRESH} onwards.`, ``);

lines.push(`## Search — selection, not evidence`, ``);
lines.push(`Each scale against \`heuristic\`, seeds 1 onwards. The best of six noisy measurements flatters itself;`);
lines.push(`that is what the confirmation below is for.`, ``);
lines.push(`| Scale | Games | Score vs heuristic | 95% interval | W / L / D | Games it played differently from w=1 | Weak-side hits | Rounds |`);
lines.push(`|---|---|---|---|---|---|---|---|`);
for (const [i, r] of search.entries()) {
  const k = GRID[i];
  const s = r.sides[r.a];
  const hits = s.hits.weak + s.hits.armour + s.hits.neutral;
  lines.push(
    `| ${k === bestK ? `**w=${k}**` : `w=${k}`} | ${r.pairs * 2} | ${pct(r.score)} | ${pct(r.low)} – ${pct(r.high)} | ` +
      `${r.wins} / ${r.losses} / ${r.draws} | ${k === 1 ? "—" : `${changed(r)} of ${r.checksums.length}`} | ` +
      `${pct(s.hits.weak / hits)} | ${r.rounds.toFixed(1)} |`,
  );
}

lines.push(``, `## Confirmation and terrain — fresh seeds`, ``);
lines.push(`| Matchup | Board | Games | A's score | 95% interval | ≈ Elo gap | W / L / D | Rounds | First attack |`);
lines.push(`|---|---|---|---|---|---|---|---|---|`);
for (const r of [...confirm, ...terrain])
  lines.push(`| ${r.label} | ${r.board} | ${r.pairs * 2} | ${pct(r.score)} | ${pct(r.low)} – ${pct(r.high)} | ${elo(r.score) >= 0 ? "+" : ""}${elo(r.score)} | ${r.wins} / ${r.losses} / ${r.draws} | ${r.rounds.toFixed(1)} | ${r.firstAttack.toFixed(1)} |`);

lines.push(``, `## Per agent, per matchup`, ``);
lines.push(`| Matchup | Agent | Weak-side hits taken | Hits taken | Facing fwd / side / back | Attacks declined per game | Decisions/sec |`);
lines.push(`|---|---|---|---|---|---|---|`);
for (const r of results)
  for (const name of [r.a, r.b]) {
    const s = r.sides[name];
    const hits = s.hits.weak + s.hits.armour + s.hits.neutral;
    const moves = s.facing.forward + s.facing.sideways + s.facing.backward;
    const f = (k: keyof SideStats["facing"]) => `${Math.round((s.facing[k] / moves) * 100)}%`;
    lines.push(`| ${r.label} | ${name} | **${pct(s.hits.weak / hits)}** (${s.hits.weak}) | ${hits} | ${f("forward")} / ${f("sideways")} / ${f("backward")} | ${(s.declined / s.games).toFixed(1)} | ${(s.decisions / (s.thinkMs / 1000)).toFixed(0)} |`);
  }

lines.push(``, `Replay problems across every game: **${results.reduce((n, r) => n + r.problems, 0)}**.`);
writeFileSync(resolve(import.meta.dirname, "results.md"), lines.join("\n") + "\n");
console.log(`\nwrote experiments/h2-facing-weights/results.md`);
