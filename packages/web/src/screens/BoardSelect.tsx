import { useState } from "react";
import { Board } from "../board/Board";
import { parseBoard, type BoardFile } from "../board/terrain";
import { allBoards, deleteCustomBoard, isCustom } from "../data/boards";

type Props = {
  onPick: (board: BoardFile, corruption: boolean) => void;
  onEdit: () => void;
  onBack: () => void;
};

export function BoardSelect({ onPick, onEdit, onBack }: Props) {
  const [corruption, setCorruption] = useState(true);
  const [boards, setBoards] = useState<BoardFile[]>(() => allBoards());

  function remove(id: string) {
    deleteCustomBoard(id);
    setBoards(allBoards());
  }

  return (
    <div className="screen wide">
      <Steps active={1} />
      <h2 className="screen-title">Choose a board</h2>

      <div className="board-grid">
        {boards.map((b) => (
          <div key={b.id} className="board-tile">
            <button className="board-choice" onClick={() => onPick(b, corruption)}>
              <Board grid={parseBoard(b)} scale={32} />
              <div className="choice-text">
                <b>{b.name}</b>
                <span>{b.description}</span>
              </div>
            </button>
            {isCustom(b.id) && (
              <button className="remove-board" onClick={() => remove(b.id)} title="Delete this board">
                ×
              </button>
            )}
          </div>
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

      <div className="actions">
        <button onClick={onBack}>Back</button>
        <button onClick={onEdit}>Make a board</button>
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
