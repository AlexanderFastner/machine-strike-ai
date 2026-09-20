/**
 * The results store. What it promises, and what these check:
 *
 * - a game is played once: asking again answers from the store, identically;
 * - anything that could change a game makes it a different game — board
 *   content, blight, agents, sides, sets, seed, code version — and nothing
 *   else does (a renamed board, a reordered set);
 * - results survive the process: a second connection sees them;
 * - a sweep can be resumed and extended without replaying anything;
 * - the reports compute what they claim from the stored games.
 */
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { agentByName } from "@ms/ai";
import { TEAMS, chooseDeployment, mirror, playMatch, rebuild, recordGame, type MatchSetup } from "../src/index.ts";
import { BOARDS } from "../src/boards.ts";
import { agentMatches, machineTable, setLeaderboard, wilson } from "../src/report.ts";
import { OUTCOME_SOURCES, REPO_ROOT, ResultStore, codeVersion } from "../src/store.ts";
import { runSweep } from "../src/sweep.ts";

let pass = 0, fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  if (!ok) console.log(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const dir = mkdtempSync(resolve(tmpdir(), "arena-store-test-"));
const dbFile = resolve(dir, "results.sqlite");
const random = agentByName("random");
const greedy = agentByName("greedy");
const setup = (over: Partial<MatchSetup> = {}): MatchSetup =>
  ({ board: BOARDS.flat, teams: mirror(TEAMS.standard), corruption: true, ...over });

// --- a game is played once ------------------------------------------------------
const store = new ResultStore(dbFile, "test-code");
store.startRun("test");
{
  const first = store.play(random, greedy, setup(), 11);
  const again = store.play(random, greedy, setup(), 11);
  eq("asking twice plays once", [store.played, store.reused], [1, 1]);
  eq("the stored answer is the played one, before it is even flushed", again, first);
  store.flush();
  eq("and after", store.play(random, greedy, setup(), 11), first);
  eq("it matches playing the game directly", recordGame(random, greedy, setup(), 11).result, first);
}

// --- identity: what makes a different game --------------------------------------
{
  const before = store.played;
  const heavyVsStandard = { 1: TEAMS.heavy, 2: TEAMS.standard };
  store.play(random, greedy, setup(), 12); //                                  seed
  store.play(random, greedy, setup({ board: BOARDS.mountains }), 11); //       board
  store.play(random, greedy, setup({ corruption: false }), 11); //             blight
  store.play(greedy, random, setup(), 11); //                                  sides
  store.play(random, greedy, setup({ teams: heavyVsStandard }), 11); //        sets
  store.play(random, greedy, setup({ teams: { 1: TEAMS.standard, 2: TEAMS.heavy } }), 11); // which side has which
  eq("each of seed, board, blight, sides and sets makes a new game", store.played - before, 6);

  const renamed = { ...BOARDS.flat, id: "flat-copy", name: "Flat, renamed" };
  const reordered = { 1: [...TEAMS.standard].reverse(), 2: TEAMS.standard };
  const reused = store.reused;
  store.play(random, greedy, setup({ board: renamed }), 11);
  store.play(random, greedy, setup({ teams: reordered }), 11);
  eq("a renamed board and a reordered set are the same game", [store.played - before, store.reused - reused], [6, 2]);

  const edited = { ...BOARDS.flat, rows: ["MGGGGGGG", ...BOARDS.flat.rows.slice(1)] };
  eq("an edited board is a different board", store.boardId(edited) !== store.boardId(BOARDS.flat), true);
}
store.flush();

// --- results survive the process, and belong to their code version -----------------
{
  const where = chooseDeployment(random, greedy, setup(), 11);
  const other = new ResultStore(dbFile, "test-code");
  eq("a second connection finds the game", other.find(other.identity("random", "greedy", setup(), where, 11))?.winner !== undefined, true);
  const newer = new ResultStore(dbFile, "other-code");
  eq("a different code version does not", newer.find(newer.identity("random", "greedy", setup(), where, 11)), undefined);
  other.close();
  newer.close();
}

// --- a stored game regenerates exactly --------------------------------------------
{
  const row = store.db.prepare("SELECT id FROM games WHERE seed = 11 ORDER BY id LIMIT 1").get() as { id: number };
  const g = store.game(row.id)!;
  const replay = recordGame(agentByName(g.agents[1]), agentByName(g.agents[2]), g.setup, g.seed, g.deployment);
  eq("replaying a stored game lands on its stored checksum", replay.result.checksum, g.checksum);
  eq("and re-executes cleanly", rebuild(replay).flatMap((f) => f.problems), []);
}

// --- sweeps resume and extend ----------------------------------------------------------
const board = [BOARDS["plains-and-forests"]].map((b) => b.id);
const candidates = ["burrower+clawstrider+scrounger+spikesnout+stalker", "burrower:4+grazer:4+scrounger:2"];
{
  const at = () => [store.played, store.reused];
  const [p0, r0] = at();
  await runSweep(store, { agent: "random", boards: board, corruption: true, candidates, opponents: 2, seed: 3 });
  const [p1, r1] = at();
  eq("a sweep plays 2 sets × 2 opponents × 2 games", [p1 - p0, r1 - r0], [8, 0]);
  await runSweep(store, { agent: "random", boards: board, corruption: true, candidates, opponents: 2, seed: 3 });
  const [p2, r2] = at();
  eq("running it again plays nothing", [p2 - p1, r2 - r1], [0, 8]);
  await runSweep(store, { agent: "random", boards: board, corruption: true, candidates, opponents: 3, seed: 3 });
  const [p3, r3] = at();
  eq("extending it plays only the new opponents", [p3 - p2, r3 - r2], [4, 8]);

  const halves = [];
  for (const shard of [[1, 2], [2, 2]] as [number, number][])
    halves.push(await runSweep(store, { agent: "random", boards: board, corruption: true, candidates, opponents: 3, seed: 3, shard }));
  eq("two shards split the candidates between them", halves.map((h) => h.total), [6, 6]);

  const stopped = await runSweep(store, {
    agent: "random", boards: board, corruption: true, candidates, opponents: 4, seed: 3, stop: () => true,
  });
  eq("a stop request is honoured before the next pair", stopped.done, 0);
}
store.flush();

// --- the subject side really holds the candidate ------------------------------------
{
  const rows = store.db
    .prepare(
      `SELECT s.key FROM games g JOIN sets s ON s.id = CASE g.subject WHEN 1 THEN g.set1 ELSE g.set2 END
       WHERE g.sweep = 3`,
    )
    .all() as { key: string }[];
  eq("every sweep game's subject side holds a candidate", rows.every((r) => candidates.includes(r.key)), true);
  eq("each candidate is measured from both sides equally", rows.filter((r) => r.key === candidates[0]).length, 6);
}

// --- reports compute what they claim ---------------------------------------------------
{
  const boards = [store.boardId(BOARDS["plains-and-forests"])];
  const scope = { code: "test-code", agent: "random", boards, corruption: true };
  const table = setLeaderboard(store.db, scope);
  eq("the leaderboard has both candidates and no one else", table.map((r) => r.key).sort(), [...candidates].sort());
  eq("each has 3 pairs, 6 games", table.map((r) => [r.pairs, r.games]), [[3, 6], [3, 6]]);

  // The same number, computed by hand from the raw rows.
  const raw = store.db
    .prepare(
      `SELECT s.key, g.seed, g.winner, g.subject FROM games g
       JOIN sets s ON s.id = CASE g.subject WHEN 1 THEN g.set1 ELSE g.set2 END WHERE g.sweep = 3`,
    )
    .all() as { key: string; seed: number; winner: number; subject: number }[];
  for (const r of table) {
    const mine = raw.filter((x) => x.key === r.key);
    const score = mine.reduce((n, x) => n + (x.winner === x.subject ? 1 : x.winner === 0 ? 0.5 : 0), 0) / mine.length;
    eq(`${r.key.slice(0, 20)}…'s score matches a hand count`, r.score.toFixed(6), score.toFixed(6));
  }
  eq("sets are ranked by their lower bound", table[0].low >= table[1].low, true);
  eq("other agents' games are not counted", setLeaderboard(store.db, { ...scope, agent: "greedy" }), []);
  eq("nor another sweep's", setLeaderboard(store.db, { ...scope, sweep: 4 }), []);

  const machines = machineTable(table, store.db);
  const burrower = machines.find((m) => m.machine === "burrower")!;
  eq("a machine in every measured set has no 'without'", [burrower.sets, Number.isNaN(burrower.without)], [2, true]);
  const stalker = machines.find((m) => m.machine === "stalker")!;
  eq("a machine in one set scores as that set", stalker.withIt.toFixed(6), table.find((r) => r.key === candidates[0])!.score.toFixed(6));
}

{
  // A tournament through the store, refitted from the store, gives the same results.
  // On a board nothing else in this file has touched, so the refit sees only this match.
  const coastal = setup({ board: BOARDS.coastal });
  const direct = playMatch(random, greedy, coastal, 3, 1);
  const stored = playMatch(random, greedy, coastal, 3, 1, store.player());
  store.flush();
  const [refit] = agentMatches(store.db, { code: "test-code", boards: [store.boardId(BOARDS.coastal)], corruption: true },
    store.findSetId(TEAMS.standard)!);
  eq("a stored match gives the same result as a played one", stored, direct);
  eq("and refitting it from the store agrees",
    [refit.a, refit.b, refit.wins, refit.losses, refit.draws],
    // agentMatches orders the pair alphabetically; greedy < random.
    ["greedy", "random", direct.losses, direct.wins, direct.draws]);
}

{
  const [lo, hi] = wilson(1, 2);
  eq("two wins out of two is not a certainty", lo > 0.3 && lo < 0.5 && hi === 1, true);
  const [a, b] = wilson(0.5, 100);
  eq("a coin over 100 pairs is 50% ± about 10", [a.toFixed(2), b.toFixed(2)], ["0.40", "0.60"]);
}

store.finishRun();
{
  const run = store.db.prepare("SELECT status, played, reused, code FROM runs WHERE id = ?").get(store.runId);
  eq("the run records what it did", { ...run }, { status: "done", played: store.played, reused: store.reused, code: "test-code" });
}
store.close();

// --- the code version sees what can change a game, and nothing else --------------------
{
  const root = mkdtempSync(resolve(tmpdir(), "arena-code-test-"));
  for (const src of OUTCOME_SOURCES) cpSync(resolve(REPO_ROOT, src), resolve(root, src), { recursive: true });
  cpSync(resolve(REPO_ROOT, "packages/arena/src/cli.ts"), resolve(root, "packages/arena/src/cli.ts"));
  const base = codeVersion(root);
  eq("the copy has the repository's code version", base, codeVersion());

  writeFileSync(resolve(root, "packages/arena/src/cli.ts"), "// edited\n");
  writeFileSync(resolve(root, "packages/engine/src/.DS_Store"), "junk");
  eq("editing the CLI, or Finder litter, changes nothing", codeVersion(root), base);

  writeFileSync(resolve(root, "packages/engine/src/combat.ts"), "// a rule change\n", { flag: "a" });
  eq("editing a rule changes the version", codeVersion(root) !== base, true);
  rmSync(root, { recursive: true });
}

rmSync(dir, { recursive: true });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
