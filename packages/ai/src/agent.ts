import type { Activation, GameState } from "@ms/engine";

/**
 * Every agent is a pure function of (state, randomness). Randomness is injected
 * rather than taken from Math.random so that a match is reproducible from its
 * seed — without that, a result you cannot rerun is a result you cannot debug.
 */
export type Agent = {
  name: string;
  /** null means "no legal activation" — the caller ends the turn. */
  choose(state: GameState, rng: Rng): Activation | null;
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
