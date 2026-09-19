/**
 * Replays must re-execute exactly, and the checks that say so must actually
 * fire when something is wrong. The second half matters as much as the first:
 * a divergence detector that has never been seen to trip proves nothing.
 */
import { agentByName } from "@ms/ai";
import { BOARDS, TEAMS, gameMetrics, rebuild, recordGame, describeStep, type Replay } from "../src/index.ts";

let pass = 0, fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  if (!ok) console.log(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const setupFor = (board: string, corruption: boolean) =>
  ({ board: BOARDS[board], team: TEAMS.standard, corruption });

// --- honest recordings re-execute cleanly ---------------------------------
const matchups = [["heuristic", "greedy"], ["greedy", "random"], ["random", "random"], ["aggressive", "heuristic"]];
const boards = ["plains-and-forests", "mountains", "chasms", "coastal"];
let checked = 0, stepsChecked = 0;
for (const [a, b] of matchups)
  for (const board of boards)
    for (const seed of [1, 7, 23]) {
      const replay = recordGame(agentByName(a), agentByName(b), setupFor(board, seed % 2 === 1), seed);
      // Round-trip through JSON, exactly as a file on disk would.
      const loaded = JSON.parse(JSON.stringify(replay)) as Replay;
      const frames = rebuild(loaded);
      const problems = frames.flatMap((f) => f.problems);
      if (problems.length) eq(`${a} v ${b} on ${board} seed ${seed} rebuilds cleanly`, problems, []);
      else pass++;
      checked++;
      stepsChecked += loaded.steps.length;
      // Every step produces a report without throwing.
      frames.forEach((_, i) => describeStep(loaded, frames, i));
    }
console.log(`re-executed ${checked} recorded games, ${stepsChecked} steps`);

// --- the detectors fire when they should -----------------------------------
const base = recordGame(agentByName("heuristic"), agentByName("greedy"), setupFor("plains-and-forests", true), 3);
const clone = (): Replay => JSON.parse(JSON.stringify(base));

{
  const r = clone();
  r.steps[2].checksum = "deadbeef";
  const problems = rebuild(r)[3].problems;
  eq("a tampered checksum is caught as divergence", problems.some((p) => p.includes("diverged")), true);
}
{
  const r = clone();
  const a = r.steps.find((s) => s.activation)!.activation!;
  a.dest = { row: 0, col: 0 };             // teleport into the enemy back row
  const bad = rebuild(r).flatMap((f) => f.problems);
  eq("an illegal activation is caught", bad.some((p) => p.includes("not legal")), true);
}
{
  const r = clone();
  r.steps[0].optionCount += 5;
  eq("a misreported option count is caught", rebuild(r)[1].problems.some((p) => p.includes("options")), true);
}
{
  const r = clone();
  r.initialChecksum = "00000000";
  eq("a different starting position is caught", rebuild(r)[0].problems.length, 1);
}
{
  const r = clone();
  r.steps[1] = { ...r.steps[1], activation: null };
  eq("passing with moves available is flagged", rebuild(r)[2].problems.some((p) => p.includes("passed")), true);
}

// --- metrics agree with the result ----------------------------------------
{
  const frames = rebuild(base);
  const m = gameMetrics(base, frames);
  eq("no problems in an honest game", m.problems, []);
  eq("rounds match the result", m.rounds, base.result.rounds);
  eq("a winner is explained", m.endedBy.startsWith("Player"), true);
  eq("first attack is recorded", m.firstAttackRound !== null, true);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
