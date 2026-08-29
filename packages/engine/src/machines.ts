import roster from "../../data/machines.json";

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
export const TYPE_ORDER: MachineType[] = ["Melee", "Gunner", "Ram", "Dash", "Swoop", "Pull"];

// --- drafting (rules 8.1) --------------------------------------------------

export const TEAM_POINTS = 10;
export const MAX_COPIES = 4;

export type Team = string[]; // machine ids; duplicates allowed up to MAX_COPIES

export const teamPoints = (team: Team) =>
  team.reduce((sum, id) => sum + MACHINE_BY_ID[id].points, 0);

export const copiesOf = (team: Team, id: string) => team.filter((x) => x === id).length;

/** Why this machine cannot be added right now, or null if it can. */
export function blockedReason(team: Team, m: Machine): string | null {
  if (copiesOf(team, m.id) >= MAX_COPIES) return `Limit ${MAX_COPIES} per set`;
  if (teamPoints(team) + m.points > TEAM_POINTS) return "Not enough points left";
  return null;
}

export const isLegalTeam = (team: Team) => teamPoints(team) === TEAM_POINTS;
