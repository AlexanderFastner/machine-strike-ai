import type { Activation, Facing, GameState, Owner, TerrainId } from "@ms/engine";

/**
 * Every agent is a pure function of (state, randomness). Randomness is injected
 * rather than taken from Math.random so that a match is reproducible from its
 * seed — without that, a result you cannot rerun is a result you cannot debug.
 */
export type Agent = {
  name: string;
  /** null means "no legal activation" — the caller ends the turn. */
  choose(state: GameState, rng: Rng): Activation | null;
  /**
   * Where this side's machines start: one placement per machine, anywhere in
   * its own back two rows, facing any way (rules §8.2). Optional — an agent
   * without it starts where the arena's default rule puts it, so every agent
   * written before deployment was a choice plays exactly the games it did.
   */
  deploy?(view: DeployView, rng: Rng): Placement[];
};

/** Where one machine starts: a square, in the board's own coordinates, and a facing. */
export type Placement = { machineId: string; row: number; col: number; facing: Facing };

/**
 * What a player knows when it deploys: the board, its side, the blight setting,
 * and both sets — the draft is hidden only until deployment (rules §8.1). Not
 * where the opponent is putting its machines: both sides deploy at once.
 */
export type DeployView = {
  owner: Owner;
  grid: TerrainId[][];
  corruption: boolean;
  /** This side's machines, one entry per machine. */
  mine: string[];
  theirs: string[];
};

export type Rng = () => number;

/** mulberry32: small, fast, reproducible across runs and machines. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(xs: T[], rng: Rng): T => xs[Math.floor(rng() * xs.length)];

/**
 * Pick the highest scoring option, breaking ties at random rather than by array
 * order. Order-based tie-breaking makes an agent quietly positional — it would
 * always favour the lowest-numbered piece — and that bias is invisible in
 * aggregate results.
 */
export function argmaxRandom<T>(xs: T[], score: (x: T) => number, rng: Rng): T | null {
  if (xs.length === 0) return null;
  let best = -Infinity;
  let ties: T[] = [];
  for (const x of xs) {
    const s = score(x);
    if (s > best + 1e-9) {
      best = s;
      ties = [x];
    } else if (s > best - 1e-9) {
      ties.push(x);
    }
  }
  return pick(ties, rng);
}
