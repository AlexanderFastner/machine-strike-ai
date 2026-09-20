import {
  MACHINE_BY_ID, TERRAIN_MOD, attackEnvelope, corruptedTiles, other, sideHitBy, strikeDirections,
  type GameState, type Owner, type Piece,
} from "@ms/engine";

/**
 * A hand-crafted evaluation, positive meaning good for `me`.
 *
 * Weights are guesses, not tuned — the plan's Texel-style tuning against
 * self-play outcomes comes later. They are kept as named constants so that
 * tuning is a change to data rather than to code.
 */
export const WEIGHTS = {
  victoryPoint: 100, // dominates: VP is the win condition
  health: 6, // per point of health, scaled by the machine's value
  terrain: 4, // terrain is the defender's entire Combat Power
  threatened: -5, // one of mine sits in an enemy's reach
  threatening: 3, // one of theirs sits in mine
  weakSideExposed: -8, // presenting a weak side to something that can reach it
  armourPresented: 4, // presenting an armoured side instead
  inBlight: -25, // standing in corruption bleeds 2 a round
  advance: 1, // mild pull toward the enemy, so agents engage rather than idle
};

const value = (p: Piece) => MACHINE_BY_ID[p.machineId].points;

/** Which of the defender's sides faces a given attacker. */
function sideToward(defender: Piece, attacker: Piece): "F" | "B" | "L" | "R" {
  const dr = attacker.row - defender.row;
  const dc = attacker.col - defender.col;
  const dir = Math.abs(dr) >= Math.abs(dc) ? (dr < 0 ? "N" : "S") : dc < 0 ? "W" : "E";
  const order = ["N", "E", "S", "W"] as const;
  const rel = (order.indexOf(dir) - order.indexOf(defender.facing) + 4) % 4;
  return (["F", "R", "B", "L"] as const)[rel];
}

/**
 * Which threats the facing term scores against.
 *  - "current":   enemies whose reach *from where they stand* covers the machine.
 *                 Blind to anything that has to move first — nearly every blow
 *                 that actually lands (heuristics.md, H0 finding 2).
 *  - "next-turn": every direction an enemy could strike from after moving (H1),
 *                 scored for both sides' machines.
 *  - "next-turn-own": the same map, scored only for the agent's own machines
 *                 (H1b) — an enemy's exposed weak side is one it can turn away
 *                 from before this agent moves again, so it is a threat that
 *                 mostly isn't there.
 * Nothing else in the evaluation differs between them.
 */
export type EvalOptions = {
  facing: "current" | "next-turn" | "next-turn-own";
  /**
   * Multiplier on both facing weights, their 2:1 ratio untouched (H2). The
   * weights were set for a term that fired once a game; the next-turn term
   * fires on every machine every turn. 1 leaves WEIGHTS as they stand; 0
   * removes facing scoring altogether.
   */
  facingScale?: number;
};

export function evaluate(
  s: GameState,
  me: Owner,
  opts: EvalOptions = { facing: "current" },
): number {
  if (s.winner === me) return 1e6;
  if (s.winner === other(me)) return -1e6;
  if (s.winner === "draw") return 0;

  const them = other(me);
  const facingScale = opts.facingScale ?? 1;
  const blight = corruptedTiles(s.grid.length, s.corruption);
  let score = (s.vp[me] - s.vp[them]) * WEIGHTS.victoryPoint;

  // Precompute reach once per piece: it is the expensive part of this function.
  const reach = new Map<number, { tiles: Set<string>; threats: Set<string> }>();
  for (const p of s.pieces) reach.set(p.uid, attackEnvelope(s, p));

  for (const p of s.pieces) {
    const mine = p.owner === me;
    const sign = mine ? 1 : -1;
    const m = MACHINE_BY_ID[p.machineId];

    // Health, weighted by how much the machine is worth losing.
    score += sign * p.hp * WEIGHTS.health * (value(p) / m.health);

    // Terrain is the defender's whole Combat Power, so height is worth real points.
    const onBlight = blight.has(`${p.row},${p.col}`);
    score += sign * (onBlight ? -2 : TERRAIN_MOD[s.grid[p.row][p.col]]) * WEIGHTS.terrain;
    if (onBlight) score += sign * WEIGHTS.inBlight;

    // Engagement: without this, agents that cannot see a capture just shuffle.
    const enemies = s.pieces.filter((q) => q.owner !== p.owner);
    if (enemies.length) {
      const nearest = Math.min(
        ...enemies.map((q) => Math.abs(q.row - p.row) + Math.abs(q.col - p.col)),
      );
      score += sign * -nearest * WEIGHTS.advance;
    }
  }

  // Facing and threat, which is where this game is actually decided.
  for (const attacker of s.pieces) {
    const env = reach.get(attacker.uid)!;
    for (const victim of s.pieces) {
      if (victim.owner === attacker.owner) continue;
      if (!env.tiles.has(`${victim.row},${victim.col}`)) continue;

      const iAmAttacking = attacker.owner === me;
      score += iAmAttacking ? WEIGHTS.threatening : WEIGHTS.threatened;
      if (opts.facing !== "current") continue;

      const vm = MACHINE_BY_ID[victim.machineId];
      const side = sideToward(victim, attacker);
      const exposure = vm.weak.includes(side)
        ? WEIGHTS.weakSideExposed
        : vm.armor.includes(side)
          ? WEIGHTS.armourPresented
          : 0;
      // A weak side exposed is bad for the victim's owner.
      score += (victim.owner === me ? 1 : -1) * exposure * facingScale;
    }
  }

  if (opts.facing !== "current") {
    // Same weights as the "current" term, but one term per direction a blow
    // could come from next turn, rather than per enemy that can already reach.
    const mineOnly = opts.facing === "next-turn-own";
    const strikes = strikeDirections(s);
    for (const victim of s.pieces) {
      if (mineOnly && victim.owner !== me) continue;
      const vm = MACHINE_BY_ID[victim.machineId];
      for (const dir of strikes.get(victim.uid)!) {
        const side = sideHitBy(victim.facing, dir);
        const exposure = vm.weak.includes(side)
          ? WEIGHTS.weakSideExposed
          : vm.armor.includes(side)
            ? WEIGHTS.armourPresented
            : 0;
        score += (victim.owner === me ? 1 : -1) * exposure * facingScale;
      }
    }
  }

  return score;
}
