import { canOvercharge, endActivation, endTurn, movePiece, overchargeAttack,
         payOverchargeCost, attackWith, movesFor, activatablePieces } from "./game";
import { MACHINE_BY_ID } from "./machines";
import { targetOf } from "./targeting";
import { FACINGS, type Facing, type GameState } from "./types";

/**
 * One complete activation: move somewhere (or stay), face a direction, and
 * optionally attack. This is the unit the rules actually deal in — a piece is
 * activated once, and an attack ends that activation (rules 5.4).
 *
 * Enumerating whole activations rather than atomic steps keeps the action space
 * well defined without needing within-activation state in GameState. See
 * docs/testing.md for what that does and does not cover.
 */
export type Activation = {
  uid: number;
  /** null means the machine stays put — legal only if it attacks (rules 5.3). */
  dest: { row: number; col: number } | null;
  sprint: boolean;
  facing: Facing;
  attack: boolean;
  overcharge: boolean;
};

export function legalActivations(s: GameState): Activation[] {
  if (s.winner) return [];
  const out: Activation[] = [];

  for (const piece of activatablePieces(s, s.turn)) {
    const m = MACHINE_BY_ID[piece.machineId];
    const reach = movesFor(s, piece, true);

    const destinations: { dest: Activation["dest"]; sprint: boolean }[] = [
      { dest: null, sprint: false },
      ...[...reach].map(([k, cost]) => {
        const [row, col] = k.split(",").map(Number);
        return { dest: { row, col }, sprint: cost > m.movement };
      }),
    ];

    for (const { dest, sprint } of destinations) {
      const moved = dest ? movePiece(s, piece.uid, dest.row, dest.col) : s;

      for (const facing of FACINGS) {
        const turned = moved.pieces.find((p) => p.uid === piece.uid)!;
        const oriented = { ...turned, facing };
        const canHit = targetOf({ ...moved, pieces: moved.pieces.map((p) =>
          p.uid === piece.uid ? oriented : p) }, oriented).kind !== "none";

        // Staying put is only an activation if it ends in an attack.
        if (dest) out.push({ uid: piece.uid, dest, sprint, facing, attack: false, overcharge: false });

        if (!canHit) continue;
        if (!sprint) {
          out.push({ uid: piece.uid, dest, sprint, facing, attack: true, overcharge: false });
        } else if (canOvercharge(piece)) {
          // Sprinting forfeits the attack unless it is bought back (rules 4.5).
          out.push({ uid: piece.uid, dest, sprint, facing, attack: true, overcharge: true });
        }
      }
    }
  }
  return out;
}

export function applyActivation(s0: GameState, a: Activation): GameState {
  let s = s0;
  if (a.dest) s = movePiece(s, a.uid, a.dest.row, a.dest.col);
  s = { ...s, pieces: s.pieces.map((p) => (p.uid === a.uid ? { ...p, facing: a.facing } : p)) };
  if (a.attack) s = a.overcharge ? overchargeAttack(s, a.uid) : attackWith(s, a.uid);
  else if (a.overcharge) s = payOverchargeCost(s, a.uid);
  return endActivation(s, a.uid);
}

/**
 * Chess-style perft: how many distinct sequences of `depth` activations exist
 * from this position. The absolute numbers are meaningless on their own — their
 * value is that they change the moment any rule changes, which catches edits
 * that the hand-written cases in golden.ts were never written to notice.
 */
export function perft(s: GameState, depth: number): number {
  if (depth === 0 || s.winner) return 1;
  const acts = legalActivations(s);
  // A player with nothing legal forfeits rather than being stuck (rules 5.3).
  if (acts.length === 0) return perft(endTurn(s), depth - 1);
  let nodes = 0;
  for (const a of acts) nodes += perft(applyActivation(s, a), depth - 1);
  return nodes;
}
