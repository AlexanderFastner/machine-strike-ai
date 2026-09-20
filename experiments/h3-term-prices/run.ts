/**
 * H3 — what each term of the evaluation is worth. Switches each term off, then
 * doubles it, against plain `heuristic`, as docs/heuristics.md §H3 registers.
 *
 *   node --import tsx experiments/h3-term-prices/run.ts
 *   PAIRS_SCALE=0.05 node --import tsx experiments/h3-term-prices/run.ts   # smoke test
 *
 * Nothing is selected here and nothing is confirmed: fourteen measurements,
 * fourteen numbers. `vp=0` is the instrument check — an agent that cannot see
 * the win condition should lose badly, and if it doesn't, nothing else in the
 * run is evidence.
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

const TERMS = ["vp", "health", "terrain", "threat", "facing", "blight", "advance"] as const;
const pairs = (n: number) => Math.max(2, Math.round(n * scale));

const run = (label: string, a: string, b: string, board: string, n: number, seed0 = 1) => {
  const r = matchup(label, a, b, board, pairs(n), seed0);
  const cost = (0.5 - r.score) * 100;
  console.log(
    `${label}: ${pct(r.score)} [${pct(r.low)}, ${pct(r.high)}] vs heuristic over ${r.pairs * 2} games — ` +
      `${cost >= 0 ? "costs" : "gains"} ${Math.abs(cost).toFixed(1)} points (${r.seconds.toFixed(0)}s, ${r.problems} replay problems)`,
  );
  return r;
};

console.log("Each term switched off, then doubled, against plain heuristic\n");
const priced = TERMS.flatMap((term) =>
  [0, 2].map((k) => ({ term, k, r: run(`${term}=${k}`, `heuristic:${term}=${k}`, "heuristic", "plains-and-forests", 100) })),
);

console.log("\nTerrain check — terrain and threat, switched off, on two other boards\n");
const terrain = ["mountains", "coastal"].flatMap((board) =>
  ["terrain", "threat"].map((term) => ({ term, board, r: run(`${term}=0, ${board}`, `heuristic:${term}=0`, "heuristic", board, 50) })),
);
const results = [...priced.map((x) => x.r), ...terrain.map((x) => x.r)];

// ---------------------------------------------------------------- write up
const sha = execSync("git rev-parse --short HEAD").toString().trim();
const dirty = execSync("git status --porcelain").toString().trim() ? " (with uncommitted changes)" : "";
const lines: string[] = [];
lines.push(`# H3 results`, ``);
lines.push(`Generated by \`experiments/h3-term-prices/run.ts\` at commit \`${sha}\`${dirty}, ${new Date().toISOString().slice(0, 10)}.`);
lines.push(`Standard team, corruption on, paired games (each seed played twice, sides swapped).${scale !== 1 ? ` **Scaled run: PAIRS_SCALE=${scale}.**` : ""}`, ``);
lines.push(`Intervals are ±1.96·sd/√n over pair scores (docs/arena.md, "Reading the error bars").`, ``);

lines.push(`## What each term is worth`, ``);
lines.push(`Against plain \`heuristic\` on plains-and-forests, seeds 1 onwards. **Cost** is 50% minus the score:`);
lines.push(`what the evaluation gives up without that term, or with twice as much of it.`, ``);
lines.push(`| Term | Scale | Score vs heuristic | 95% interval | Cost | W / L / D | Weak-side hits | Rounds |`);
lines.push(`|---|---|---|---|---|---|---|---|`);
for (const { term, k, r } of priced) {
  const st = r.sides[r.a];
  const hits = st.hits.weak + st.hits.armour + st.hits.neutral;
  const cost = (0.5 - r.score) * 100;
  lines.push(
    `| \`${term}\` | ${k} | ${pct(r.score)} | ${pct(r.low)} – ${pct(r.high)} | ${cost >= 0 ? "" : "+"}${(-cost).toFixed(1)} | ` +
      `${r.wins} / ${r.losses} / ${r.draws} | ${pct(st.hits.weak / hits)} | ${r.rounds.toFixed(1)} |`,
  );
}

lines.push(``, `## Terrain check`, ``);
lines.push(`| Term | Board | Games | Score vs heuristic | 95% interval | Cost |`);
lines.push(`|---|---|---|---|---|---|`);
for (const { term, board, r } of terrain)
  lines.push(`| \`${term}=0\` | ${board} | ${r.pairs * 2} | ${pct(r.score)} | ${pct(r.low)} – ${pct(r.high)} | ${((0.5 - r.score) * 100).toFixed(1)} |`);

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
console.log(`\nwrote experiments/h3-term-prices/results.md`);
