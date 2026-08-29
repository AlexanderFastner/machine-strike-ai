import { MACHINE_BY_ID } from "./machines";
import { DELTA, at, inBounds, type Facing, type GameState, type Piece } from "./types";

export type Target =
  | { kind: "none"; reason: string }
  | { kind: "single"; victim: Piece; dir: Facing }
  | { kind: "lane"; victims: Piece[]; dir: Facing; landing: { row: number; col: number } };

/**
 * Targeting is derived from type, facing and range — never chosen (rules 3.3).
 * Friendly pieces count as "the first machine" and block the attack.
 */
export function targetOf(state: GameState, piece: Piece): Target {
  const m = MACHINE_BY_ID[piece.machineId];
  const dir = piece.facing;
  const [dr, dc] = DELTA[dir];

  if (m.type === "Dash") {
    // Charges to the end of its range, hitting everything in the lane —
    // its own pieces included. Needs an empty tile to land on.
    const victims: Piece[] = [];
    let r = piece.row;
    let c = piece.col;
    for (let i = 0; i < m.range; i++) {
      r += dr;
      c += dc;
      if (!inBounds(state, r, c)) return { kind: "none", reason: "Charge leaves the board" };
      const occ = at(state, r, c);
      if (occ && i < m.range - 1) victims.push(occ);
      else if (occ) return { kind: "none", reason: "No empty tile to land on" };
    }
    if (victims.length === 0) return { kind: "none", reason: "Nothing in the lane" };
    return { kind: "lane", victims, dir, landing: { row: r, col: c } };
  }

  if (m.type === "Gunner") {
    // Fires at exactly maximum range: anything closer is unhittable.
    const r = piece.row + dr * m.range;
    const c = piece.col + dc * m.range;
    if (!inBounds(state, r, c)) return { kind: "none", reason: "Out of bounds" };
    const occ = at(state, r, c);
    if (!occ) return { kind: "none", reason: `Nothing at exactly ${m.range} tiles` };
    if (occ.owner === piece.owner) return { kind: "none", reason: "That is your own machine" };
    return { kind: "single", victim: occ, dir };
  }

  // Melee, Ram, Swoop, Pull: the first machine along the ray, within range.
  for (let i = 1; i <= m.range; i++) {
    const r = piece.row + dr * i;
    const c = piece.col + dc * i;
    if (!inBounds(state, r, c)) break;
    const occ = at(state, r, c);
    if (!occ) continue;
    if (occ.owner === piece.owner)
      return { kind: "none", reason: "Your own machine is in the way" };
    return { kind: "single", victim: occ, dir };
  }
  return { kind: "none", reason: "Nothing in range" };
}
