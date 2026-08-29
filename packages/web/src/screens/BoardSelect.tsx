import { useState } from "react";
import flat from "@data/boards/flat.json";
import { Board } from "../board/Board";
import { parseBoard, type BoardFile } from "../board/terrain";

const BOARDS: BoardFile[] = [flat as BoardFile];

type Props = { onPick: (board: BoardFile, corruption: boolean) => void; onBack: () => void };

export function BoardSelect({ onPick, onBack }: Props) {
  const [corruption, setCorruption] = useState(true);

  return (
    <div className="screen">
      <Steps active={1} />
      <h2 className="screen-title">Choose a board</h2>

      <div className="board-choices">
        {BOARDS.map((b) => (
          <button key={b.id} className="board-choice" onClick={() => onPick(b, corruption)}>
            <Board grid={parseBoard(b)} scale={32} />
            <div className="choice-text">
              <b>{b.name}</b>
              <span>{b.description}</span>
            </div>
          </button>
        ))}
      </div>

      <label className="option">
        <input
          type="checkbox"
          checked={corruption}
          onChange={(e) => setCorruption(e.target.checked)}
        />
        <span>
          <b>Corruption</b>
          <em>
            {corruption
              ? "The blight creeps in from both sides, one tile per turn. Standing in it costs 2 health a round, and the game ends when it covers the board — about 32 rounds."
              : "No blight. The game instead ends after a fixed 50 rounds, with the higher victory-point total winning."}
          </em>
        </span>
      </label>

      <p className="footnote">
        More boards, and a symmetric random generator, come later — the board format is already a plain
        terrain grid, so adding them needs no format change.
      </p>

      <div className="actions">
        <button onClick={onBack}>Back</button>
      </div>
    </div>
  );
}

export function Steps({ active }: { active: 1 | 2 | 3 }) {
  const labels = ["Board", "Set", "Deploy"];
  return (
    <ol className="steps">
      {labels.map((l, i) => (
        <li key={l} className={i + 1 === active ? "on" : i + 1 < active ? "done" : ""}>
          <span>{i + 1}</span>
          {l}
        </li>
      ))}
    </ol>
  );
}
