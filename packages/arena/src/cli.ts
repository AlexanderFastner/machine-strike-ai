/**
 * Headless arena.
 *
 *   arena match      --a greedy --b random --pairs 50
 *   arena tournament --agents random,greedy,heuristic --pairs 25
 *   arena bench      --agent heuristic
 *   arena record     --a heuristic --b greedy        (a random tournament game, saved)
 *   arena record     --game 1234                     (a stored game, regenerated and verified)
 *   arena health     --a heuristic --b greedy --games 100
 *   arena sweep      --agent greedy --board all --sets all --opponents 5 --jobs 5
 *   arena report     sets | machines | agents
 *
 * Any agent can be told how to deploy: `heuristic:deploy=random`, or an
 * arrangement such as `greedy:deploy=burrower@b1N+clawstrider@c1N+…` (ai/deploy.ts).
 *
 * match, tournament and sweep keep every game in the results store
 * (results/arena.sqlite — docs/results.md) and answer from it when a game has
 * already been played under the same code. --no-store plays everything afresh
 * and keeps nothing.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";
import { AGENTS, agentByName } from "@ms/ai";
import { BOARDS, resolveBoards } from "./boards";
import { playGame, playMatch, type MatchResult } from "./match";
import { fitElo, formatTable } from "./elo";
import { gameMetrics, rebuild, recordGame, type GameMetrics } from "./replay";
import { agentMatches, codeVersions, machineTable, setLeaderboard, toCsv, type Scope } from "./report";
import { TEAMS, allSetKeys, resolveTeam, sampleSets, setKey, teamPoints } from "./sets";
import { mirror, type MatchSetup } from "./setup";
import { DEFAULT_DB, REPO_ROOT, ResultStore } from "./store";
import { runSweep, type SweepProgress } from "./sweep";

const argv = process.argv.slice(2);
const cmd = argv[0] ?? "help";
const flag = (name: string, fallback?: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const num = (name: string, fallback: number) => Number(flag(name, String(fallback)));

const boardName = flag("board", "plains-and-forests")!;
const teamName = flag("team", "standard")!;
const corruption = flag("corruption", "on") !== "off";
const pairs = num("pairs", 25);
const seed = num("seed", 1);

/** One board and one set for both sides: the setup every agent-vs-agent command uses. */
function matchSetup(): MatchSetup {
  const [board] = resolveBoards(boardName);
  return { board: BOARDS[board], teams: mirror(resolveTeam(teamName)), corruption };
}

function header(setup: MatchSetup) {
  const team = setup.teams[1];
  console.log(
    `board ${boardName} · team ${teamName} (${teamPoints(team)} pts, ${team.length} machines) · ` +
      `corruption ${setup.corruption ? "on" : "off"} · seed ${seed}`,
  );
}

function summarise(r: MatchResult) {
  const pct = (((r.wins + r.draws / 2) / r.games) * 100).toFixed(1);
  console.log(
    `${r.a} vs ${r.b}: ${r.wins}W ${r.losses}L ${r.draws}D of ${r.games}  (${pct}% for ${r.a})\n` +
      `  average ${r.avgRounds.toFixed(1)} rounds, branching ${r.avgBranching.toFixed(0)}` +
      (r.capped ? `, ${r.capped} hit the activation cap` : ""),
  );
}

// --- the results store --------------------------------------------------------

const dbPath = resolve(flag("db", DEFAULT_DB)!);
const shownDb = relative(process.cwd(), dbPath).startsWith("..") ? dbPath : relative(process.cwd(), dbPath);
let opened: ResultStore | null = null;
const store = () => (opened ??= new ResultStore(dbPath));
const closeStore = () => opened?.close();

/** A store with a run started for this command, or null under --no-store. */
function storeRun(): ResultStore | null {
  if (argv.includes("--no-store")) return null;
  const s = store();
  s.startRun(`arena ${argv.join(" ")}`, flag("label"));
  return s;
}

