import roster from "@data/machines.json";

export type Side = "F" | "B" | "L" | "R";
export type MachineType = "Melee" | "Gunner" | "Ram" | "Dash" | "Swoop" | "Pull";

export type Machine = {
  id: string;
  name: string;
  type: MachineType;
  health: number;
  attack: number;
  range: number;
  movement: number;
  armor: Side[];
  weak: Side[];
  points: number;
  skill: string | null;
  rarity: string;
  attackArea?: [number, number][];
};

export const MACHINES: Machine[] = (roster as { pieces: Machine[] }).pieces;

export const MACHINE_BY_ID: Record<string, Machine> = Object.fromEntries(
  MACHINES.map((m) => [m.id, m]),
);

/** Placeholder sprites, keyed by machine id. Every sprite is drawn facing north. */
const sprites = import.meta.glob("../../../../assets/pieces/placeholder/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

export const SPRITE: Record<string, string> = Object.fromEntries(
  Object.entries(sprites).map(([path, url]) => [path.split("/").pop()!.replace(".svg", ""), url]),
);

/** Machine types, in the order the roster presents them. */
export const TYPE_ORDER: MachineType[] = ["Melee", "Gunner", "Ram", "Dash", "Swoop", "Pull"];

// --- draft rules (docs/rules.md 8.1) ---------------------------------------

export const TEAM_POINTS = 10;
export const MAX_COPIES = 4;

export type Team = string[]; // machine ids, duplicates allowed

export const teamPoints = (team: Team) =>
  team.reduce((sum, id) => sum + MACHINE_BY_ID[id].points, 0);

export const copiesOf = (team: Team, id: string) => team.filter((x) => x === id).length;

/** Why a machine can't be added right now, or null if it can. */
export function blockedReason(team: Team, m: Machine): string | null {
  if (copiesOf(team, m.id) >= MAX_COPIES) return `Max ${MAX_COPIES} copies`;
  if (teamPoints(team) + m.points > TEAM_POINTS) return "Not enough points left";
  return null;
}

export const isLegalTeam = (team: Team) => teamPoints(team) === TEAM_POINTS;
