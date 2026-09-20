/**
 * Reading results back out of the store. Everything here is a query over games
 * already played — nothing is replayed — so a report over millions of games
 * takes seconds, and can be re-cut by board, agent or sweep at will.
 */
import type { DatabaseSync } from "node:sqlite";
import { MACHINE_BY_ID } from "@ms/engine";
import type { MatchResult } from "./match";

export type Scope = {
  /** A code version, or "all" to pool across versions deliberately. */
  code: string;
  agent: string;
  /** Board ids in the store. */
  boards: number[];
  corruption: boolean;
  /** Only games from the sweep with this seed. */
  sweep?: number;
};

/**
 * Wilson score interval. It treats each *pair* as one trial, scored 0 to 1:
 * the two games of a pair share an opponent and a seed, so they are not
 * independent, but a pair's score is still bounded by [0, 1] and so has
 * variance at most p(1 − p) — which makes this interval conservative however
 * strongly the two games are correlated. Unlike the textbook ±1.96·SE it stays
 * honest at 0% and 100% and never collapses to ±0 on a handful of pairs.
 */
export function wilson(p: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

function where(s: Scope, extra = "") {
  const clauses = [
    "agent1 = ?", "agent2 = ?", "corruption = ?",
    `board IN (${s.boards.map(() => "?").join(", ") || "NULL"})`,
  ];
  const params: (string | number)[] = [s.agent, s.agent, s.corruption ? 1 : 0, ...s.boards];
  if (s.code !== "all") {
    clauses.push("code = ?");
    params.push(s.code);
  }
  if (s.sweep !== undefined) {
    clauses.push("sweep = ?");
    params.push(s.sweep);
  }
  if (extra) clauses.push(extra);
  return { sql: clauses.join(" AND "), params };
}

export type SetRow = {
  key: string;
  machines: number;
  pairs: number;
  games: number;
  score: number;
  low: number;
  high: number;
};

/**
 * Each set's score against the field, from the games where it was the set
 * being measured. Games where it was only someone else's randomly drawn
 * opponent are left out: those opponents were not drawn from the field, but
 * from whatever list of candidates that sweep was measuring.
 *
 * Sorted by the interval's lower bound — the score the set can be trusted to
 * reach — so a set that won its only two pairs does not outrank one that won
 * 70% of two hundred.
 */
export function setLeaderboard(db: DatabaseSync, s: Scope, minPairs = 1): SetRow[] {
  const w = where(s, "subject IS NOT NULL");
  const rows = db
    .prepare(
      `WITH g AS (
         SELECT code, board, seed,
                CASE subject WHEN 1 THEN set1 ELSE set2 END AS s,
                CASE subject WHEN 1 THEN set2 ELSE set1 END AS o,
                CASE WHEN winner = subject THEN 1.0 WHEN winner = 0 THEN 0.5 ELSE 0.0 END AS score
         FROM games WHERE ${w.sql}
       ),
       pairs AS (SELECT s, AVG(score) AS ps, COUNT(*) AS n FROM g GROUP BY code, board, seed, s, o)
       SELECT sets.key, sets.machines, COUNT(*) AS pairs, SUM(n) AS games, AVG(ps) AS score
       FROM pairs JOIN sets ON sets.id = pairs.s
       GROUP BY pairs.s HAVING COUNT(*) >= ?`,
    )
    .all(...w.params, minPairs) as Omit<SetRow, "low" | "high">[];
  return rows
    .map((r) => {
      const [low, high] = wilson(r.score, r.pairs);
      return { ...r, low, high };
    })
    .sort((a, b) => b.low - a.low || b.score - a.score);
}

export type MachineRow = {
  machine: string;
  points: number;
  type: string;
  sets: number;
  pairs: number;
  /** Pair-weighted score of the sets that field this machine. */
  withIt: number;
  /** The same, over the sets that don't. */
  without: number;
};

/**
 * How sets fielding each machine fare against the field, beside sets that
 * don't. Descriptive, not causal: a machine's partners come with it — a 7-point
 * machine leaves room for only 3 points of anything else — so a gap here can
 * belong to what a machine crowds out as much as to the machine.
 */
export function machineTable(rows: SetRow[], db: DatabaseSync): MachineRow[] {
  const bySet = new Map(rows.map((r) => [r.key, r]));
  const acc = new Map<string, { sets: number; pairs: number; sum: number }>();
  let totalPairs = 0, totalSum = 0;
  for (const r of rows) {
    totalPairs += r.pairs;
    totalSum += r.score * r.pairs;
  }
  const members = db
    .prepare("SELECT s.key, m.machine FROM set_machines m JOIN sets s ON s.id = m.set_id")
    .all() as { key: string; machine: string }[];
  for (const { key, machine } of members) {
    const r = bySet.get(key);
    if (!r) continue;
    const a = acc.get(machine) ?? { sets: 0, pairs: 0, sum: 0 };
    a.sets++;
    a.pairs += r.pairs;
    a.sum += r.score * r.pairs;
    acc.set(machine, a);
  }
  return [...acc]
    .map(([machine, a]) => ({
      machine,
      points: MACHINE_BY_ID[machine]?.points ?? 0,
      type: MACHINE_BY_ID[machine]?.type ?? "?",
      sets: a.sets,
      pairs: a.pairs,
      withIt: a.sum / a.pairs,
      without: totalPairs > a.pairs ? (totalSum - a.sum) / (totalPairs - a.pairs) : NaN,
    }))
    .sort((x, y) => y.withIt - x.withIt);
}

/**
 * Agent-vs-agent results for one draft-book set, folded into the pairwise form
 * fitElo takes — so the Elo ladder can be refitted from stored games, across
 * as many tournaments as were run, without replaying any of them.
 */
export function agentMatches(db: DatabaseSync, s: Omit<Scope, "agent">, setId: number): MatchResult[] {
  const clauses = ["subject IS NULL", "set1 = ?", "set2 = ?", "corruption = ?", "agent1 <> agent2",
    `board IN (${s.boards.map(() => "?").join(", ") || "NULL"})`];
  const params: (string | number)[] = [setId, setId, s.corruption ? 1 : 0, ...s.boards];
  if (s.code !== "all") {
    clauses.push("code = ?");
    params.push(s.code);
  }
  const rows = db
    .prepare(
      `SELECT agent1, agent2, winner, COUNT(*) AS n, SUM(rounds) AS rounds, SUM(branching) AS branching,
              SUM(hit_cap) AS capped
       FROM games WHERE ${clauses.join(" AND ")} GROUP BY agent1, agent2, winner`,
    )
    .all(...params) as { agent1: string; agent2: string; winner: number; n: number; rounds: number; branching: number; capped: number }[];

  const out = new Map<string, MatchResult & { roundSum: number; branchSum: number }>();
  for (const r of rows) {
    const [a, b] = [r.agent1, r.agent2].sort();
    const m = out.get(`${a}|${b}`) ?? {
      a, b, wins: 0, losses: 0, draws: 0, games: 0, avgRounds: 0, avgBranching: 0, capped: 0, roundSum: 0, branchSum: 0,
    };
    const aSide = r.agent1 === a ? 1 : 2;
    if (r.winner === 0) m.draws += r.n;
    else if (r.winner === aSide) m.wins += r.n;
    else m.losses += r.n;
    m.games += r.n;
    m.roundSum += r.rounds;
    m.branchSum += r.branching;
    m.capped += r.capped;
    out.set(`${a}|${b}`, m);
  }
  return [...out.values()].map(({ roundSum, branchSum, ...m }) => ({
    ...m,
    avgRounds: roundSum / m.games,
    avgBranching: branchSum / m.games,
  }));
}

/** What the store holds under each code version, newest first — for when a query comes back empty. */
export function codeVersions(db: DatabaseSync) {
  return db
    .prepare(
      `SELECT g.code, COUNT(*) AS games, MIN(r.started) AS first, MAX(r.started) AS last,
              GROUP_CONCAT(DISTINCT r.git) AS commits
       FROM games g JOIN runs r ON r.id = g.run GROUP BY g.code ORDER BY last DESC`,
    )
    .all() as { code: string; games: number; first: string; last: string; commits: string | null }[];
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const cell = (v: unknown) => {
    const s = typeof v === "number" && !Number.isInteger(v) ? v.toFixed(4) : String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n") + "\n";
}
