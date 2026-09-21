/**
 * The space of sets, and where each one stands. Two claims matter most: the
 * enumeration really is every legal set, and every one of those sets deploys
 * legally on every board. The second was false until this file existed — the
 * old rule put the eighth machine of a set off the board, and the engine
 * played on without noticing.
 */
import { agentByName } from "@ms/ai";
import { MACHINE_BY_ID, MAX_COPIES, TEAM_POINTS, parseBoard } from "@ms/engine";
import {
  allSetKeys, defaultDeployment, describeStep, parseSetKey, rebuild, recordGame, resolveTeam, sampleSets, setKey,
} from "../src/index.ts";
import { BOARDS, NOT_IN_ROTATION, resolveBoards } from "../src/boards.ts";
import { opponentOf } from "../src/sweep.ts";

let pass = 0, fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  if (!ok) console.log(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const throws = (label: string, f: () => unknown, match: string) => {
  try {
    f();
    eq(`${label} throws`, "no error", match);
  } catch (e) {
    eq(label, (e as Error).message.includes(match), true);
  }
};

// --- the enumeration ---------------------------------------------------------
const keys = allSetKeys();

// Frozen, like a perft count. Derived independently below; if the roster
// changes, this is where it shows.
eq("there are 147,106 legal sets", keys.length, 147106);

{
  // An independent count: dynamic programming over point totals only, never
  // building a set. Agreement means the enumeration misses nothing.
  let ways = new Array(TEAM_POINTS + 1).fill(0);
  ways[0] = 1;
  for (const m of Object.values(MACHINE_BY_ID)) {
    const next = new Array(TEAM_POINTS + 1).fill(0);
    for (let p = 0; p <= TEAM_POINTS; p++)
      for (let n = 0; n <= MAX_COPIES && p + n * m.points <= TEAM_POINTS; n++) next[p + n * m.points] += ways[p];
    ways = next;
  }
  eq("the count agrees with an independent count", keys.length, ways[TEAM_POINTS]);
}

eq("no set is listed twice", new Set(keys).size, keys.length);
{
  let bad = 0;
  const bySize = new Map<number, number>();
  for (const k of keys) {
    const team = parseSetKey(k);
    if (setKey(team) !== k) bad++;
    try {
      resolveTeam(k);
    } catch {
      bad++;
    }
    bySize.set(team.length, (bySize.get(team.length) ?? 0) + 1);
  }
  eq("every key is canonical and every set legal", bad, 0);
  // The sizes the arena has to deploy: 1 machine up to 10. The eight-plus
  // group is the one the old deployment put off the board.
  eq("sets by size", [...bySize].sort((a, b) => a[0] - b[0]),
    [[1, 1], [2, 74], [3, 1416], [4, 8605], [5, 24672], [6, 39597], [7, 38844], [8, 23832], [9, 8559], [10, 1506]]);
}

// --- keys ----------------------------------------------------------------------
eq("a key ignores order", setKey(["stalker", "burrower", "clawstrider"]), setKey(["clawstrider", "stalker", "burrower"]));
eq("repeats carry a count", setKey(["grazer", "burrower", "grazer"]), "burrower+grazer:2");
eq("keys parse back", parseSetKey("burrower+grazer:2"), ["burrower", "grazer", "grazer"]);
eq("draft-book names resolve", setKey(resolveTeam("standard")), "burrower+clawstrider+scrounger+spikesnout+stalker");
throws("an 11-point set is refused", () => resolveTeam("ravager+clawstrider+charger+grazer+burrower"), "totals 11");
throws("five copies are refused", () => resolveTeam("burrower:5+grazer:5"), "copies");
throws("an unknown machine is refused", () => resolveTeam("burrower+dragon"), "not a machine");

// --- the testing rotation ----------------------------------------------------------
eq("Flat is out of the rotation", resolveBoards("all").includes("flat"), false);
eq("but is still a board, and still runs when named", [!!BOARDS.flat, resolveBoards("flat")], [true, ["flat"]]);
eq("every other board is in it", resolveBoards("all").length, Object.keys(BOARDS).length - NOT_IN_ROTATION.size);
eq("and deployment still has to work on all of them", Object.keys(BOARDS).length, 9);

// --- deployment: every set, every board ------------------------------------------
{
  let checked = 0;
  const problems: string[] = [];
  for (const [name, board] of Object.entries(BOARDS)) {
    const grid = parseBoard(board);
    const rows = grid.length, cols = grid[0].length;
    for (const k of keys) {
      const team = parseSetKey(k);
      let ds;
      try {
        ds = defaultDeployment({ 1: team, 2: team }, grid); // throws on anything illegal
      } catch (e) {
        problems.push(`${name} ${k}: ${(e as Error).message}`);
        continue;
      }
      checked++;
      const p1 = ds.filter((d) => d.owner === 1);
      const p2 = ds.filter((d) => d.owner === 2);
      // Back two rows only, and Player 2 exactly the 180° turn of Player 1.
      if (p1.some((d) => d.row < rows - 2) || p2.some((d) => d.row > 1)) problems.push(`${name} ${k}: outside the back two rows`);
      if (p1.some((d, i) => p2[i].row !== rows - 1 - d.row || p2[i].col !== cols - 1 - d.col || p2[i].machineId !== d.machineId))
        problems.push(`${name} ${k}: Player 2 is not Player 1 turned 180°`);
    }
  }
  eq("every legal set deploys legally on every board", problems.slice(0, 3), []);
  console.log(`deployed all ${keys.length.toLocaleString()} sets on ${Object.keys(BOARDS).length} boards: ${checked.toLocaleString()} deployments`);
}

{
  const grid = parseBoard(BOARDS.flat);
  const cols = (team: string[]) => defaultDeployment({ 1: team, 2: ["ravager", "clawstrider", "charger", "grazer"] }, grid)
    .filter((d) => d.owner === 1).map((d) => [d.row, d.col]);
  eq("one machine stands centre-left", cols(["slaughterspine"]), [[7, 3]]);
  eq("five machines are centred", cols(parseSetKey("burrower+clawstrider+scrounger+spikesnout+stalker")),
    [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]]);
  eq("ten machines fill the back row and centre two in front", cols(parseSetKey("burrower:4+grazer:4+scrounger:2")),
    [[7, 0], [7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6], [7, 7], [6, 3], [6, 4]]);
  const shuffled = ["spikesnout", "stalker", "burrower", "clawstrider", "scrounger"];
  eq("deployment ignores the order a set is listed in",
    defaultDeployment({ 1: shuffled, 2: shuffled }, grid), defaultDeployment({ 1: [...shuffled].sort(), 2: [...shuffled].sort() }, grid));
  throws("a deployment onto a chasm is refused", () => defaultDeployment({ 1: ["slaughterspine"], 2: ["slaughterspine"] },
    grid.map((row, r) => row.map((t, c) => (r === 7 && c === 3 ? "chasm" : t)))), "only Swoop");
}

