/**
 * Agents choosing where their machines start. What has to hold:
 *
 * - an agent that doesn't choose plays exactly the game it did before choosing
 *   existed, and saying "the default" explicitly changes nothing;
 * - an agent sees the board, its side and both sets — and no more;
 * - every illegal choice fails loudly, naming the agent that made it;
 * - choosing draws on dice of its own, never the game's;
 * - an arrangement means the same from either side of the board;
 * - replays and the results store record exactly where each game started.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  RandomDeployer, agentByName, arrangementKey, canonicalArrangement, fixedDeployer, parseArrangement, withDeployer,
  type Agent, type DeployView, type Placement,
} from "@ms/ai";
import { FACINGS, parseBoard, turned, type BoardFile, type Owner } from "@ms/engine";
import {
  TEAMS, centred, chooseDeployment, describeStep, mirror, parseSetKey, playGame, rebuild, recordGame, sampleSets,
  type MatchSetup, type Replay,
} from "../src/index.ts";
import { BOARDS } from "../src/boards.ts";
import { ResultStore } from "../src/store.ts";

let pass = 0, fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  if (!ok) console.log(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const throws = (label: string, f: () => unknown, ...fragments: string[]) => {
  try {
    f();
    eq(`${label} throws`, "no error", fragments);
  } catch (e) {
    const msg = (e as Error).message;
    const missing = fragments.filter((x) => !msg.includes(x));
    eq(label, missing.length ? msg : "ok", "ok");
  }
};

const setup = (over: Partial<MatchSetup> = {}): MatchSetup =>
  ({ board: BOARDS["plains-and-forests"], teams: mirror(TEAMS.standard), corruption: true, ...over });
const random = agentByName("random");
const greedy = agentByName("greedy");
/** An agent that plays like `random` and deploys however `f` says. */
const placing = (name: string, f: (v: DeployView) => Placement[]): Agent => ({ ...random, name, deploy: (v) => f(v) });
/** The default arrangement, as the given side would place it. */
const usual = (team: string[], owner: Owner): Placement[] =>
  centred(team, 8, 8).map((p) => (owner === 1 ? p : turned(p, 8, 8)));
const STANDARD = "burrower@b1N+clawstrider@c1N+scrounger@d1N+spikesnout@e1N+stalker@f1N";

// --- not choosing changes nothing ---------------------------------------------------
{
  // The default arrangement given explicitly, listed backwards: the same game.
  const explicit = withDeployer(greedy, fixedDeployer(STANDARD.split("+").reverse().join("+")));
  for (const board of ["plains-and-forests", "chasms", "mountains"])
    eq(`naming the default arrangement plays the same game on ${board}`,
      playGame(explicit, random, setup({ board: BOARDS[board] }), 9), playGame(greedy, random, setup({ board: BOARDS[board] }), 9));
  // An agent handing over the default arrangement in scrambled order: the arena
  // puts it in canonical order, or which machine is which piece would change.
  const scrambled = placing("scrambled", (v) => usual(TEAMS.standard, v.owner).reverse());
  for (const seed of [9, 10, 11])
    eq(`an arrangement listed out of order plays the same game (seed ${seed})`,
      playGame(scrambled, scrambled, setup(), seed), playGame(random, random, setup(), seed));
  eq("deploy=centred is simply the plain agent", [agentByName("heuristic:deploy=centred").name, !!agentByName("heuristic:deploy=centred").deploy], ["heuristic", false]);
  eq("the standard team's default arrangement has the documented key",
    arrangementKey(usual(TEAMS.standard, 1), 1, 8, 8), STANDARD);
}

