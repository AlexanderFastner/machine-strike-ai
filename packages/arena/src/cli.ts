/**
 * Headless arena.
 *
 *   arena match      --a greedy --b random --pairs 50
 *   arena tournament --agents random,greedy,heuristic --pairs 25
 *   arena bench      --agent heuristic
 *   arena record     --a heuristic --b greedy        (a random tournament game, saved)
 *   arena health     --a heuristic --b greedy --games 100
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AGENTS, agentByName } from "@ms/ai";
import { BOARDS, TEAMS, teamPoints, type MatchSetup } from "./setup";
import { playGame, playMatch, type MatchResult } from "./match";
import { fitElo, formatTable } from "./elo";
import { gameMetrics, rebuild, recordGame, type GameMetrics } from "./replay";

const argv = process.argv.slice(2);
const cmd = argv[0] ?? "help";
const flag = (name: string, fallback?: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const num = (name: string, fallback: number) => Number(flag(name, String(fallback)));

const setup: MatchSetup = {
  board: BOARDS[flag("board", "plains-and-forests")!] ?? BOARDS["plains-and-forests"],
  team: TEAMS[flag("team", "standard")!] ?? TEAMS.standard,
  corruption: flag("corruption", "on") !== "off",
};
const pairs = num("pairs", 25);
const seed = num("seed", 1);

function header() {
  console.log(
    `board ${flag("board", "plains-and-forests")} · team ${flag("team", "standard")} ` +
      `(${teamPoints(setup.team)} pts, ${setup.team.length} machines) · ` +
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

switch (cmd) {
  case "match": {
    header();
    const a = agentByName(flag("a", "greedy")!);
    const b = agentByName(flag("b", "random")!);
    const t0 = Date.now();
    const r = playMatch(a, b, setup, pairs, seed);
    summarise(r);
    console.log(`\n${formatTable(fitElo([r], b.name))}`);
    console.log(`\n${r.games} games in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    break;
  }

  case "tournament": {
    header();
    const names = (flag("agents", Object.keys(AGENTS).join(","))!).split(",");
    const agents = names.map(agentByName);
    const results: MatchResult[] = [];
    const t0 = Date.now();

    for (let i = 0; i < agents.length; i++)
      for (let j = i + 1; j < agents.length; j++) {
        const r = playMatch(agents[i], agents[j], setup, pairs, seed);
        results.push(r);
        summarise(r);
      }

    console.log(`\n${formatTable(fitElo(results))}`);
    const games = results.reduce((n, r) => n + r.games, 0);
    console.log(`\n${games} games in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    break;
  }

  case "bench": {
    header();
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
        `  ${Math.round(acts / (ms / 1000))} activations/sec, branching ${(branching / games).toFixed(0)}`,
    );
    break;
  }


  case "record": {
    header();
    const a = agentByName(flag("a", "heuristic")!);
    const b = agentByName(flag("b", "greedy")!);
    // Default to a random game from the same space a --pairs 50 tournament plays:
    // seeds 1-50, either side moving first. So this is one of "those games".
    const pickedSeed = argv.includes("--seed") ? seed : 1 + Math.floor(Math.random() * 50);
    const aFirst = flag("first") ? flag("first") === "a" : Math.random() < 0.5;
    const replay = aFirst ? recordGame(a, b, setup, pickedSeed) : recordGame(b, a, setup, pickedSeed);
    const frames = rebuild(replay);
    const m = gameMetrics(replay, frames);

    const dir = resolve("replays");
    mkdirSync(dir, { recursive: true });
    const file = resolve(dir, `${replay.agents[1]}-vs-${replay.agents[2]}-seed${pickedSeed}.json`);
    writeFileSync(file, JSON.stringify(replay, null, 1));

    console.log(
      `seed ${pickedSeed}: ${replay.agents[1]} (P1) vs ${replay.agents[2]} (P2) — ${m.endedBy}, ` +
        `${m.rounds} rounds, ${replay.steps.length} steps`,
    );
    printMetrics(m);
    console.log(`\nsaved ${file}\nopen it in the web app: Watch an AI game → Load a replay file`);
    break;
  }

  case "health": {
    header();
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

  default:
    console.log(
      `usage:\n` +
        `  arena match      --a <agent> --b <agent> [--pairs n] [--board b] [--team t] [--corruption on|off]\n` +
        `  arena tournament [--agents a,b,c] [--pairs n]\n` +
        `  arena bench      [--agent a] [--games n]\n` +
        `  arena record     [--a agent] [--b agent] [--seed n] [--first a|b]   save one game as a replay\n` +
        `  arena health     [--a agent] [--b agent] [--games n]               sanity metrics over many games\n\n` +
        `agents: ${Object.keys(AGENTS).join(", ")}\n` +
        `boards: ${Object.keys(BOARDS).join(", ")}\n` +
        `teams:  ${Object.keys(TEAMS).join(", ")}`,
    );
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
