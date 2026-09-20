/**
 * Set sweeps: how strong is each set against the field?
 *
 * "The field" is every legal set, uniformly. There are 147,106 of them, so 10.8
 * billion pairings — far beyond anything that could be played. But a set's
 * score against the field is an *average* over opponents, and an average can
 * be estimated by sampling: play each candidate against opponents drawn at
 * random from the field, and its score converges on the true one at
 * ±1/√pairs whatever the size of the field. docs/results.md has the design.
 *
 * Every pair is two games on one seed, with the candidate moving first in one
 * and second in the other, so first-move advantage cancels. Both sides are
 * piloted by the same agent: the only thing that differs is the sets.
 */
import { agentByName } from "@ms/ai";
import type { Owner } from "@ms/engine";
import { BOARDS } from "./boards";
import { allSetKeys, parseSetKey, unitDraw } from "./sets";
import type { ResultStore } from "./store";

export type SweepOptions = {
  agent: string;
  boards: string[];
  corruption: boolean;
  /** The sets being measured, as keys. */
  candidates: string[];
  /** Pairs of games per candidate, per board. */
  opponents: number;
  /** The sweep's seed: it fixes every opponent drawn and every game's seed. */
  seed: number;
  /** [k, n]: play only candidates k, k+n, k+2n, … (1-based), so n processes can split a sweep. */
  shard?: [number, number];
  /** Called now and then with progress. */
  progress?: (p: SweepProgress) => void;
  /** Checked between pairs; return true to stop cleanly. */
  stop?: () => boolean;
};

export type SweepProgress = { done: number; total: number; played: number; reused: number; seconds: number };

/**
 * The j-th opponent of a candidate, and the seed its pair of games is played on.
 * Both depend on (sweep seed, candidate, j) and nothing else — not on how many
 * opponents were asked for, nor on which other sets are candidates. So asking
 * for more opponents later replays nothing already played, and a candidate
 * meets the same opponents on every board, which makes its boards comparable.
 */
export function opponentOf(sweepSeed: number, candidate: string, j: number) {
  const all = allSetKeys();
  return {
    opponent: all[Math.floor(unitDraw("opponent", sweepSeed, candidate, j) * all.length)],
    seed: 1 + Math.floor(unitDraw("seed", sweepSeed, candidate, j) * 0x7ffffffe),
  };
}

/**
 * Breadth first: every candidate gets its first pair on every board before any
 * gets a second. A sweep stopped part way is then an even, smaller sweep rather
 * than a thorough one of the first few sets.
 *
 * Async only so that it can yield between pairs: games are synchronous, and a
 * Ctrl-C handler can't run until the event loop gets a turn.
 */
export async function runSweep(store: ResultStore, o: SweepOptions): Promise<SweepProgress> {
  const agent = agentByName(o.agent);
  const [k, n] = o.shard ?? [1, 1];
  const mine = o.candidates.filter((_, i) => i % n === k - 1);
  const total = mine.length * o.boards.length * o.opponents * 2;
  const t0 = performance.now();
  const at = { played: store.played, reused: store.reused };
  let done = 0;
  const snapshot = (): SweepProgress => ({
    done, total,
    played: store.played - at.played,
    reused: store.reused - at.reused,
    seconds: (performance.now() - t0) / 1000,
  });
  let lastReport = performance.now();

  for (let j = 0; j < o.opponents; j++)
    for (const boardName of o.boards)
      for (const candidate of mine) {
        if (o.stop?.()) return snapshot();
        const { opponent, seed } = opponentOf(o.seed, candidate, j);
        const C = parseSetKey(candidate);
        const O = parseSetKey(opponent);
        for (const subject of [1, 2] as Owner[]) {
          const teams = subject === 1 ? { 1: C, 2: O } : { 1: O, 2: C };
          store.play(agent, agent, { board: BOARDS[boardName], teams, corruption: o.corruption }, seed, {
            sweep: o.seed,
            subject,
          });
          done++;
        }
        if (o.progress && performance.now() - lastReport > 15000) {
          lastReport = performance.now();
          o.progress(snapshot());
        }
        await new Promise((r) => setImmediate(r));
      }
  return snapshot();
}