// --- what an agent sees --------------------------------------------------------------
{
  const views: DeployView[] = [];
  const spy = placing("spy", (v) => {
    views.push(JSON.parse(JSON.stringify(v)));
    v.grid[7][0] = "chasm"; // a view is a copy: scribbling on it must not reach the game
    v.mine.pop();
    return usual(TEAMS.heavy, v.owner);
  });
  const teams = { 1: TEAMS.heavy, 2: TEAMS.heavy };
  const r = recordGame(spy, spy, setup({ teams, corruption: false }), 4);
  eq("each side is asked once, as itself", views.map((v) => v.owner), [1, 2]);
  eq("it sees its own set and the opponent's", [views[0].mine, views[0].theirs], [TEAMS.heavy, TEAMS.heavy]);
  eq("and the blight setting", views[0].corruption, false);
  eq("and the board as it is", views[0].grid, parseBoard(BOARDS["plains-and-forests"]));
  eq("one side scribbling on its view doesn't reach the other's",
    [views[1].grid, views[1].theirs], [parseBoard(BOARDS["plains-and-forests"]), TEAMS.heavy]);
  eq("nor the game", rebuild(r).flatMap((f) => f.problems), []);
}

// --- illegal choices fail loudly, by name ----------------------------------------------
{
  const s = setup();
  const moved = (owner: Owner, i: number, change: Partial<Placement>) => (v: DeployView) =>
    usual(TEAMS.standard, v.owner).map((p, j) => (v.owner === owner && j === i ? { ...p, ...change } : p));
  throws("a machine outside the back two rows", () => chooseDeployment(placing("bold", moved(1, 0, { row: 5 })), random, s, 1),
    "bold (Player 1)", "outside Player 1's back two rows");
  throws("a machine in the enemy's rows", () => chooseDeployment(random, placing("lost", moved(2, 2, { row: 7 })), s, 1),
    "lost (Player 2)", "outside Player 2's back two rows");
  throws("a machine off the board", () => chooseDeployment(placing("far", moved(1, 4, { col: 8 })), random, s, 1),
    "far (Player 1)", "off the board");
  throws("two machines on one square", () => chooseDeployment(placing("crowd", moved(1, 1, { col: 1 })), random, s, 1),
    "crowd (Player 1)", "already taken");
  throws("a facing that isn't one", () => chooseDeployment(placing("dizzy", moved(1, 0, { facing: "Q" as never })), random, s, 1),
    "dizzy (Player 1)", "not a facing");
  throws("a machine that isn't in the set", () =>
    chooseDeployment(placing("swap", moved(1, 0, { machineId: "ravager" })), random, s, 1), "swap (Player 1)", "but fields");
  throws("a machine left behind", () =>
    chooseDeployment(placing("short", (v) => usual(TEAMS.standard, v.owner).slice(1)), random, s, 1), "short (Player 1)", "but fields");
  throws("an arrangement for another set", () =>
    chooseDeployment(withDeployer(random, fixedDeployer(STANDARD)), random, setup({ teams: mirror(TEAMS.heavy) }), 1),
    `random:deploy=${STANDARD} (Player 1)`, "but fields");

  // Chasms across both back rows' first file: only a flyer may start there.
  const pits: BoardFile = { ...BOARDS.flat, id: "pits", rows: BOARDS.flat.rows.map((r, i) => (i <= 1 || i >= 6 ? "C" + r.slice(1, 7) + "C" : r)) };
  const onPit = (id: string) => placing("pit", (v) => [{ machineId: id, row: v.owner === 1 ? 7 : 0, col: v.owner === 1 ? 0 : 7, facing: v.owner === 1 ? "N" : "S" }]);
  throws("a machine that can't fly, on a chasm", () =>
    chooseDeployment(onPit("slaughterspine"), random, { board: pits, teams: { 1: ["slaughterspine"], 2: ["slaughterspine"] }, corruption: true }, 1),
    "pit (Player 1)", "only Swoop machines may enter");
  eq("a flyer may start on a chasm", chooseDeployment(onPit("stormbird"), onPit("stormbird"),
    { board: pits, teams: { 1: ["stormbird"], 2: ["stormbird"] }, corruption: true }, 1).length, 2);
  throws("the default rule fails loudly where it can't deploy", () =>
    chooseDeployment(random, random, { board: pits, teams: mirror(parseSetKey("burrower:4+grazer:4+scrounger:2")), corruption: true }, 1),
    "The default deployment (Player 1)", "only Swoop");
  {
    let ok = 0;
    const agent = withDeployer(random, RandomDeployer);
    for (let seed = 1; seed <= 200; seed++) {
      const ds = chooseDeployment(agent, agent, { board: pits, teams: mirror(parseSetKey("burrower:4+grazer:4+scrounger:2")), corruption: true }, seed);
      if (ds.length === 20) ok++;
    }
    eq("random deployment never strands a machine that can't fly", ok, 200);
  }
}

