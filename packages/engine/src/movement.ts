import { MACHINE_BY_ID } from "./machines";
import { flyingOnly, stopsMovement } from "./terrain";
import { DELTA, FACINGS, at, inBounds, type GameState, type Piece } from "./types";

export const key = (r: number, c: number) => `${r},${c}`;

/**
 * Tiles a piece can reach, mapped to the movement spent getting there.
 *
 * - 4-directional only (rules 4.1)
 * - friendly pieces may be passed through; enemies block (rules 4.2)
 * - no piece may finish on an occupied tile
 * - chasms are enterable only by Swoop (rules 2.6)
 * - marsh ends movement on entry, so we never expand out of one (rules 4.4)
 * - corrupted tiles do the same, for every machine including flyers (rules 2.5)
 */
export function reachable(
  state: GameState,
  piece: Piece,
  budget: number,
  corrupted: Set<string> = new Set(),
): Map<string, number> {
  const m = MACHINE_BY_ID[piece.machineId];
  const flying = m.type === "Swoop";
  const seen = new Map<string, number>([[key(piece.row, piece.col), 0]]);
  let frontier: Piece[] | { row: number; col: number }[] = [{ row: piece.row, col: piece.col }];

  for (let step = 1; step <= budget; step++) {
    const next: { row: number; col: number }[] = [];
    for (const node of frontier) {
      for (const f of FACINGS) {
        const [dr, dc] = DELTA[f];
        const r = node.row + dr;
        const c = node.col + dc;
        if (!inBounds(state, r, c) || seen.has(key(r, c))) continue;

        const terrain = state.grid[r][c];
        if (flyingOnly(terrain) && !flying) continue;

        const occupant = at(state, r, c);
        if (occupant && occupant.owner !== piece.owner) continue; // enemies block

        seen.set(key(r, c), step);
        // Marsh and corruption end movement: reachable, but you cannot continue out.
        if (!stopsMovement(terrain) && !corrupted.has(key(r, c))) next.push({ row: r, col: c });
      }
    }
    frontier = next;
    if (next.length === 0) break;
  }

  // You may pass through a friendly piece but never stop on one.
  seen.delete(key(piece.row, piece.col));
  for (const [k] of seen) {
    const [r, c] = k.split(",").map(Number);
    if (at(state, r, c)) seen.delete(k);
  }
  return seen;
}
