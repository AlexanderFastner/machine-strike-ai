import { useState } from "react";
import { AGENTS } from "@ms/ai";
import { TEAMS } from "@ms/arena";
import { PieceToken } from "../board/PieceToken";
import { Steps } from "./BoardSelect";
import { MACHINE_BY_ID, teamPoints, type Team } from "../data/machines";

type Props = {
  onStart: (choice: { agent: string; team: Team }) => void;
  onBack: () => void;
};

/**
 * What each agent is, in a sentence — the same ladder docs/arena.md ranks, minus
 * the jargon. Where one exists because of an experiment, it says so: those are
 * the interesting ones to play against, because they are wrong in a known way.
 */
const ABOUT: Record<string, string> = {
  random: "Plays a legal move at random. The floor: anything that loses to this is broken, not weak.",
  aggressive: "Attacks whenever it can, and walks at the nearest machine when it can't.",
  greedy: "Takes the most it can get from one activation — damage and points, minus what it costs. Blind to your reply.",
  heuristic: "Weighs position, terrain and facing as well as material, one activation deep. The strongest here.",
  "heuristic-facing": "Heuristic, guarding its facing against where blows could come from next turn. Takes a third of the weak-side hits — and loses to plain heuristic anyway.",
  "heuristic-facing-own": "The same idea with the half that guards *your* facing dropped. Level with heuristic, and twenty points better than the version above.",
  anti: "Deliberately plays the move its evaluation likes least. A control, not an opponent.",
};

const ORDER = ["heuristic", "heuristic-facing-own", "heuristic-facing", "greedy", "aggressive", "random", "anti"];

export function Opponent({ onStart, onBack }: Props) {
  const [agent, setAgent] = useState("heuristic");
  const [team, setTeam] = useState("standard");

  const agents = ORDER.filter((name) => name in AGENTS);

  return (
    <div className="screen wide">
      <Steps active={2} />
      <h2 className="screen-title">Choose your opponent and your set</h2>

      <div className="vs-ai">
        <section>
          <h3 className="tray-title">Opponent</h3>
          <ul className="choice-list">
            {agents.map((name) => (
              <li key={name}>
                <button
                  className={`choice${agent === name ? " on" : ""}`}
                  onClick={() => setAgent(name)}
                  aria-pressed={agent === name}
                >
                  <b>{name}</b>
                  <span>{ABOUT[name]}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="tray-title">Your set</h3>
          <ul className="choice-list">
            {Object.entries(TEAMS).map(([name, machines]) => (
              <li key={name}>
                <button
                  className={`choice${team === name ? " on" : ""}`}
                  onClick={() => setTeam(name)}
                  aria-pressed={team === name}
                >
                  <b>
                    {name} · {machines.length} machines · {teamPoints(machines)} points
                  </b>
                  <span className="set-row">
                    {machines.map((id, i) => (
                      <PieceToken key={i} className="thumb" machine={MACHINE_BY_ID[id]} owner={1} facing="N" />
                    ))}
                  </span>
                  <span>{machines.map((id) => MACHINE_BY_ID[id].name).join(", ")}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="rule-note">
            You play Player 1 and move first. Your opponent fields the same set, so the game is decided by play
            rather than by the draft — the same rule the arena measures agents under.
          </p>
        </section>
      </div>

      <div className="actions">
        <button onClick={onBack}>Back</button>
        <button className="primary" onClick={() => onStart({ agent, team: TEAMS[team] })}>
          Deploy your machines
        </button>
      </div>
    </div>
  );
}