// --- random deployment ----------------------------------------------------------------
{
  const agent = withDeployer(random, RandomDeployer);
  let deployed = 0;
  const facings = new Set<string>();
  const rowsUsed = new Set<number>();
  for (const [b, key] of sampleSets(250, 5).entries()) {
    const board = Object.values(BOARDS)[b % Object.keys(BOARDS).length];
    const team = parseSetKey(key);
    const ds = chooseDeployment(agent, agent, setup({ board, teams: mirror(team) }), b); // throws if illegal
    deployed += ds.length;
    for (const d of ds) facings.add(d.facing), rowsUsed.add(d.row);
  }
  eq("random deployment is legal for 250 sets on every board", deployed > 0, true);
  eq("it uses every facing", [...facings].sort(), [...FACINGS].sort());
  eq("and both back rows on each side", [...rowsUsed].sort(), [0, 1, 6, 7]);
  const at = (seed: number) => arrangementKey(chooseDeployment(agent, random, setup(), seed).filter((d) => d.owner === 1), 1, 8, 8);
  eq("it is reproducible from the seed", at(3), at(3));
  eq("and different seeds place differently", at(3) === at(4), false);
}

// --- the deployment's dice are its own -----------------------------------------------------
{
  // Deploy at random, then play the arrangement it chose again without any dice:
  // if choosing had drawn on the game's stream, the two games would differ.
  const chooser = withDeployer(random, RandomDeployer);
  for (const seed of [2, 8, 31]) {
    const chosen = chooseDeployment(chooser, random, setup(), seed).filter((d) => d.owner === 1);
    const replayed = withDeployer(random, fixedDeployer(arrangementKey(chosen, 1, 8, 8)));
    eq(`choosing a deployment leaves the game's dice alone (seed ${seed})`,
      playGame(chooser, random, setup(), seed).checksum, playGame(replayed, random, setup(), seed).checksum);
  }
}

// --- arrangements read the same from either side ---------------------------------------------
{
  const key = "burrower@a2E+clawstrider@h1W+scrounger@d1N+spikesnout@e2S+stalker@b1N";
  const fixed = withDeployer(random, fixedDeployer(key));
  const ds = chooseDeployment(fixed, fixed, setup(), 1);
  const side = (o: Owner) => ds.filter((d) => d.owner === o);
  eq("as Player 1 it reads back as itself", arrangementKey(side(1), 1, 8, 8), key);
  eq("as Player 2 it is the same arrangement", arrangementKey(side(2), 2, 8, 8), key);
  const burrower = side(2).find((d) => d.machineId === "burrower")!;
  eq("Player 2's copy is turned 180°: a2 facing east becomes h7 facing west", [burrower.row, burrower.col, burrower.facing], [1, 7, "W"]);
  eq("keys round-trip", arrangementKey(parseArrangement(key, 8), 1, 8, 8), key);
  eq("any listing canonicalises to one key", canonicalArrangement(key.split("+").reverse().join("+")), key);
  throws("a key that isn't one is refused", () => fixedDeployer("stalker-at-b1"), "is not machine@square");
}

// --- agent names ---------------------------------------------------------------------------
{
  const a = agentByName("heuristic:deploy=random");
  eq("heuristic:deploy=random deploys", [a.name, typeof a.deploy], ["heuristic:deploy=random", "function"]);
  eq("an arrangement in the name is canonicalised",
    agentByName(`greedy:deploy=${STANDARD.split("+").reverse().join("+")}`).name, `greedy:deploy=${STANDARD}`);
  eq("a new deployer replaces the old rather than stacking",
    withDeployer(withDeployer(greedy, RandomDeployer), fixedDeployer(STANDARD)).name, `greedy:deploy=${STANDARD}`);
  throws("an unknown option is refused", () => agentByName("greedy:depth=3"), 'Unknown option "depth=3"');
  throws("an unknown agent is refused", () => agentByName("nobody:deploy=random"), 'Unknown agent "nobody"');
}

