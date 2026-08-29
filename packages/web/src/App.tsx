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
  | { at: "draft"; board: BoardFile; player: Owner; teams: Partial<Record<Owner, Team>> }
  | { at: "handoff"; board: BoardFile; teams: Partial<Record<Owner, Team>> }
  | { at: "deploy"; board: BoardFile; teams: Record<Owner, Team> }
  | { at: "game"; board: BoardFile; deployments: Deployment[] };

export function App() {
  const [screen, setScreen] = useState<Screen>({ at: "landing" });

  switch (screen.at) {
    case "landing":
      return <Landing onPlay={() => setScreen({ at: "board" })} />;

    case "board":
      return (
        <BoardSelect
          onPick={(board) => setScreen({ at: "draft", board, player: 1, teams: {} })}
          onBack={() => setScreen({ at: "landing" })}
        />
      );

    case "draft": {
      const { board, player, teams } = screen;
      return (
        <Draft
          key={player}
          player={player}
          onReady={(team) => {
            const next = { ...teams, [player]: team };
            setScreen(
              player === 1
                ? { at: "handoff", board, teams: next }
                : { at: "deploy", board, teams: next as Record<Owner, Team> },
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
            setScreen({ at: "draft", board: screen.board, player: 2, teams: screen.teams })
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
          deployments={screen.deployments}
          onQuit={() => setScreen({ at: "landing" })}
        />
      );
  }
}
