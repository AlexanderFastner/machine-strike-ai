import {
  deploymentProblems, newGame, other, parseBoard, turned,
  type BoardFile, type Deployment, type GameState, type Owner, type TerrainId,
} from "@ms/engine";
import { canonicalOrder, makeRng, type Agent, type DeployView, type Placement } from "@ms/ai";

/**
 * Everything that decides how a game starts. Changing this file changes how
 * games play out, so it is part of the results store's code version — see
 * OUTCOME_SOURCES in store.ts, which lists every file that can.
 */
export type MatchSetup = {
  board: BoardFile;
  /** Each side's set, as machine ids. The two may differ. */
  teams: Record<Owner, string[]>;
  corruption: boolean;
};

/**
 * Both sides field the same set: the draft-book matches that measure play and
 * nothing else, because drafting is a separate problem (plan.md, Stage 2 rung 5).
 */
export const mirror = (team: string[]): Record<Owner, string[]> => ({ 1: team, 2: team });

/**
 * A set's machines in the order the default rule deploys them: sorted by id.
 * It is also the order a set's key is written in, so a key reads left to right
 * along Player 1's back row under the default rule.
 */
export const deploymentOrder = (team: string[]) => [...team].sort();

/**
 * The default rule, from the owner's seat: the set in id order, centred in the
 * back row, spilling centred into the row in front when there are more machines
 * than the board is wide, all facing the enemy.
 *
 * Centring matters once the two sets differ in size. The rule this replaced
 * filled columns from one edge: a three-machine set stood on its own left flank,
 * diagonally across the board from an opponent doing the same, and the eighth
 * machine of a large set was placed off the board — silently, since the engine
 * trusts its deployment. 23% of legal sets have eight or more machines.
 */
export function centred(team: string[], rows: number, cols: number): Placement[] {
  const order = deploymentOrder(team);
  const back = Math.min(order.length, cols);
  const front = order.length - back;
  return order.map((machineId, i) => {
    const inBack = i < back;
    const col = Math.floor((cols - (inBack ? back : front)) / 2) + (inBack ? i : i - back);
    return { machineId, row: inBack ? rows - 1 : rows - 2, col, facing: "N" };
  });
}

/**
 * Each side deploys on a random stream of its own, apart from the game's — so
 * an agent that chooses a deployment can never shift the dice of the game that
 * follows, and an agent that doesn't choose plays exactly the game it always did.
 */
const deployRng = (seed: number, owner: Owner) =>
  makeRng(Math.imul((seed ^ (owner === 1 ? 0x5bd1e995 : 0x27d4eb2f)) >>> 0, 0x9e3779b1) >>> 0);

/**
 * One side's placements as deployments, in canonical order. The order decides
 * which machine is which piece — and pieces are offered to agents in that order —
 * so without this, one arrangement listed two ways would be two different games.
 */
function asDeployments(placements: Placement[], owner: Owner, rows: number, cols: number): Deployment[] {
  return placements
    .map((p) => ({ p, own: owner === 1 ? p : turned(p, rows, cols) }))
    .sort((a, b) => canonicalOrder(a.own, b.own))
    .map(({ p }) => ({ machineId: p.machineId, owner, row: p.row, col: p.col, facing: p.facing }));
}

/**
 * Where every machine starts. Each side's agent chooses, if it deploys at all
 * (rules §8.2: anywhere in its back two rows, any facing); otherwise the centred
 * rule places it. Both sides choose at once, knowing both sets but not each
 * other's placements. Every choice is checked against the rules — an agent is
 * trusted no more than the draft book was — and a bad one fails loudly, by name.
 */
export function chooseDeployment(p1: Agent, p2: Agent, setup: MatchSetup, seed: number): Deployment[] {
  return deployOn(parseBoard(setup.board), p1, p2, setup.teams, setup.corruption, seed, setup.board.id);
}

/** Both sides by the default rule, checked: where the machines of any agent that doesn't choose start. */
export function defaultDeployment(teams: Record<Owner, string[]>, grid: TerrainId[][]): Deployment[] {
  const plain: Agent = { name: "default", choose: () => null };
  return deployOn(grid, plain, plain, teams, true, 0, "this board");
}

function deployOn(
  grid: TerrainId[][], p1: Agent, p2: Agent, teams: Record<Owner, string[]>,
  corruption: boolean, seed: number, where: string,
): Deployment[] {
  const rows = grid.length, cols = grid[0].length;
  const out: Deployment[] = [];
  for (const [owner, agent] of [[1, p1], [2, p2]] as [Owner, Agent][]) {
    const view: DeployView = {
      owner,
      grid: grid.map((row) => [...row]),
      corruption,
      mine: [...teams[owner]],
      theirs: [...teams[other(owner)]],
    };
    const placements = agent.deploy
      ? agent.deploy(view, deployRng(seed, owner))
      : centred(teams[owner], rows, cols).map((p) => (owner === 1 ? p : turned(p, rows, cols)));
    const side = asDeployments(placements, owner, rows, cols);
    // Checked one side at a time, so a problem is pinned on the agent that caused it.
    const problems = deploymentProblems(side, grid, { [owner]: teams[owner], [other(owner)]: [] } as Record<Owner, string[]>);
    if (problems.length)
      throw new Error(
        `${agent.deploy ? agent.name : "The default deployment"} (Player ${owner}) is illegal on ${where}: ` +
          `${problems.join("; ")}.`,
      );
    out.push(...side);
  }
  return out;
}

export function startPosition(setup: MatchSetup, deployment: Deployment[]): GameState {
  const grid = parseBoard(setup.board);
  const problems = deploymentProblems(deployment, grid, setup.teams);
  if (problems.length) throw new Error(`Illegal deployment on ${setup.board.id}: ${problems.join("; ")}.`);
  return newGame(grid, deployment, setup.corruption);
}
