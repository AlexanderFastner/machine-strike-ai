import { useState } from "react";
import { Landing } from "./screens/Landing";
import { BoardSelect } from "./screens/BoardSelect";
import { Draft } from "./screens/Draft";
import { Handoff } from "./screens/Handoff";
import { Deploy, type DeployPiece } from "./screens/Deploy";
import { Game } from "./screens/Game";
import type { BoardFile } from "./board/terrain";
import type { Deployment, Owner, Team } from "./data/machines";

type Screen =
  | { at: "landing" }
  | { at: "board" }
  | { at: "draft"; board: BoardFile; corruption: boolean; player: Owner; teams: Partial<Record<Owner, Team>> }
  | { at: "handoff"; board: BoardFile; corruption: boolean; teams: Partial<Record<Owner, Team>> }
  | { at: "deploy"; board: BoardFile; corruption: boolean; teams: Record<Owner, Team> }
  | { at: "game"; board: BoardFile; corruption: boolean; deployments: Deployment[] };

export function App() {
  const [screen, setScreen] = useState<Screen>({ at: "landing" });

  switch (screen.at) {
    case "landing":
      return <Landing onPlay={() => setScreen({ at: "board" })} />;

    case "board":
      return (
        <BoardSelect
          onPick={(board, corruption) =>
            setScreen({ at: "draft", board, corruption, player: 1, teams: {} })
          }
          onBack={() => setScreen({ at: "landing" })}
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

    case "deploy":
      return (
        <Deploy
          board={screen.board}
          teams={screen.teams}
          onDone={(placed: DeployPiece[]) =>
            setScreen({
              at: "game",
              board: screen.board,
              corruption: screen.corruption,
              deployments: placed.map((p) => ({
                machineId: p.machineId,
                owner: p.owner,
                row: p.row,
                col: p.col,
                facing: p.facing,
              })),
            })
          }
          onBack={() => setScreen({ at: "board" })}
        />
      );

    case "game":
      return (
        <Game
          board={screen.board}
          corruption={screen.corruption}
          deployments={screen.deployments}
          onQuit={() => setScreen({ at: "landing" })}
        />
      );
  }
}
