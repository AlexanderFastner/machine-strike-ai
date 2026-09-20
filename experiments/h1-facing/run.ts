/**
 * H1 — facing-aware evaluation. Runs every matchup specified in
 * docs/heuristics.md §H1 and writes results.md beside this file.
 *
 *   npx tsx experiments/h1-facing/run.ts
 *   PAIRS_SCALE=0.05 npx tsx experiments/h1-facing/run.ts     # quick smoke test
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
  wins: number; losses: number; draws: number;
  score: number; low: number; high: number;
  rounds: number; firstAttack: number; problems: number;
  sides: Record<string, SideStats>;
  seconds: number;
};

/** Wrap an agent to measure how long it thinks, without changing what it does. */
function timed(agent: Agent, into: SideStats): Agent {
  return {
    name: agent.name,
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

function matchup(label: string, a: string, b: string, board: string, pairs: number): Outcome {
  const setup: MatchSetup = { board: BOARDS[board], teams: mirror(TEAMS.standard), corruption: true };
  const sides: Record<string, SideStats> = { [a]: blank(), [b]: blank() };
  const A = timed(agentByName(a), sides[a]);
  const B = timed(agentByName(b), sides[b]);

  let wins = 0, losses = 0, draws = 0, rounds = 0, firstAttack = 0, problems = 0;
  const pairScores: number[] = [];
  const t0 = performance.now();

  for (let seed = 1; seed <= pairs; seed++) {
    let pairScore = 0;
    for (const aFirst of [true, false]) {
      const replay = aFirst ? recordGame(A, B, setup, seed) : recordGame(B, A, setup, seed);
      const m = gameMetrics(replay, rebuild(replay));
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
    label, a, b, board, pairs,
    wins, losses, draws,
    score: mean, low: Math.max(0, mean - half), high: Math.min(1, mean + half),
    rounds: rounds / (n * 2), firstAttack: firstAttack / (n * 2), problems,
    sides, seconds: (performance.now() - t0) / 1000,
  };
}

const MATCHUPS: [string, string, string, string, number][] = [
  ["Head-to-head (primary)", "heuristic-facing", "heuristic", "plains-and-forests", 100],
  ["Against greedy — new", "heuristic-facing", "greedy", "plains-and-forests", 100],
  ["Against greedy — control", "heuristic", "greedy", "plains-and-forests", 100],
  ["Head-to-head, Mountains", "heuristic-facing", "heuristic", "mountains", 50],
  ["Head-to-head, Coastal", "heuristic-facing", "heuristic", "coastal", 50],
];

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const elo = (p: number) => {
  const q = Math.min(Math.max(p, 0.001), 0.999);
  return Math.round(400 * Math.log10(q / (1 - q)));
};

const results: Outcome[] = [];
for (const [label, a, b, board, pairs] of MATCHUPS) {
  const n = Math.max(2, Math.round(pairs * scale));
  const r = matchup(label, a, b, board, n);
  results.push(r);
  console.log(
    `${label}: ${a} ${pct(r.score)} [${pct(r.low)}, ${pct(r.high)}] vs ${b} over ${n * 2} games ` +
      `(${r.seconds.toFixed(0)}s, ${r.problems} replay problems)`,
  );
}

// ---------------------------------------------------------------- write up
const sha = execSync("git rev-parse --short HEAD").toString().trim();
const dirty = execSync("git status --porcelain").toString().trim() ? " (with uncommitted changes)" : "";
const lines: string[] = [];
lines.push(`# H1 results`, ``);
lines.push(`Generated by \`experiments/h1-facing/run.ts\` at commit \`${sha}\`${dirty}, ${new Date().toISOString().slice(0, 10)}.`);
lines.push(`Standard team, corruption on, paired games (each seed played twice, sides swapped).${scale !== 1 ? ` **Scaled run: PAIRS_SCALE=${scale}.**` : ""}`, ``);

lines.push(`## Scores`, ``);
lines.push(`| Matchup | Board | Games | A's score | 95% interval | ≈ Elo gap | W / L / D | Rounds | First attack |`);
lines.push(`|---|---|---|---|---|---|---|---|---|`);
for (const r of results)
  lines.push(`| ${r.label}: **${r.a}** vs ${r.b} | ${r.board} | ${r.pairs * 2} | ${pct(r.score)} | ${pct(r.low)} – ${pct(r.high)} | ${elo(r.score) >= 0 ? "+" : ""}${elo(r.score)} | ${r.wins} / ${r.losses} / ${r.draws} | ${r.rounds.toFixed(1)} | ${r.firstAttack.toFixed(1)} |`);

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
console.log(`\nwrote experiments/h1-facing/results.md`);
