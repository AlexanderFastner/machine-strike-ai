import {
  applyActivation, checksum, endTurn, legalActivations,
  type Activation, type Deployment, type GameState, type Owner,
} from "@ms/engine";
import { makeRng, type Agent } from "@ms/ai";
import { chooseDeployment, startPosition, type MatchSetup } from "./setup";

export type GameResult = {
  winner: Owner | "draw";
  rounds: number;
  vp: Record<Owner, number>;
  activations: number;
  /** Average legal activations per decision — the game's real branching factor. */
  branching: number;
  hitCap: boolean;
  /**
   * Fingerprint of the final position. Replaying the same game must land on it
   * again, which is how a stored result is later proven to still reproduce.
   */
  checksum: string;
};

export const ACTIVATION_CAP = 600;

/** Optional observers, so recording a game cannot change how it is played. */
export type GameHooks = {
  start?(state: GameState): void;
  /** activation is null when the player passes the turn instead of acting. */
  step?(before: GameState, after: GameState, activation: Activation | null, optionCount: number): void;
};

/**
 * The one game loop. Tournaments, benches and replays all run through it, so a
 * recorded game is the same code path as every game the arena counts — not a
 * parallel reimplementation that could quietly disagree.
 *
 * The game starts where the agents deploy (setup.ts, chooseDeployment). A
 * caller that already knows the deployment — the results store, which needs it
 * to recognise a game before playing it — passes it in rather than asking twice.
 */
export function runGame(
  p1: Agent,
  p2: Agent,
  setup: MatchSetup,
  seed: number,
  hooks: GameHooks = {},
  deployment: Deployment[] = chooseDeployment(p1, p2, setup, seed),
): GameResult {
  let s = startPosition(setup, deployment);
  hooks.start?.(s);
  const rng = makeRng(seed);
  let activations = 0;
  let branchingTotal = 0;
  let decisions = 0;

  while (!s.winner && activations < ACTIVATION_CAP) {
    const agent = s.turn === 1 ? p1 : p2;
    const options = legalActivations(s);
    const before = s;
    if (options.length === 0) {
      s = endTurn(s);
      hooks.step?.(before, s, null, 0);
      continue;
    }
    branchingTotal += options.length;
    decisions++;
    const act = agent.choose(s, rng);
    if (!act) {
      s = endTurn(s);
      hooks.step?.(before, s, null, options.length);
      continue;
    }
    s = applyActivation(s, act);
    activations++;
    hooks.step?.(before, s, act, options.length);
  }

  return {
    winner: s.winner ?? "draw",
    rounds: s.round,
    vp: { ...s.vp },
    activations,
    branching: decisions ? branchingTotal / decisions : 0,
    hitCap: !s.winner,
    checksum: checksum(s),
  };
}

export type PlayFn = (p1: Agent, p2: Agent, setup: MatchSetup, seed: number) => GameResult;

export const playGame: PlayFn = (p1, p2, setup, seed) => runGame(p1, p2, setup, seed);

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
 *
 * `play` is how a single game gets its result — played here by default, or
 * looked up in the results store when that game has been played before.
 */
export function playMatch(
  a: Agent,
  b: Agent,
  setup: MatchSetup,
  pairs: number,
  seed0 = 1,
  play: PlayFn = playGame,
): MatchResult {
  let wins = 0, losses = 0, draws = 0, rounds = 0, branching = 0, capped = 0;

  for (let i = 0; i < pairs; i++) {
    const seed = seed0 + i;
    for (const aIsFirst of [true, false]) {
      const r = aIsFirst ? play(a, b, setup, seed) : play(b, a, setup, seed);
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
