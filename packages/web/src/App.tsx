import { useState } from "react";
import { Landing } from "./screens/Landing";
import { BoardSelect } from "./screens/BoardSelect";
import { Draft } from "./screens/Draft";
import { Opponent } from "./screens/Opponent";
import { Handoff } from "./screens/Handoff";
import { Deploy, type DeployPiece } from "./screens/Deploy";
import { Game } from "./screens/Game";
import { MapEditor } from "./screens/MapEditor";
import { ReplayViewer } from "./screens/ReplayViewer";
import { loadGame } from "./data/saves";
import { agentByName, type Agent } from "@ms/ai";
import { chooseDeployment } from "@ms/arena";
import type { BoardFile } from "./board/terrain";
import type { Deployment, GameState, Owner, Team } from "./data/machines";

type Screen =
  | { at: "landing" }
  | { at: "board"; vsAI?: boolean }
  | { at: "opponent"; board: BoardFile; corruption: boolean }
  | { at: "editor" }
  | { at: "replay" }
  | { at: "draft"; board: BoardFile; corruption: boolean; player: Owner; teams: Partial<Record<Owner, Team>> }
  | { at: "handoff"; board: BoardFile; corruption: boolean; teams: Partial<Record<Owner, Team>> }
  | { at: "deploy"; board: BoardFile; corruption: boolean; teams: Record<Owner, Team>; ai?: Agent }
  | {
      at: "game";
      board: BoardFile;
      corruption: boolean;
      deployments: Deployment[];
      resume?: GameState;
      ai?: Agent;
    };

/** The agent plays Player 2; you move first, as Player 1 always does (rules 5.1). */
const AI_OWNER: Owner = 2;

export function App() {
  const [screen, setScreen] = useState<Screen>({ at: "landing" });

  switch (screen.at) {
    case "landing":
      return (
        <Landing
          onPlay={() => setScreen({ at: "board" })}
          onPlayAI={() => setScreen({ at: "board", vsAI: true })}
          onEdit={() => setScreen({ at: "editor" })}
          onWatch={() => setScreen({ at: "replay" })}
          onContinue={() => {
            const save = loadGame();
            if (save)
              setScreen({
                at: "game",
                board: save.board,
                corruption: save.corruption,
                deployments: [],
                resume: save.state,
              });
          }}
        />
      );

    case "editor":
      return <MapEditor onDone={() => setScreen({ at: "board" })} />;

    case "replay":
      return <ReplayViewer onQuit={() => setScreen({ at: "landing" })} />;

    case "board": {
      const { vsAI } = screen;
      return (
        <BoardSelect
          onPick={(board, corruption) =>
            setScreen(
              vsAI
                ? { at: "opponent", board, corruption }
                : { at: "draft", board, corruption, player: 1, teams: {} },
            )
          }
          onEdit={() => setScreen({ at: "editor" })}
          onBack={() => setScreen({ at: "landing" })}
        />
      );
    }

    case "opponent":
      return (
        <Opponent
          onStart={({ agent, team }) =>
            setScreen({
              at: "deploy",
              board: screen.board,
              corruption: screen.corruption,
              // Both sides field the same set, so the game is about play (docs/arena.md).
              teams: { 1: team, 2: team },
              ai: agentByName(agent),
            })
          }
          onBack={() => setScreen({ at: "board", vsAI: true })}
        />
      );

    case "draft": {
      const { board, corruption, player, teams } = screen;
      return (
        <Draft
          key={player}
          player={player}
          onReady={(team) => {
            const next = { ...teams, [player]: team };
            setScreen(
              player === 1
                ? { at: "handoff", board, corruption, teams: next }
                : { at: "deploy", board, corruption, teams: next as Record<Owner, Team> },
            );
          }}
          onBack={() => setScreen({ at: "board" })}
        />
      );
    }

    case "handoff":
      return (
        <Handoff
          to={2}
          what="Build your set"
          onReady={() =>
            setScreen({
              at: "draft",
              board: screen.board,
              corruption: screen.corruption,
              player: 2,
              teams: screen.teams,
            })
          }
        />
      );

    case "deploy": {
      const { ai } = screen;
      // The agent deploys itself, by its own rule or the arena's default one.
      const theirs = ai
        ? chooseDeployment({ name: "you", choose: () => null }, ai, { board: screen.board, teams: screen.teams, corruption: screen.corruption }, Math.floor(Math.random() * 2 ** 31))
            .filter((d) => d.owner === AI_OWNER)
            .map((d, i) => ({ ...d, poolIndex: i }))
        : [];
      return (
        <Deploy
          board={screen.board}
          teams={screen.teams}
          opponent={ai ? { owner: AI_OWNER, placed: theirs, name: ai.name } : undefined}
          onDone={(placed: DeployPiece[]) =>
            setScreen({
              at: "game",
              board: screen.board,
              corruption: screen.corruption,
              ai,
              deployments: placed.map((p) => ({
                machineId: p.machineId,
                owner: p.owner,
                row: p.row,
                col: p.col,
                facing: p.facing,
              })),
            })
          }
          onBack={() => setScreen(ai ? { at: "opponent", board: screen.board, corruption: screen.corruption } : { at: "board" })}
        />
      );
    }

    case "game":
      return (
        <Game
          board={screen.board}
          corruption={screen.corruption}
          deployments={screen.deployments}
          initialState={screen.resume}
          ai={screen.ai ? { owner: AI_OWNER, agent: screen.ai } : undefined}
          onQuit={() => setScreen({ at: "landing" })}
        />
      );
  }
}
