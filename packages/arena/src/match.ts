import { applyActivation, endTurn, legalActivations, type Owner } from "@ms/engine";
import { makeRng, type Agent } from "@ms/ai";
import { startPosition, type MatchSetup } from "./setup";

export type GameResult = {
  winner: Owner | "draw";
  rounds: number;
  vp: Record<Owner, number>;
  activations: number;
  /** Average legal activations per decision — the game's real branching factor. */
  branching: number;
  hitCap: boolean;
};

const ACTIVATION_CAP = 600;

export function playGame(
  p1: Agent,
  p2: Agent,
  setup: MatchSetup,
  seed: number,
): GameResult {
  let s = startPosition(setup);
  const rng = makeRng(seed);
  let activations = 0;
  let branchingTotal = 0;
  let decisions = 0;

  while (!s.winner && activations < ACTIVATION_CAP) {
    const agent = s.turn === 1 ? p1 : p2;
    const options = legalActivations(s);
    if (options.length === 0) {
      s = endTurn(s);
      continue;
    }
    branchingTotal += options.length;
    decisions++;
    const act = agent.choose(s, rng);
    if (!act) {
      s = endTurn(s);
      continue;
    }
    s = applyActivation(s, act);
    activations++;
  }

  return {
    winner: s.winner ?? "draw",
    rounds: s.round,
    vp: { ...s.vp },
    activations,
    branching: decisions ? branchingTotal / decisions : 0,
    hitCap: !s.winner,
  };
}

export type MatchResult = {
  a: string;
  b: string;
  /** From A's point of view. */
  wins: number;
  losses: number;
  draws: number;
  games: number;
  avgRounds: number;
  avgBranching: number;
  capped: number;
};

/**
 * Play a match as **paired games**: every seed is played twice, once with each
 * agent moving first. First-player advantage then cancels out instead of
 * showing up as strength, and variance drops sharply for the same number of
 * games (plan.md, Stage 2 arena).
 */
export function playMatch(
  a: Agent,
  b: Agent,
  setup: MatchSetup,
  pairs: number,
  seed0 = 1,
): MatchResult {
  let wins = 0, losses = 0, draws = 0, rounds = 0, branching = 0, capped = 0;

  for (let i = 0; i < pairs; i++) {
    const seed = seed0 + i;
    for (const aIsFirst of [true, false]) {
      const r = aIsFirst ? playGame(a, b, setup, seed) : playGame(b, a, setup, seed);
      const aWon = aIsFirst ? r.winner === 1 : r.winner === 2;
      const bWon = aIsFirst ? r.winner === 2 : r.winner === 1;
      if (r.winner === "draw") draws++;
      else if (aWon) wins++;
      else if (bWon) losses++;
      rounds += r.rounds;
      branching += r.branching;
      if (r.hitCap) capped++;
    }
  }

  const games = pairs * 2;
  return {
    a: a.name, b: b.name, wins, losses, draws, games,
    avgRounds: rounds / games, avgBranching: branching / games, capped,
  };
}
