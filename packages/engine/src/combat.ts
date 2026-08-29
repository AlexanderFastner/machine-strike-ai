import { MACHINE_BY_ID, type Machine, type Side } from "./machines";
import { TERRAIN_MOD, type TerrainId } from "./terrain";
import { FACINGS, opposite, type Facing, type Piece } from "./types";

/**
 * Attacker Combat Power = attack + terrain.
 * Swoop ignores terrain penalties and gains +1 everywhere (rules 6.1).
 * Pull gains +1 while standing on marsh.
 */
export function attackerCP(m: Machine, terrain: TerrainId): number {
  const t = TERRAIN_MOD[terrain];
  if (m.type === "Swoop") return m.attack + Math.max(0, t) + 1;
  if (m.type === "Pull" && terrain === "marsh") return m.attack + t + 1;
  return m.attack + t;
}

/**
 * Defender Combat Power = terrain only, plus the facing modifier.
 * The defender's own Attack stat contributes nothing (rules 6.1).
 */
export function defenderCP(m: Machine, terrain: TerrainId, sideHit: Side): number {
  const t = m.type === "Swoop" ? Math.max(0, TERRAIN_MOD[terrain]) + 1 : TERRAIN_MOD[terrain];
  const facing = m.armor.includes(sideHit) ? +1 : m.weak.includes(sideHit) ? -1 : 0;
  return t + facing;
}

/**
 * Which of the defender's own sides takes the hit, given the direction the blow travels.
 * The struck face is the one whose outward normal points back at the attacker.
 */
export function sideHitBy(defenderFacing: Facing, attackDir: Facing): Side {
  const struckNormal = opposite(attackDir);
  const rel = (FACINGS.indexOf(struckNormal) - FACINGS.indexOf(defenderFacing) + 4) % 4;
  return (["F", "R", "B", "L"] as const)[rel];
}

export type Resolution = {
  kind: "damage" | "defenseBreak";
  damage: number;
  attackerCP: number;
  defenderCP: number;
  sideHit: Side;
};

export function resolveAttack(
  attacker: Piece,
  defender: Piece,
  attackerTerrain: TerrainId,
  defenderTerrain: TerrainId,
  attackDir: Facing,
): Resolution {
  const am = MACHINE_BY_ID[attacker.machineId];
  const dm = MACHINE_BY_ID[defender.machineId];
  const sideHit = sideHitBy(defender.facing, attackDir);
  const aCP = attackerCP(am, attackerTerrain);
  const dCP = defenderCP(dm, defenderTerrain, sideHit);

  return aCP > dCP
    ? { kind: "damage", damage: aCP - dCP, attackerCP: aCP, defenderCP: dCP, sideHit }
    : { kind: "defenseBreak", damage: 1, attackerCP: aCP, defenderCP: dCP, sideHit };
}

