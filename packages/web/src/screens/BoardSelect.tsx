import flat from "@data/boards/flat.json";
import { Board } from "../board/Board";
import { parseBoard, type BoardFile } from "../board/terrain";

const BOARDS: BoardFile[] = [flat as BoardFile];

type Props = { onPick: (board: BoardFile) => void; onBack: () => void };

export function BoardSelect({ onPick, onBack }: Props) {
  return (
    <div className="screen">
      <Steps active={1} />
      <h2 className="screen-title">Choose a board</h2>

      <div className="board-choices">
        {BOARDS.map((b) => (
          <button key={b.id} className="board-choice" onClick={() => onPick(b)}>
            <Board grid={parseBoard(b)} scale={32} />
            <div className="choice-text">
              <b>{b.name}</b>
              <span>{b.description}</span>
            </div>
          </button>
        ))}
      </div>

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
