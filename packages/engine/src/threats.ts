import { corruptedTiles } from "./corruption";
import { MACHINE_BY_ID } from "./machines";
import { reachable } from "./movement";
import { targetFrom } from "./targeting";
import {
  FACINGS, OVERCHARGE_COST, SPRINT_BONUS,
  type Facing, type GameState, type Piece,
} from "./types";

/**
 * For every machine, the directions an enemy could strike it from **next turn**:
 * move anywhere it can reach, turn, and attack under the real targeting rules.
 *
 * A direction is the way the blow travels, which is what decides the side hit
 * (rules 6.3) — a machine struck by a blow travelling south takes it on
 * whichever of its sides faces north.
 *
 * Reach includes sprint squares only when the enemy has the health to
 * overcharge, since a sprint forfeits the attack otherwise (rules 4.5).
 *
 * Every enemy is treated as free to act. Only two activate per turn, so this is
 * an upper bound — deliberately: for deciding which way to face, over-guarding
 * is cheaper than being hit on a weak side.
 */
export function strikeDirections(state: GameState): Map<number, Set<Facing>> {
  const rows = state.grid.length;
  const cols = state.grid[0].length;
  const blighted = corruptedTiles(rows, state.corruption);

  const board: (Piece | undefined)[][] = Array.from({ length: rows }, () => Array(cols).fill(undefined));
  for (const p of state.pieces) board[p.row][p.col] = p;
  const occupant = (r: number, c: number) => board[r][c];
  const onBoard = (r: number, c: number) => r >= 0 && c >= 0 && r < rows && c < cols;

  const out = new Map<number, Set<Facing>>(state.pieces.map((p) => [p.uid, new Set<Facing>()]));

  for (const attacker of state.pieces) {
    const m = MACHINE_BY_ID[attacker.machineId];
    const canPay = attacker.hp >= OVERCHARGE_COST;

    const squares: [number, number][] = [[attacker.row, attacker.col]];
    for (const [key, cost] of reachable(state, attacker, m.movement + SPRINT_BONUS, blighted)) {
      if (cost > m.movement && !canPay) continue;
      const [r, c] = key.split(",").map(Number);
      squares.push([r, c]);
    }

    // It has left its own square for the length of this question.
    board[attacker.row][attacker.col] = undefined;
    for (const [r, c] of squares) {
      for (const facing of FACINGS) {
        const t = targetFrom({ ...attacker, row: r, col: c, facing }, occupant, onBoard);
        if (t.kind === "none") continue;
        const victims = t.kind === "single" ? [t.victim] : t.victims;
        for (const v of victims) if (v.owner !== attacker.owner) out.get(v.uid)!.add(t.dir);
      }
    }
    board[attacker.row][attacker.col] = attacker;
  }
  return out;
}