function storeLine(s: ResultStore | null, games: number, seconds: number) {
  const played = s ? s.played : games;
  const rate = played && seconds ? `, ${Math.round(played / seconds)} games/s` : "";
  console.log(
    `\n${games} games in ${seconds.toFixed(1)}s` +
      (s ? ` — ${s.played} played, ${s.reused} from the store${rate} · ${shownDb} run ${s.runId}` : rate),
  );
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const fmt = (n: number) => n.toLocaleString("en-US");
const duration = (s: number) =>
  s < 90 ? `${Math.round(s)}s` : s < 5400 ? `${Math.round(s / 60)}m` : `${Math.floor(s / 3600)}h ${String(Math.round((s % 3600) / 60)).padStart(2, "0")}m`;

// --- commands -------------------------------------------------------------------

switch (cmd) {
  case "match": {
    const setup = matchSetup();
    header(setup);
    const a = agentByName(flag("a", "greedy")!);
    const b = agentByName(flag("b", "random")!);
    const s = storeRun();
    const t0 = Date.now();
    const r = playMatch(a, b, setup, pairs, seed, s ? s.player() : playGame);
    summarise(r);
    console.log(`\n${formatTable(fitElo([r], b.name))}`);
    storeLine(s, r.games, (Date.now() - t0) / 1000);
    s?.finishRun();
    break;
  }

  case "tournament": {
    const setup = matchSetup();
    header(setup);
    const names = (flag("agents", Object.keys(AGENTS).join(","))!).split(",");
    const agents = names.map(agentByName);
    const s = storeRun();
    const play = s ? s.player() : playGame;
    const results: MatchResult[] = [];
    const t0 = Date.now();

    for (let i = 0; i < agents.length; i++)
      for (let j = i + 1; j < agents.length; j++) {
        const r = playMatch(agents[i], agents[j], setup, pairs, seed, play);
        results.push(r);
        summarise(r);
      }

    console.log(`\n${formatTable(fitElo(results))}`);
    storeLine(s, results.reduce((n, r) => n + r.games, 0), (Date.now() - t0) / 1000);
    s?.finishRun();
    break;
  }

  case "bench": {
    // Never touches the store: it measures how fast games are played.
    const setup = matchSetup();
    header(setup);
    const agent = agentByName(flag("agent", "heuristic")!);
    const t0 = Date.now();
    const games = num("games", 10);
    let acts = 0, branching = 0;
    for (let i = 0; i < games; i++) {
      const r = playGame(agent, agent, setup, seed + i);
      acts += r.activations;
      branching += r.branching;
    }
    const ms = Date.now() - t0;
    console.log(
      `${agent.name} mirror: ${games} games, ${acts} activations in ${(ms / 1000).toFixed(1)}s\n` +
        `  ${Math.round(acts / (ms / 1000))} activations/sec, ${(games / (ms / 1000)).toFixed(1)} games/sec, ` +
        `branching ${(branching / games).toFixed(0)}`,
    );
    break;
  }

  case "record": {
    if (flag("game")) {
      recordStoredGame(Number(flag("game")));
      break;
    }
    const setup = matchSetup();
    header(setup);
    const a = agentByName(flag("a", "heuristic")!);
    const b = agentByName(flag("b", "greedy")!);
    // Default to a random game from the same space a --pairs 50 tournament plays:
    // seeds 1-50, either side moving first. So this is one of "those games".
    const pickedSeed = argv.includes("--seed") ? seed : 1 + Math.floor(Math.random() * 50);
    const aFirst = flag("first") ? flag("first") === "a" : Math.random() < 0.5;
    const replay = aFirst ? recordGame(a, b, setup, pickedSeed) : recordGame(b, a, setup, pickedSeed);
    const frames = rebuild(replay);
    const m = gameMetrics(replay, frames);
    const file = saveReplay(replay, `${fileSafe(replay.agents[1])}-vs-${fileSafe(replay.agents[2])}-seed${pickedSeed}.json`);

    console.log(
      `seed ${pickedSeed}: ${replay.agents[1]} (P1) vs ${replay.agents[2]} (P2) — ${m.endedBy}, ` +
        `${m.rounds} rounds, ${replay.steps.length} steps`,
    );
    printMetrics(m);
    console.log(`\nsaved ${file}\nopen it in the web app: Watch an AI game → Load a replay file`);
    break;
  }

  case "health": {
    const setup = matchSetup();
    header(setup);
    const a = agentByName(flag("a", "heuristic")!);
    const b = agentByName(flag("b", "greedy")!);
    const games = num("games", 50);
    const all: GameMetrics[] = [];
    const t0 = Date.now();
    for (let i = 0; i < games; i++) {
      const r = i % 2 === 0 ? recordGame(a, b, setup, seed + Math.floor(i / 2))
                            : recordGame(b, a, setup, seed + Math.floor(i / 2));
      all.push(gameMetrics(r, rebuild(r)));
    }
    const mean = (f: (m: GameMetrics) => number) => all.reduce((n, m) => n + f(m), 0) / all.length;
    const withAny = (f: (m: GameMetrics) => number) => all.filter((m) => f(m) > 0).length;
    const problems = all.flatMap((m) => m.problems);
    const endings = new Map<string, number>();
    for (const m of all) {
      const key = m.endedBy.replace(/Player \d/, "a player");
      endings.set(key, (endings.get(key) ?? 0) + 1);
    }

    console.log(`\n${games} games of ${a.name} vs ${b.name}, sides alternating, in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
    console.log(`re-execution problems   ${problems.length}${problems.length ? "   <-- investigate" : ""}`);
    for (const p of problems.slice(0, 5)) console.log(`    step ${p.step}: ${p.text}`);
    console.log(`rounds                  ${mean((m) => m.rounds).toFixed(1)} average`);
    console.log(`first attack            round ${mean((m) => m.firstAttackRound ?? m.rounds).toFixed(1)} average`);
    console.log(`options per decision    ${mean((m) => m.averageOptions).toFixed(0)}`);
    console.log(`attacks declined        ${mean((m) => m.declinedAttacks[1] + m.declinedAttacks[2]).toFixed(1)} per game`);
    console.log(`games with a pass       ${withAny((m) => m.passes)} of ${games}`);
    console.log(`games with idle machines ${withAny((m) => m.idle.filter((x) => x.includes("alive")).length)} of ${games}`);
    console.log(`oscillations            ${mean((m) => m.oscillations).toFixed(1)} per game`);
    console.log(`sprints / overcharges   ${mean((m) => m.sprints).toFixed(1)} / ${mean((m) => m.overcharges).toFixed(1)} per game`);
    console.log(`defense breaks          ${mean((m) => m.defenseBreaks).toFixed(1)} per game`);
    console.log(`terrain changes         ${mean((m) => m.terrainChanges).toFixed(1)} per game`);
    console.log(`blight tiles at end     ${mean((m) => m.blightTiles).toFixed(1)} of 64`);
    console.log(`how games ended:`);
    for (const [k, n] of [...endings].sort((x, y) => y[1] - x[1])) console.log(`    ${String(n).padStart(4)}  ${k}`);
    break;
  }

  case "sweep":
    await sweep();
    break;

  case "report":
    report(argv[1] && !argv[1].startsWith("--") ? argv[1] : "sets");
    break;

  default:
    console.log(
      `usage:\n` +
        `  arena match      --a <agent> --b <agent> [--pairs n] [--board b] [--team t] [--corruption on|off]\n` +
        `  arena tournament [--agents a,b,c] [--pairs n]\n` +
        `  arena bench      [--agent a] [--games n]\n` +
        `  arena record     [--a agent] [--b agent] [--seed n] [--first a|b]   save one game as a replay\n` +
        `  arena record     --game <id>                                     regenerate a stored game, and verify it\n` +
        `  arena health     [--a agent] [--b agent] [--games n]               sanity metrics over many games\n` +
        `  arena sweep      [--agent a] [--board b|a,b|all] [--sets spec] [--opponents n] [--seed n] [--jobs n]\n` +
        `                   every candidate set against n random opponents from the field, per board\n` +
        `                   --sets: all | sample:N | top:N | file:path | name-or-key,name-or-key,…\n` +
        `  arena report     sets|machines|agents [--agent a] [--board b|all] [--sweep n] [--top n]\n` +
        `                   [--min-pairs n] [--code version|all] [--csv file]\n\n` +
        `store flags: --db <file> (default ${shownDb}), --no-store, --label <text>\n` +
        `--team takes a draft-book name or any set key, e.g. burrower:4+grazer:4+scrounger:2\n` +
        `an agent can be told how to deploy: heuristic:deploy=random, heuristic:deploy=centred (the default),\n` +
        `or an arrangement written from its own seat, e.g. greedy:deploy=burrower@b1N+clawstrider@c1N+…\n\n` +
        `agents: ${Object.keys(AGENTS).join(", ")}\n` +
        `boards: ${Object.keys(BOARDS).join(", ")}\n` +
        `teams:  ${Object.keys(TEAMS).join(", ")}   (legal sets: ${fmt(allSetKeys().length)})`,
    );
}

closeStore();

// --- sweep ----------------------------------------------------------------------

/** The candidate sets a sweep measures. */
function candidateSets(spec: string, scope: () => Scope): string[] {
  const [kind, arg] = spec.includes(":") && /^(sample|top|file):/.test(spec) ? [spec.slice(0, spec.indexOf(":")), spec.slice(spec.indexOf(":") + 1)] : [spec, ""];
  if (kind === "all") return allSetKeys();
  if (kind === "sample") return sampleSets(Number(arg), seed);
  if (kind === "file")
    return readFileSync(arg, "utf8").split(/\s+/).filter(Boolean).map((k) => setKey(resolveTeam(k)));
  if (kind === "top") {
    const rows = setLeaderboard(store().db, scope(), 1).slice(0, Number(arg));
    if (!rows.length) throw new Error(`--sets top:${arg} needs a leaderboard to pick from, and the store has none for this agent, board and code.`);
    return rows.map((r) => r.key);
  }
  return spec.split(",").map((k) => setKey(resolveTeam(k.trim())));
}

async function sweep() {
  const agent = flag("agent", "greedy")!;
  agentByName(agent);
  const boards = resolveBoards(boardName);
  const opponents = num("opponents", 5);
  const jobs = num("jobs", 1);
  const shard = flag("shard")?.split("/").map(Number) as [number, number] | undefined;
  const candidates = candidateSets(flag("sets", "sample:100")!, () => scopeFor(agent, boards));
  const total = candidates.length * boards.length * opponents * 2;

  if (!shard) {
    console.log(
      `sweep ${seed} · ${agent} pilots both sides · ${boards.join(", ")} · corruption ${corruption ? "on" : "off"}\n` +
        `${fmt(candidates.length)} sets × ${opponents} opponents × ${boards.length} board${boards.length > 1 ? "s" : ""} × 2 games = ` +
        `${fmt(total)} games · code ${store().code} · ${shownDb}`,
    );
  }
  if (jobs > 1 && !shard) return runJobs(jobs, candidates);

  const s = storeRun();
  if (!s) throw new Error("A sweep exists to fill the store; it can't run with --no-store.");
  // Graceful stop: finish the pair in hand, store everything, mark the run. This is
  // also why `npm run arena` starts Node with `--import tsx` rather than through the
  // tsx command: that wrapper SIGKILLs a child that doesn't acknowledge Ctrl-C within
  // 60 ms, and a synchronous game takes longer than that.
  let stopping = 0;
  process.on("SIGINT", () => {
    // One Ctrl-C can arrive twice — from the terminal and relayed by npm — so only a
    // second press, a moment later, means "stop now".
    if (stopping && Date.now() - stopping > 1000) process.exit(130);
    if (stopping) return;
    stopping = Date.now();
    console.log(`\n${shard ? `[${shard.join("/")}] ` : ""}stopping after the current pair — Ctrl-C again to stop at once`);
  });

  const tag = shard ? `[${shard.join("/")}] ` : "";
  const line = (p: SweepProgress) => {
    const rate = p.played / Math.max(p.seconds, 1e-9);
    const eta = rate > 0 && p.done < p.total ? ` · about ${duration((p.total - p.done) / rate)} left` : "";
    return `${tag}${fmt(p.done)} / ${fmt(p.total)} games (${(p.total ? (p.done / p.total) * 100 : 100).toFixed(1)}%) · ` +
      `${fmt(p.played)} played, ${fmt(p.reused)} from the store · ${rate.toFixed(0)} games/s${eta}`;
  };
  const p = await runSweep(s, {
    agent, boards, corruption, candidates, opponents, seed, shard,
    progress: (p) => console.log(line(p)),
    stop: () => stopping > 0,
  });
  s.finishRun(stopping ? "interrupted" : "done");
  console.log(`${line(p)} · ${stopping ? "stopped" : "finished"} in ${duration(p.seconds)}`);
  if (!shard)
    console.log(`\nsee the results: npm run arena -- report sets --agent ${agent} --board ${boardName} --sweep ${seed}`);
}

/**
 * Split a sweep across n processes, each playing every nth candidate and all
 * writing to the same store. Processes rather than worker threads: each is an
 * ordinary arena run, so a crash loses one shard's last few seconds, and any
 * shard can be rerun on its own.
 */
async function runJobs(n: number, candidates: string[]) {
  // Fix the candidate list once, so a top:N list can't shift between shards.
  const file = resolve(mkdtempSync(resolve(tmpdir(), "arena-sweep-")), "sets.txt");
  writeFileSync(file, candidates.join("\n"));
  const args: string[] = [];
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--jobs" || argv[i] === "--sets") i++;
    else args.push(argv[i]);
  }
  const t0 = Date.now();
  // The jobs share this terminal, so each hears Ctrl-C itself; this only reports it, once.
  let told = false;
  process.on("SIGINT", () => {
    if (!told) console.log("\nasking every job to stop after its current pair…");
    told = true;
  });
  const codes = await Promise.all(
    Array.from({ length: n }, (_, k) =>
      new Promise<number>((done) =>
        spawn(process.execPath, [...process.execArgv, process.argv[1], "sweep", ...args, "--sets", `file:${file}`, "--shard", `${k + 1}/${n}`], {
          stdio: "inherit",
        }).on("exit", (code) => done(code ?? 1)),
      ),
    ),
  );
  const failed = codes.filter((c) => c !== 0).length;
  console.log(
    `\n${n - failed} of ${n} jobs finished cleanly in ${duration((Date.now() - t0) / 1000)}` +
      (failed ? ` — ${failed} did not; rerun the same command to fill their gaps` : "") +
      `\nsee the results: npm run arena -- report sets --agent ${flag("agent", "greedy")} --board ${boardName} --sweep ${seed}`,
  );
}

// --- report ---------------------------------------------------------------------

function scopeFor(agent: string, boards: string[]): Scope {
  const s = store();
  return {
    code: flag("code", s.code)!,
    agent,
    // A board that has never been stored gets id -1, which matches nothing.
    boards: boards.map((b) => s.findBoardId(BOARDS[b]) ?? -1),
    corruption,
    sweep: flag("sweep") !== undefined ? num("sweep", 0) : undefined,
  };
}

function report(what: string) {
  const s = store();
  const agent = flag("agent", "greedy")!;
  const boards = resolveBoards(boardName);
  const scope = scopeFor(agent, boards);
  const where =
    `${boards.join(", ")} · corruption ${corruption ? "on" : "off"}` +
    (scope.sweep !== undefined ? ` · sweep ${scope.sweep}` : "") +
    ` · code ${scope.code}${scope.code === s.code ? " (current)" : ""}`;

  if (what === "agents") {
    const setId = s.findSetId(resolveTeam(teamName));
    const results = setId === undefined ? [] : agentMatches(s.db, scope, setId);
    if (!results.length) return nothingFound(`agent-vs-agent games with team ${teamName}`);
    console.log(`Agents, from stored games · team ${teamName} · ${where}\n`);
    for (const r of results) summarise(r);
    console.log(`\n${formatTable(fitElo(results))}`);
    return;
  }

  const rows = setLeaderboard(s.db, scope, num("min-pairs", 1));
  if (!rows.length) return nothingFound(`set-sweep games piloted by ${agent}`);
  const games = rows.reduce((n, r) => n + r.games, 0);

  if (what === "machines") {
    const m = machineTable(rows, s.db);
    console.log(`Machines — how the sets that field each one score against the field\n${agent} pilots both sides · ${where}`);
    console.log(`${fmt(rows.length)} sets measured, ${fmt(games)} games. Descriptive, not causal: see report.ts, machineTable.\n`);
    console.log(`${"machine".padEnd(22)} ${"type".padEnd(7)} pts   ${"sets".padStart(7)}  ${"with it".padStart(8)}  ${"without".padStart(8)}   diff`);
    for (const r of m)
      console.log(
        `${r.machine.padEnd(22)} ${r.type.padEnd(7)} ${String(r.points).padStart(3)}   ${fmt(r.sets).padStart(7)}  ` +
          `${pct(r.withIt).padStart(8)}  ${(Number.isNaN(r.without) ? "—" : pct(r.without)).padStart(8)}   ` +
          `${Number.isNaN(r.without) ? "" : `${r.withIt >= r.without ? "+" : ""}${((r.withIt - r.without) * 100).toFixed(1)}`}`,
      );
    csvOut(m);
    return;
  }

  const top = num("top", 25);
  console.log(`Sets against the field — ${agent} pilots both sides · ${where}`);
  console.log(
    `${fmt(rows.length)} sets measured, ${fmt(games)} games. Score is against opponents drawn uniformly from all ` +
      `${fmt(allSetKeys().length)} legal sets;\nranked by the interval's lower bound, so a lucky few pairs can't top the table.\n`,
  );
  console.log(`rank   score   95% interval     pairs  machines  set`);
  rows.slice(0, top).forEach((r, i) =>
    console.log(
      `${String(i + 1).padStart(4)}   ${pct(r.score).padStart(6)}  ${`${(r.low * 100).toFixed(1)} – ${pct(r.high)}`.padStart(14)}  ` +
        `${fmt(r.pairs).padStart(6)}  ${String(r.machines).padStart(8)}  ${r.key}`,
    ),
  );
  if (rows.length > top) console.log(`   … ${fmt(rows.length - top)} more (--top n, or --csv file for all of them)`);
  csvOut(rows);
}

function nothingFound(what: string) {
  console.log(`No ${what} in ${shownDb} match: board ${boardName}, corruption ${corruption ? "on" : "off"}, code ${flag("code", store().code)}.`);
  const versions = codeVersions(store().db);
  if (versions.length) {
    console.log(`\nThe store holds games under these code versions (current: ${store().code}):`);
    for (const v of versions)
      console.log(`  ${v.code}  ${fmt(v.games).padStart(10)} games  ${v.first.slice(0, 10)} → ${v.last.slice(0, 10)}  git ${v.commits ?? "?"}`);
    console.log(`\nPass --code <version> to read one of them, or --code all to pool them deliberately.`);
  }
}

function csvOut(rows: Record<string, unknown>[]) {
  const file = flag("csv");
  if (!file) return;
  writeFileSync(file, toCsv(rows));
  console.log(`\nwrote ${fmt(rows.length)} rows to ${file}`);
}

// --- replays ----------------------------------------------------------------------

/** Agent names can carry a whole arrangement; keep file names short and portable. */
function fileSafe(name: string) {
  return name.replace(/[^a-z0-9-]+/gi, "_").slice(0, 60);
}

function saveReplay(replay: object, name: string) {
  const dir = resolve(REPO_ROOT, "replays");
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, name);
  writeFileSync(file, JSON.stringify(replay, null, 1));
  return relative(process.cwd(), file);
}

/**
 * Turn a stored result back into a replay. The store keeps outcomes, not moves;
 * this replays the game from its identity and checks it lands on the stored
 * final checksum — proof the result still reproduces, not just a lookalike.
 */
function recordStoredGame(id: number) {
  const s = store();
  const g = s.game(id);
  if (!g) throw new Error(`No game ${id} in ${shownDb}.`);
  if (g.code !== s.code)
    console.log(`note: game ${id} was played under code ${g.code}; this is ${s.code}, so it may not reproduce.`);
  // The game starts where it started, from the store — so only the way each
  // agent plays is needed, not the way it deployed, and an evolved deployer
  // with a name no registry knows still replays.
  const player = (name: string) => ({ ...agentByName(name.replace(/:deploy=.*$/, "")), name });
  const replay = recordGame(player(g.agents[1]), player(g.agents[2]), g.setup, g.seed, g.deployment);
  const m = gameMetrics(replay, rebuild(replay));
  const file = saveReplay(replay, `game-${id}.json`);
  const same = replay.result.checksum === g.checksum;
  console.log(
    `game ${id}: ${g.agents[1]} (P1, ${setKey(g.setup.teams[1])})\n` +
      `      vs ${g.agents[2]} (P2, ${setKey(g.setup.teams[2])})\n` +
      `      on ${g.setup.board.name}, seed ${g.seed} — ${m.endedBy}, ${m.rounds} rounds\n` +
      (same
        ? `reproduces exactly: the replay ends on the stored checksum ${g.checksum}`
        : `DOES NOT REPRODUCE: the replay ends on ${replay.result.checksum}, the store has ${g.checksum}`),
  );
  printMetrics(m);
  console.log(`\nsaved ${file}\nopen it in the web app: Watch an AI game → Load a replay file`);
  if (!same) process.exitCode = 1;
}

function printMetrics(m: GameMetrics) {
  const line = (k: string, v: string) => console.log(`  ${k.padEnd(22)} ${v}`);
  line("problems", m.problems.length ? m.problems.map((p) => `step ${p.step}: ${p.text}`).join("; ") : "none");
  line("first attack", m.firstAttackRound ? `round ${m.firstAttackRound}` : "never");
  line("attacks P1 / P2", `${m.attacks[1]} / ${m.attacks[2]}`);
  line("declined attacks", `${m.declinedAttacks[1]} / ${m.declinedAttacks[2]}`);
  line("machines lost", `${m.machinesLost[1]} / ${m.machinesLost[2]}`);
  line("options per decision", m.averageOptions.toFixed(0));
  line("passes", String(m.passes));
  line("idle machines", m.idle.length ? m.idle.join("; ") : "none");
  line("oscillations", String(m.oscillations));
}
