/**
 * Headless arena.
 *
 *   arena match      --a greedy --b random --pairs 50
 *   arena tournament --agents random,greedy,heuristic --pairs 25
 *   arena bench      --agent heuristic
 */
import { AGENTS, agentByName } from "@ms/ai";
import { BOARDS, TEAMS, teamPoints, type MatchSetup } from "./setup";
import { playGame, playMatch, type MatchResult } from "./match";
import { fitElo, formatTable } from "./elo";

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

  default:
    console.log(
      `usage:\n` +
        `  arena match      --a <agent> --b <agent> [--pairs n] [--board b] [--team t] [--corruption on|off]\n` +
        `  arena tournament [--agents a,b,c] [--pairs n]\n` +
        `  arena bench      [--agent a] [--games n]\n\n` +
        `agents: ${Object.keys(AGENTS).join(", ")}\n` +
        `boards: ${Object.keys(BOARDS).join(", ")}\n` +
        `teams:  ${Object.keys(TEAMS).join(", ")}`,
    );
}
