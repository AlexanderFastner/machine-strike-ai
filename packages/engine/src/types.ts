import type { TerrainId } from "./terrain";

export type Owner = 1 | 2;
export type Facing = "N" | "E" | "S" | "W";

export const FACINGS: Facing[] = ["N", "E", "S", "W"];
export const DELTA: Record<Facing, [number, number]> = {
  N: [-1, 0],
  E: [0, +1],
  S: [+1, 0],
  W: [0, -1],
};
export const opposite = (f: Facing): Facing => FACINGS[(FACINGS.indexOf(f) + 2) % 4];

export type Piece = {
  uid: number;
  machineId: string;
  owner: Owner;
  row: number;
  col: number;
  facing: Facing;
  hp: number;
};

export type GameState = {
  grid: TerrainId[][];
  pieces: Piece[];
  turn: Owner;
  /** A round is one full turn cycle: both players having played. */
  round: number;
  activationsLeft: number;
  /** uids activated this turn — the two activations must be different pieces. */
  activated: number[];
  vp: Record<Owner, number>;
  log: string[];
  winner: Owner | "draw" | null;
};

export const VP_TO_WIN = 7;
export const ACTIVATIONS_PER_TURN = 2;

export const other = (o: Owner): Owner => (o === 1 ? 2 : 1);
export const at = (s: GameState, row: number, col: number) =>
  s.pieces.find((p) => p.row === row && p.col === col);
export const inBounds = (s: GameState, row: number, col: number) =>
  row >= 0 && col >= 0 && row < s.grid.length && col < s.grid[0].length;
