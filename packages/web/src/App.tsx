import { useState } from "react";
import { Landing } from "./screens/Landing";
import { BoardSelect } from "./screens/BoardSelect";
import { Draft } from "./screens/Draft";
import { Deploy } from "./screens/Deploy";
import type { BoardFile } from "./board/terrain";
import type { Team } from "./data/machines";

type Screen =
  | { at: "landing" }
  | { at: "board" }
  | { at: "draft"; board: BoardFile }
  | { at: "deploy"; board: BoardFile; team: Team };

export function App() {
  const [screen, setScreen] = useState<Screen>({ at: "landing" });

  switch (screen.at) {
    case "landing":
      return <Landing onPlay={() => setScreen({ at: "board" })} />;

    case "board":
      return (
        <BoardSelect
          onPick={(board) => setScreen({ at: "draft", board })}
          onBack={() => setScreen({ at: "landing" })}
        />
      );

    case "draft":
      return (
        <Draft
          onReady={(team) => setScreen({ at: "deploy", board: screen.board, team })}
          onBack={() => setScreen({ at: "board" })}
        />
      );

    case "deploy":
      return (
        <Deploy
          board={screen.board}
          team={screen.team}
          onBack={() => setScreen({ at: "draft", board: screen.board })}
        />
      );
  }
}
