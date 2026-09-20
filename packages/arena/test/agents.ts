/**
 * Agent names and the options on them. The options exist so a knob can be
 * turned from the command line without a new agent in the registry, which
 * makes two things worth guarding: that an option nobody set changes nothing,
 * and that a nonsense one is refused rather than quietly ignored.
 */
import { agentByName, type ScoringAgent } from "@ms/ai";
import { TEAMS, mirror, playGame } from "../src/index.ts";
import { BOARDS } from "../src/boards.ts";

let pass = 0, fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  if (!ok) console.log(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const throws = (label: string, f: () => unknown, fragment: string) => {
  try {
    f();
    eq(`${label} throws`, "no error", fragment);
  } catch (e) {
    const msg = (e as Error).message;
    eq(label, msg.includes(fragment) ? "ok" : msg, "ok");
  }
};

const setup = { board: BOARDS["plains-and-forests"], teams: mirror(TEAMS.standard), corruption: true };
/** The whole game, as one fingerprint. */
const game = (a: string, b: string, seed: number) =>
  playGame(agentByName(a), agentByName(b), setup, seed).checksum;

// --- how each agent scores -------------------------------------------------------
{
  const facing = (name: string) => (agentByName(name) as ScoringAgent).scoring?.opts.facing;
  eq("heuristic scores facing against what can reach it now", facing("heuristic"), "current");
  eq("heuristic-facing, against next turn (H1)", facing("heuristic-facing"), "next-turn");
  eq("heuristic-facing-own, against next turn, its own machines (H1b)", facing("heuristic-facing-own"), "next-turn-own");
  eq("anti scores the same and takes the worst of it", (agentByName("anti") as ScoringAgent).scoring.sign, -1);
  eq("greedy doesn't score with the evaluation at all", (agentByName("greedy") as ScoringAgent).scoring, undefined);
}

// --- w=, the facing weight scale (H2) ---------------------------------------------
{
  for (const name of ["heuristic", "heuristic-facing-own", "anti"]) {
    eq(`${name}:w=1 is the plain agent, name and all`, agentByName(`${name}:w=1`).name, name);
    for (const seed of [4, 12])
      eq(`${name}:w=1 plays the plain agent's game (seed ${seed})`, game(`${name}:w=1`, "greedy", seed), game(name, "greedy", seed));
  }
  eq("a scale that isn't 1 is a different agent", agentByName("heuristic-facing-own:w=2").name, "heuristic-facing-own:w=2");
  // A scale changes play, but not necessarily every game: it only matters where it
  // flips the order of the options, and plenty of decisions aren't close enough for
  // that. So this asks whether it changes any of several, not each of them.
  const changesPlay = (spec: string) =>
    [4, 12, 19, 23].filter((seed) => game(spec, "greedy", seed) !== game("heuristic-facing-own", "greedy", seed)).length;
  eq("w=0 changes games", changesPlay("heuristic-facing-own:w=0") > 0, true);
  eq("so does w=4", changesPlay("heuristic-facing-own:w=4") > 0, true);
  // Scaling rebuilds the agent, so it has to keep anything already put on it.
  const both = agentByName("heuristic:w=2:deploy=random");
  eq("a scale and a deployer survive each other, either order",
    [both.name, !!both.deploy, agentByName("heuristic:deploy=random:w=2").name, !!agentByName("heuristic:deploy=random:w=2").deploy],
    ["heuristic:w=2:deploy=random", true, "heuristic:deploy=random:w=2", true]);
}

// --- a scale on every term (H3) ------------------------------------------------------
{
  const terms = ["vp", "health", "terrain", "threat", "facing", "blight", "advance"];
  eq("every term takes a scale", terms.map((t) => agentByName(`heuristic:${t}=0`).name),
    terms.map((t) => `heuristic:${t}=0`));
  eq("a scale of 1 is the plain agent, whichever term", terms.map((t) => agentByName(`heuristic:${t}=1`).name),
    terms.map(() => "heuristic"));
  for (const seed of [4, 12])
    eq(`w= is the alias for facing= (seed ${seed})`, game("heuristic:w=0", "greedy", seed), game("heuristic:facing=0", "greedy", seed));
  eq("turning off the win condition changes games",
    [4, 12].every((seed) => game("heuristic:vp=0", "greedy", seed) !== game("heuristic", "greedy", seed)), true);
  eq("scales stack rather than replace each other",
    (agentByName("heuristic:vp=0:health=2") as ScoringAgent).scoring.opts.scale, { vp: 0, health: 2 });
}

// --- nonsense is refused ------------------------------------------------------------
throws("a scale that is not a number", () => agentByName("heuristic:w=x"), "is not a scale");
throws("a negative scale", () => agentByName("heuristic:w=-1"), "is not a scale");
throws("a scale on an agent that doesn't score", () => agentByName("greedy:w=2"), "does not score with the evaluation");
throws("an option nobody knows", () => agentByName("heuristic:z=1"), 'Unknown option "z=1"');
throws("a term nobody knows", () => agentByName("heuristic:tempo=0"), 'Unknown option "tempo=0"');
throws("an option with no value", () => agentByName("heuristic:w"), 'Unknown option "w"');
throws("an agent nobody knows", () => agentByName("nobody"), 'Unknown agent "nobody"');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
