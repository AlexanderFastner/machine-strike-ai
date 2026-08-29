import { MACHINE_BY_ID, type Machine } from "./machines";
import { TERRAIN_IDS, type TerrainId } from "./terrain";
import { DELTA, type Facing, type GameState, type Piece } from "./types";

/**
 * Fifteen skills, seven mechanisms. Everything here is data plus one small
 * function per mechanism — not fifteen special cases (rules 10).
 */

/** 1. Attack-from-terrain bonus: +1 Combat Power. One per terrain tier. */
export const TERRAIN_BONUS: Record<string, TerrainId> = {
  Gallop: "grassland",
  Stalk: "forest",
  Climb: "hill",
  "High Ground": "mountain",
};

/** 2. Terrain conversion on attack, applied to the TARGET's tile. */
export const CONVERSION: Record<string, { from: TerrainId; to: TerrainId }> = {
  Burn: { from: "forest", to: "grassland" },
  Freeze: { from: "marsh", to: "grassland" },
  Growth: { from: "grassland", to: "forest" },
};

/**
 * The terrain ladder. Skills step one rung, and they can never create a chasm:
 * the floor for skill-driven change is marsh (rules 2.3).
 */
const LADDER = TERRAIN_IDS;
const SKILL_FLOOR = 1; // marsh
const SKILL_CEILING = LADDER.length - 1; // mountain

export function stepTerrain(t: TerrainId, delta: 1 | -1): TerrainId {
  const next = LADDER.indexOf(t) + delta;
  if (next < SKILL_FLOOR || next > SKILL_CEILING) return t;
  return LADDER[next];
}

/** Manhattan distance — auras and retaliation are not directional. */
export const dist = (a: Piece, b: Piece) => Math.abs(a.row - b.row) + Math.abs(a.col - b.col);

/**
 * 4a. Empower and Blind. Both stack, and both are **snapshotted at the start of
 * each turn** (rules 10.4) rather than recomputed continuously: a machine that
 * moves into an aura mid-turn is not affected until the next turn begins.
 *
 * The snapshot covers every piece on the board, not just the active player's,
 * so an opposing Blind is already in effect when its victim's turn starts.
 */
export function attackPowerMod(state: GameState, piece: Piece): number {
  let mod = 0;
  for (const src of state.pieces) {
    if (src.uid === piece.uid) continue;
    const sm = MACHINE_BY_ID[src.machineId];
    if (sm.skill !== "Empower" && sm.skill !== "Blind") continue;
    if (dist(src, piece) > sm.range) continue;
    if (sm.skill === "Empower" && src.owner === piece.owner) mod += 1;
    if (sm.skill === "Blind" && src.owner !== piece.owner) mod -= 1;
  }
  return mod;
}

/** 1. Terrain bonus for this attacker. A corrupted tile counts only as corrupted. */
export function terrainSkillBonus(m: Machine, terrain: TerrainId, isCorrupted: boolean): number {
  if (isCorrupted || !m.skill) return 0;
  return TERRAIN_BONUS[m.skill] === terrain ? 1 : 0;
}

/** 5. Shield: +1 Combat Power when defending. */
export const shieldBonus = (m: Machine) => (m.skill === "Shield" ? 1 : 0);

/** 7. Sweep: rotate the piece's attack area by its facing. */
export function rotateOffset(facing: Facing, right: number, forward: number): [number, number] {
  switch (facing) {
    case "N": return [-forward, right];
    case "E": return [right, forward];
    case "S": return [forward, -right];
    case "W": return [-right, -forward];
  }
}

export function sweepTiles(piece: Piece, m: Machine): [number, number][] {
  if (!m.attackArea) return [];
  return m.attackArea.map(([right, forward]) => {
    const [dr, dc] = rotateOffset(piece.facing, right, forward);
    return [piece.row + dr, piece.col + dc] as [number, number];
  });
}

export const hasSweep = (m: Machine) => m.skill === "Sweep" && !!m.attackArea;

/** Facing that points from `from` toward `to`, for Retaliate's free turn. */
export function facingToward(from: Piece, to: Piece): Facing {
  const dr = to.row - from.row;
  const dc = to.col - from.col;
  if (Math.abs(dr) >= Math.abs(dc)) return dr < 0 ? "N" : "S";
  return dc < 0 ? "W" : "E";
}

export { DELTA };

/** Rules text for each skill, for the UI. Mirrors docs/rules.md §10. */
export const SKILL_TEXT: Record<string, string> = {
  Gallop: "Attacking from Grassland: +1 Combat Power.",
  Stalk: "Attacking from Forest: +1 Combat Power.",
  Climb: "Attacking from Hill: +1 Combat Power.",
  "High Ground": "Attacking from Mountain: +1 Combat Power.",
  Burn: "On attack: the target's Forest tile becomes Grassland.",
  Freeze: "On attack: the target's Marsh tile becomes Grassland.",
  Growth: "On attack: the target's Grassland tile becomes Forest.",
  "Alter Terrain": "On attack: your own tile sinks a step, the target's rises a step.",
  Empower: "Friendly machines within Attack Range gain +1 Attack Power. Stacks.",
  Spray: "Start of your turn: every piece within Attack Range loses 1 Health.",
  Whiplash: "Start of your turn: every piece within Attack Range spins 180°.",
  Blind: "Enemy machines within Attack Range lose 1 Attack Power. Stacks.",
  Shield: "+1 Combat Power when defending.",
  Retaliate: "When attacked: turns to face the attacker and deals 1 damage back.",
  Sweep: "Hits the target and everything alongside it, friend or foe.",
};

/** Recompute every piece's Empower/Blind total. Call at the start of each turn. */
export function snapshotAuras(state: GameState) {
  const next = state.pieces.map((p) => attackPowerMod(state, p));
  state.pieces.forEach((p, i) => (p.attackMod = next[i]));
}