// --- different sets on each side play real games ----------------------------------
{
  const big = parseSetKey("burrower:4+grazer:4+scrounger:2");
  const one = ["slaughterspine"];
  for (const [board, teams] of [["chasms", { 1: big, 2: one }], ["mountains", { 1: one, 2: big }]] as const) {
    const r = recordGame(agentByName("greedy"), agentByName("greedy"), { board: BOARDS[board], teams, corruption: true }, 5);
    const frames = rebuild(JSON.parse(JSON.stringify(r)));
    eq(`10 machines against 1 on ${board} re-executes cleanly`, frames.flatMap((f) => f.problems), []);
    eq(`both sets start on the board on ${board}`,
      [frames[0].state.pieces.filter((p) => p.owner === 1).length, frames[0].state.pieces.filter((p) => p.owner === 2).length],
      [teams[1].length, teams[2].length]);
    eq(`the start names both sets on ${board}`, describeStep(r, frames, 0).note?.includes("fields"), true);
  }
}

// --- sampling ------------------------------------------------------------------------
eq("a sample is reproducible", sampleSets(50, 7), sampleSets(50, 7));
eq("a sample has no repeats", new Set(sampleSets(500, 7)).size, 500);
eq("different seeds sample differently", sampleSets(50, 7).join() === sampleSets(50, 8).join(), false);
{
  // What makes a sweep extendable: the j-th opponent of a set never depends on
  // how many opponents were asked for.
  const c = "burrower+clawstrider+scrounger+spikesnout+stalker";
  const five = [0, 1, 2, 3, 4].map((j) => opponentOf(1, c, j));
  const ten = Array.from({ length: 10 }, (_, j) => opponentOf(1, c, j));
  eq("the first five of ten opponents are the five", ten.slice(0, 5), five);
  eq("opponents are drawn from the field", ten.every((o) => keys.includes(o.opponent)), true);
  eq("a different sweep seed draws different opponents", opponentOf(2, c, 0).opponent === five[0].opponent, false);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
