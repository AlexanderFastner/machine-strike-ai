import type { Deployment } from "./game";
import { MACHINE_BY_ID } from "./machines";
import { flyingOnly, type TerrainId } from "./terrain";
import { FACINGS, opposite, type Facing, type Owner } from "./types";

/** A square by name, as a player sees it from Player 1's seat: files a–h left to right, rank 1 nearest. */
export const squareName = (rows: number, row: number, col: number) =>
  "abcdefghijklmnop"[col] + String(rows - row);

export function parseSquare(rows: number, name: string): [number, number] {
  const m = /^([a-p])(\d{1,2})$/.exec(name);
  if (!m) throw new Error(`"${name}" is not a square.`);
  return [rows - Number(m[2]), m[1].charCodeAt(0) - 97];
}

/** Rules §8.2 [C]: each player deploys anywhere within their own back two rows. */
export const deploymentRows = (owner: Owner, rows: number): [number, number] =>
  owner === 1 ? [rows - 2, rows - 1] : [0, 1];

/** The squares this machine may start on for this player: their back two rows, less terrain it can't enter. */
export function deploymentSquares(owner: Owner, grid: TerrainId[][], machineId: string): [number, number][] {
  const flies = MACHINE_BY_ID[machineId]?.type === "Swoop";
  const out: [number, number][] = [];
  for (const row of deploymentRows(owner, grid.length))
    for (let col = 0; col < grid[row].length; col++)
      if (flies || !flyingOnly(grid[row][col])) out.push([row, col]);
  return out;
}

/**
 * The 180° turn that carries one player's side of the board onto the other's —
 * the symmetry every board is built with. Applied to a Player 2 placement it
 * gives the same placement seen from Player 1's seat, and applied again it
 * gives it back.
 */
export function turned<T extends { row: number; col: number; facing: Facing }>(p: T, rows: number, cols: number): T {
  return { ...p, row: rows - 1 - p.row, col: cols - 1 - p.col, facing: opposite(p.facing) };
}

/**
 * Everything wrong with a deployment; empty when it is legal. The engine starts a
 * game from whatever it is given — `newGame` checks nothing — so this stands
 * between a deployment someone chose and a game that should never have been
 * played. With `teams`, each side must also field exactly its own set.
 */
export function deploymentProblems(
  deployments: Deployment[],
  grid: TerrainId[][],
  teams?: Record<Owner, string[]>,
): string[] {
  const rows = grid.length;
  const problems: string[] = [];
  const taken = new Set<string>();
  for (const d of deployments) {
    const m = MACHINE_BY_ID[d.machineId];
    if (!m) {
      problems.push(`"${d.machineId}" is not a machine`);
      continue;
    }
    const onBoard = d.row >= 0 && d.row < rows && d.col >= 0 && d.col < (grid[d.row]?.length ?? 0);
    const who = `${m.name} (Player ${d.owner})`;
    const where = onBoard ? `on ${squareName(rows, d.row, d.col)}` : `at row ${d.row}, column ${d.col}`;
    if (d.owner !== 1 && d.owner !== 2) problems.push(`${m.name} belongs to no player`);
    else if (!onBoard) problems.push(`${who} is ${where}, off the board`);
    else {
      if (!deploymentRows(d.owner, rows).includes(d.row))
        problems.push(`${who} is ${where}, outside Player ${d.owner}'s back two rows`);
      if (taken.has(`${d.row},${d.col}`)) problems.push(`${who} is ${where}, a square already taken`);
      if (flyingOnly(grid[d.row][d.col]) && m.type !== "Swoop")
        problems.push(`${who} is ${where}, a ${grid[d.row][d.col]} only Swoop machines may enter`);
      taken.add(`${d.row},${d.col}`);
    }
    if (!FACINGS.includes(d.facing)) problems.push(`${who} faces "${d.facing}", which is not a facing`);
  }
  if (teams)
    for (const owner of [1, 2] as Owner[]) {
      const placed = deployments.filter((d) => d.owner === owner).map((d) => d.machineId).sort();
      const set = [...teams[owner]].sort();
      if (placed.join() !== set.join())
        problems.push(`Player ${owner} deployed ${placed.join(", ") || "nothing"}, but fields ${set.join(", ")}`);
    }
  return problems;
}