// --- replays record where the game started ----------------------------------------------------
{
  const chooser = withDeployer(greedy, RandomDeployer);
  const r = recordGame(chooser, random, setup(), 6);
  const loaded = JSON.parse(JSON.stringify(r)) as Replay;
  eq("the replay carries the chosen deployment", loaded.setup.deployment, chooseDeployment(chooser, random, setup(), 6));
  eq("and re-executes cleanly from it", rebuild(loaded).flatMap((f) => f.problems), []);
  eq("the opening says who chose", describeStep(loaded, rebuild(loaded), 0).note?.includes("Player 1 chose its own starting positions"), true);
  eq("and says nothing when nobody did",
    describeStep(recordGame(greedy, random, setup(), 6), rebuild(recordGame(greedy, random, setup(), 6)), 0).note?.includes("chose"), false);

  const nudged = JSON.parse(JSON.stringify(r)) as Replay;
  const p1 = nudged.setup.deployment.find((d) => d.owner === 1)!;
  p1.facing = p1.facing === "N" ? "E" : "N";
  eq("a doctored deployment is caught", rebuild(nudged)[0].problems.some((p) => p.includes("starting position")), true);
  const smuggled = JSON.parse(JSON.stringify(r)) as Replay;
  smuggled.setup.deployment.find((d) => d.owner === 1)!.row = 3;
  eq("and an illegal one is called illegal", rebuild(smuggled)[0].problems.some((p) => p.startsWith("illegal deployment")), true);
}

// --- the store keys games on where they started ----------------------------------------------------
{
  const dir = mkdtempSync(resolve(tmpdir(), "arena-deploy-test-"));
  const store = new ResultStore(resolve(dir, "r.sqlite"), "test-code");
  store.startRun("deploy test");
  const fixedA = withDeployer(random, fixedDeployer("burrower@a1N+clawstrider@b1N+scrounger@c1N+spikesnout@d1N+stalker@e1N"));
  const fixedB = withDeployer(random, fixedDeployer("burrower@h1N+clawstrider@g1N+scrounger@f1N+spikesnout@e1N+stalker@d1N"));
  store.play(fixedA, random, setup(), 12);
  store.play(fixedB, random, setup(), 12);
  eq("two arrangements are two games, never one reused", [store.played, store.reused], [2, 0]);
  const listedBackwards = withDeployer(random, fixedDeployer("stalker@e1N+spikesnout@d1N+scrounger@c1N+clawstrider@b1N+burrower@a1N"));
  store.play(listedBackwards, random, setup(), 12);
  eq("the same arrangement listed another way is the same game", [store.played, store.reused], [2, 1]);
  store.play(random, fixedA, setup(), 12);
  store.flush();
  const count = (sql: string) => (store.db.prepare(sql).get() as { n: number }).n;
  eq("played from either side, an arrangement is stored once",
    count("SELECT COUNT(*) AS n FROM arrangements WHERE key = 'burrower@a1N+clawstrider@b1N+scrounger@c1N+spikesnout@d1N+stalker@e1N'"), 1);

  // Replaying a stored game from its stored deployment works even for a deployer
  // no registry knows — how `arena record --game` treats evolved agents.
  const evolved = withDeployer(greedy, { ...fixedDeployer(STANDARD), name: "evo-g7-i3" });
  store.play(evolved, random, setup(), 13);
  store.flush();
  const id = (store.db.prepare("SELECT id FROM games WHERE agent1 = ?").get(evolved.name) as { id: number }).id;
  const g = store.game(id)!;
  eq("a stored game gives back its deployment", g.deployment, chooseDeployment(evolved, random, setup(), 13));
  const replay = recordGame({ ...greedy, name: g.agents[1] }, random, g.setup, g.seed, g.deployment);
  eq("which replays to the stored final position", replay.result.checksum, g.checksum);
  store.finishRun();
  store.close();
  rmSync(dir, { recursive: true });
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
