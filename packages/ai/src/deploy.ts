import {
  FACINGS, deploymentSquares, parseSquare, squareName, turned,
  type Facing, type Owner,
} from "@ms/engine";
import { pick, type Agent, type DeployView, type Placement, type Rng } from "./agent";

/**
 * A way of deploying, apart from any way of playing. Pair one with any agent
 * using `withDeployer`, so a deployment can be tested — or evolved — with the
 * play held fixed.
 */
export type Deployer = { name: string; deploy(view: DeployView, rng: Rng): Placement[] };

/** An agent that plays like `agent` and deploys like `deployer`: `heuristic:deploy=random`. */
export function withDeployer(agent: Agent, deployer: Deployer): Agent {
  const base = agent.name.replace(/:deploy=.*$/, "");
  return { ...agent, name: `${base}:deploy=${deployer.name}`, deploy: (view, rng) => deployer.deploy(view, rng) };
}

// ---------------------------------------------------------------------------
// Arrangements
// ---------------------------------------------------------------------------

/**
 * Canonical order, from the owner's seat: machine id, then back row before
 * front, then left to right — the order the default rule deploys in.
 */
export const canonicalOrder = (a: Placement, b: Placement) =>
  a.machineId < b.machineId ? -1 : a.machineId > b.machineId ? 1 : b.row - a.row || a.col - b.col;

/** Placements as their owner sees them — from Player 1's seat — in canonical order. */
export function fromOwnSeat(placements: Placement[], owner: Owner, rows: number, cols: number): Placement[] {
  return placements.map((p) => (owner === 1 ? { ...p } : turned(p, rows, cols))).sort(canonicalOrder);
}

/**
 * An arrangement's key: where each of one side's machines starts, written from
 * that side's own seat — rank 1 is its back row, N faces the enemy — as
 * `machine@square` plus facing, in canonical order, joined by "+". The standard
 * team under the default rule is
 * `burrower@b1N+clawstrider@c1N+scrounger@d1N+spikesnout@e1N+stalker@f1N`.
 *
 * From the owner's seat, one arrangement reads the same on either side of the
 * board, so a learned arrangement plays from both sides of a paired game. The
 * results store keys games on these, so don't change the format.
 */
export function arrangementKey(placements: Placement[], owner: Owner, rows: number, cols: number): string {
  return fromOwnSeat(placements, owner, rows, cols)
    .map((p) => `${p.machineId}@${squareName(rows, p.row, p.col)}${p.facing}`)
    .join("+");
}

/** A key back to placements, from its owner's seat; `turned` gives them to Player 2. */
export function parseArrangement(key: string, rows: number): Placement[] {
  return key.split("+").map((part) => {
    const m = /^([a-z][a-z-]*)@([a-p]\d{1,2})([NESW])$/.exec(part);
    if (!m) throw new Error(`"${part}" in arrangement "${key}" is not machine@square plus facing, like stalker@f1N.`);
    const [row, col] = parseSquare(rows, m[2]);
    return { machineId: m[1], row, col, facing: m[3] as Facing };
  });
}

/** The canonical form of a key, however its parts were ordered — no board needed: rank and file order it. */
export function canonicalArrangement(key: string): string {
  const parts = key.split("+").map((part) => {
    const m = /^([a-z][a-z-]*)@([a-p])(\d{1,2})([NESW])$/.exec(part);
    if (!m) throw new Error(`"${part}" in arrangement "${key}" is not machine@square plus facing, like stalker@f1N.`);
    return { part, id: m[1], file: m[2], rank: Number(m[3]) };
  });
  parts.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.rank - b.rank || (a.file < b.file ? -1 : 1)));
  return parts.map((p) => p.part).join("+");
}

// ---------------------------------------------------------------------------
// Deployers
// ---------------------------------------------------------------------------

/**
 * Random squares anywhere in the back two rows, and random facings: the floor
 * for deployment, as `random` is for play, and a natural first generation for
 * an evolutionary search. The machines with the fewest legal squares go first,
 * so a chasm in the back rows can't strand one that can't fly.
 */
export const RandomDeployer: Deployer = {
  name: "random",
  deploy({ owner, grid, mine }, rng) {
    const taken = new Set<string>();
    return [...mine]
      .sort()
      .map((id) => ({ id, squares: deploymentSquares(owner, grid, id) }))
      .sort((a, b) => a.squares.length - b.squares.length)
      .map(({ id, squares }) => {
        const free = squares.filter(([r, c]) => !taken.has(`${r},${c}`));
        if (!free.length) throw new Error(`No square is left in Player ${owner}'s back rows for ${id}.`);
        const [row, col] = pick(free, rng);
        taken.add(`${row},${col}`);
        return { machineId: id, row, col, facing: pick(FACINGS, rng) };
      });
  },
};

/**
 * The same arrangement every game, written as a key from its owner's seat, so
 * it means the same from either side: as Player 2 it is turned 180°. It names
 * exactly the machines it places; fielding it with a different set is caught by
 * the arena's deployment check rather than guessed around.
 */
export function fixedDeployer(key: string, name?: string): Deployer {
  const canonical = canonicalArrangement(key);
  return {
    name: name ?? canonical,
    deploy({ owner, grid }) {
      const rows = grid.length, cols = grid[0].length;
      const placements = parseArrangement(canonical, rows);
      return owner === 1 ? placements : placements.map((p) => turned(p, rows, cols));
    },
  };
}
