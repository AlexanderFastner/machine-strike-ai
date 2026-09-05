import {
  MACHINE_BY_ID, applyActivation, legalActivations, other,
  type Activation, type GameState, type Owner,
} from "@ms/engine";
import { argmaxRandom, pick, type Agent, type Rng } from "./agent";
import { evaluate } from "./evaluate";

/** The floor. Anything that cannot beat this is broken, not merely weak. */
export const RandomAgent: Agent = {
  name: "random",
  choose(state, rng) {
    const acts = legalActivations(state);
    return acts.length ? pick(acts, rng) : null;
  },
};

/** Damage and points gained this activation, minus what it costs me. */
function immediateGain(before: GameState, after: GameState, me: Owner): number {
  const them = other(me);
  const hp = (s: GameState, owner: Owner) =>
    s.pieces.filter((p) => p.owner === owner).reduce((n, p) => n + p.hp, 0);

  const vpGained = after.vp[me] - before.vp[me];
  const vpConceded = after.vp[them] - before.vp[them];
  const damageDealt = hp(before, them) - hp(after, them);
  const damageTaken = hp(before, me) - hp(after, me);

  return vpGained * 100 - vpConceded * 100 + damageDealt * 10 - damageTaken * 10;
}

/**
 * Greedy: maximise what this single activation gains, with no thought for the
 * reply. Strong enough to punish blunders, blind to every trap.
 */
export const GreedyAgent: Agent = {
  name: "greedy",
  choose(state, rng) {
    const acts = legalActivations(state);
    if (!acts.length) return null;
    const me = state.turn;
    return argmaxRandom(acts, (a) => immediateGain(state, applyActivation(state, a), me), rng);
  },
};

/**
 * Heuristic: one activation deep, scored by the full evaluation rather than by
 * immediate damage — so it values position, facing and terrain, not just trades.
 * This is the eval that alpha-beta will reuse at greater depth.
 */
export const HeuristicAgent: Agent = {
  name: "heuristic",
  choose(state, rng) {
    const acts = legalActivations(state);
    if (!acts.length) return null;
    const me = state.turn;
    return argmaxRandom(acts, (a) => evaluate(applyActivation(state, a), me), rng);
  },
};

/**
 * Deliberately awful: always takes the option the heuristic likes least.
 * Not a contender — a control. If the ladder is measuring anything real, this
 * has to sit clearly below random.
 */
export const AntiAgent: Agent = {
  name: "anti",
  choose(state, rng) {
    const acts = legalActivations(state);
    if (!acts.length) return null;
    const me = state.turn;
    return argmaxRandom(acts, (a) => -evaluate(applyActivation(state, a), me), rng);
  },
};

/** Attacks whenever it can, otherwise closes on the nearest enemy. */
export const AggressiveAgent: Agent = {
  name: "aggressive",
  choose(state, rng) {
    const acts = legalActivations(state);
    if (!acts.length) return null;
    const me = state.turn;
    const attacks = acts.filter((a) => a.attack);
    if (attacks.length)
      return argmaxRandom(attacks, (a) => immediateGain(state, applyActivation(state, a), me), rng);

    const enemies = state.pieces.filter((p) => p.owner !== me);
    const closeness = (a: Activation) => {
      const dest = a.dest ?? state.pieces.find((p) => p.uid === a.uid)!;
      return -Math.min(
        ...enemies.map((e) => Math.abs(e.row - dest.row) + Math.abs(e.col - dest.col)),
      );
    };
    return argmaxRandom(acts, closeness, rng);
  },
};

export const AGENTS: Record<string, Agent> = {
  random: RandomAgent,
  greedy: GreedyAgent,
  heuristic: HeuristicAgent,
  aggressive: AggressiveAgent,
  anti: AntiAgent,
};

export const agentByName = (name: string): Agent => {
  const a = AGENTS[name];
  if (!a) throw new Error(`Unknown agent "${name}". Known: ${Object.keys(AGENTS).join(", ")}`);
  return a;
};

export { MACHINE_BY_ID };
