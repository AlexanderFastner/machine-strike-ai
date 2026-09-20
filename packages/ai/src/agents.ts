import {
  MACHINE_BY_ID, applyActivation, legalActivations, other,
  type Activation, type GameState, type Owner,
} from "@ms/engine";
import { argmaxRandom, pick, type Agent } from "./agent";
import { RandomDeployer, fixedDeployer, withDeployer } from "./deploy";
import { TERMS, evaluate, type EvalOptions, type Term } from "./evaluate";

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
 * The agents that pick by the evaluation differ in one thing only: how it scores
 * facing. So they are one function — the option the evaluation likes best, one
 * activation deep — and each carries the options it scores with, so that
 * `agentByName` can rebuild it with different ones.
 *
 * `sign` is −1 for `anti`, which takes the option the evaluation likes least.
 */
export type ScoringAgent = Agent & { scoring: { opts: EvalOptions; sign: number } };

export function scoringAgent(name: string, opts: EvalOptions, sign = 1): ScoringAgent {
  return {
    name,
    scoring: { opts, sign },
    choose(state, rng) {
      const acts = legalActivations(state);
      if (!acts.length) return null;
      const me = state.turn;
      return argmaxRandom(acts, (a) => sign * evaluate(applyActivation(state, a), me, opts), rng);
    },
  };
}

/**
 * Heuristic: one activation deep, scored by the full evaluation rather than by
 * immediate damage — so it values position, facing and terrain, not just trades.
 * This is the eval that alpha-beta will reuse at greater depth.
 */
export const HeuristicAgent = scoringAgent("heuristic", { facing: "current" });

/**
 * H1: identical to heuristic except that its facing term guards against every
 * direction a blow could come from next turn, not only enemies already in reach.
 */
export const HeuristicFacingAgent = scoringAgent("heuristic-facing", { facing: "next-turn" });

/**
 * H1b: `heuristic-facing` with the enemy half of its facing term dropped. It
 * guards its own machines against next-turn threats and says nothing about the
 * enemy's — whose weak side, the argument goes, is one they can turn away from
 * before this agent moves again (heuristics.md, H1b).
 */
export const HeuristicFacingOwnAgent = scoringAgent("heuristic-facing-own", { facing: "next-turn-own" });

/**
 * Deliberately awful: always takes the option the heuristic likes least.
 * Not a contender — a control. If the ladder is measuring anything real, this
 * has to sit clearly below random.
 */
export const AntiAgent = scoringAgent("anti", { facing: "current" }, -1);

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
  "heuristic-facing": HeuristicFacingAgent,
  "heuristic-facing-own": HeuristicFacingOwnAgent,
  aggressive: AggressiveAgent,
  anti: AntiAgent,
};

/**
 * An agent by name, with options after colons: `heuristic`, `heuristic:deploy=random`,
 * `greedy:deploy=burrower@b1N+clawstrider@c1N+…`, `heuristic-facing-own:w=2`.
 *
 *  - `deploy` takes `random`, an arrangement key (deploy.ts), or `centred` — the
 *    arena's default rule, which is simply the plain agent.
 *  - a term name — `vp`, `health`, `terrain`, `threat`, `facing`, `blight`,
 *    `advance` — scales that term's weights on an agent that scores with the
 *    evaluation: `heuristic:terrain=0`, `heuristic:threat=2` (H3). `w` is the
 *    alias for `facing` that H2 used. A scale of 1 is the plain agent, so it
 *    keeps its name and its results.
 */
export const agentByName = (spec: string): Agent => {
  const [name, ...options] = spec.split(":");
  let agent = AGENTS[name];
  if (!agent) throw new Error(`Unknown agent "${name}". Known: ${Object.keys(AGENTS).join(", ")}`);
  for (const option of options) {
    const [key, value] = [option.slice(0, option.indexOf("=")), option.slice(option.indexOf("=") + 1)];
    const term = key === "w" ? "facing" : (key as Term);
    const scales = key === "deploy" ? null : TERMS[term];
    if (!option.includes("=") || !value || (key !== "deploy" && !scales))
      throw new Error(
        `Unknown option "${option}" in "${spec}". Known: deploy=centred|random|<arrangement>, ` +
          `and a scale on any term: ${Object.keys(TERMS).join(", ")} (w is the alias for facing).`,
      );
    if (scales) {
      const scale = Number(value);
      const scoring = (agent as ScoringAgent).scoring;
      if (!scoring) throw new Error(`"${name}" does not score with the evaluation, so it has no weights to scale.`);
      if (!Number.isFinite(scale) || scale < 0) throw new Error(`"${option}" is not a scale: it must be a number, 0 or more.`);
      if (scale !== 1) {
        const opts = { ...scoring.opts, scale: { ...scoring.opts.scale, [term]: scale } };
        const scaled = scoringAgent(`${agent.name}:${key}=${value}`, opts, scoring.sign);
        agent = agent.deploy ? { ...scaled, deploy: agent.deploy } : scaled;
      }
    } else if (value === "centred") agent = AGENTS[name];
    else agent = withDeployer(agent, value === "random" ? RandomDeployer : fixedDeployer(value));
  }
  return agent;
};

export { MACHINE_BY_ID };
