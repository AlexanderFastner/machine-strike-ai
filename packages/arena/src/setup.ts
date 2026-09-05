import {
  MACHINE_BY_ID, MAX_COPIES, TEAM_POINTS, newGame, parseBoard,
  type BoardFile, type Deployment, type GameState,
} from "@ms/engine";
import flat from "../../data/boards/flat.json";
import plains from "../../data/boards/plains-and-forests.json";
import mountains from "../../data/boards/mountains.json";
import chasms from "../../data/boards/chasms.json";
import coastal from "../../data/boards/coastal.json";
import splitPeaks from "../../data/boards/split-peaks.json";

export const BOARDS: Record<string, BoardFile> = {
  flat: flat as BoardFile,
  "plains-and-forests": plains as BoardFile,
  mountains: mountains as BoardFile,
  chasms: chasms as BoardFile,
  coastal: coastal as BoardFile,
  "split-peaks": splitPeaks as BoardFile,
};

/**
 * A fixed draft book. Both sides field the same set, so a match measures play
 * and nothing else — drafting is a separate problem, and mixing the two would
 * make every result ambiguous (plan.md, Stage 2 rung 5).
 */
export const TEAMS: Record<string, string[]> = {
  // 3 + 4 + 1 + 1 + 1
  standard: ["clawstrider", "stalker", "burrower", "scrounger", "spikesnout"],
  // 4 + 3 + 2 + 1: fewer, tougher machines
  heavy: ["ravager", "clawstrider", "charger", "grazer"],
  // Five of the six machine types. Not six, because they do not fit: the
  // cheapest machine of each type totals 11 points against a budget of 10
  // (Burrower 1, Grazer 1, Charger 2, Longleg 2, Glinthawk 2, Snapmaw 3).
  // No legal set can field every type — this one drops Pull.
  varied: ["leaplasher", "longleg", "grazer", "charger", "glinthawk", "burrower", "spikesnout"],
  // The same idea keeping Pull and dropping Swoop.
  amphibious: ["snapmaw", "longleg", "grazer", "charger", "burrower", "spikesnout"],
};

export function teamPoints(team: string[]) {
  return team.reduce((n, id) => n + MACHINE_BY_ID[id].points, 0);
}

/**
 * A team that breaks the drafting rules would make every result meaningless, so
 * it fails loudly rather than quietly playing an illegal position. The first
 * draft of this file shipped a 14-point "varied" set and the arena played it
 * without complaint.
 */
export function assertLegalTeam(name: string, team: string[]) {
  const pts = teamPoints(team);
  if (pts !== TEAM_POINTS)
    throw new Error(`Team "${name}" totals ${pts} points; a legal set is exactly ${TEAM_POINTS}.`);
  for (const id of new Set(team)) {
    const n = team.filter((x) => x === id).length;
    if (n > MAX_COPIES)
      throw new Error(`Team "${name}" fields ${n} copies of ${id}; the limit is ${MAX_COPIES}.`);
  }
}

for (const [name, team] of Object.entries(TEAMS)) assertLegalTeam(name, team);

/**
 * Deploy both sides in their back rows, rotated 180° so the position is exactly
 * symmetric — the same fairness property the boards themselves guarantee. Any
 * remaining edge belongs to moving first, which paired games cancel out.
 */
export function mirroredDeployment(team: string[], size = 8): Deployment[] {
  const out: Deployment[] = [];
  team.forEach((machineId, i) => {
    const row = size - 1 - Math.floor(i / size);
    const col = 1 + (i % size);
    out.push({ machineId, owner: 1, row, col, facing: "N" });
    out.push({ machineId, owner: 2, row: size - 1 - row, col: size - 1 - col, facing: "S" });
  });
  return out;
}

export type MatchSetup = {
  board: BoardFile;
  team: string[];
  corruption: boolean;
};

export function startPosition(setup: MatchSetup): GameState {
  const grid = parseBoard(setup.board);
  return newGame(grid, mirroredDeployment(setup.team, grid.length), setup.corruption);
}
