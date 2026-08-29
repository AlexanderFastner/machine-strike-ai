import { MACHINE_BY_ID, SKILL_TEXT, SPRITE, type GameState, type Piece } from "../data/machines";
import { TERRAIN } from "../board/terrain";
import { combatPowerOf, isCorrupted } from "../data/machines";

const SIDES = [
  { key: "F", label: "Front" },
  { key: "B", label: "Back" },
  { key: "L", label: "Left" },
  { key: "R", label: "Right" },
] as const;

/** Everything about the selected machine, so a player never has to guess. */
export function PieceCard({ state, piece }: { state: GameState; piece: Piece }) {
  const m = MACHINE_BY_ID[piece.machineId];
  const blighted = isCorrupted(state, piece.row, piece.col);
  const terrain = TERRAIN[state.grid[piece.row][piece.col]];
  const cp = combatPowerOf(state, piece);
  const hpPct = Math.max(0, (piece.hp / m.health) * 100);

  return (
    <aside className="card-panel">
      <header className={`card-head who p${piece.owner}`}>
        <img src={SPRITE[m.id]} alt="" draggable={false} />
        <div>
          <b>{m.name}</b>
          <span>
            {m.type} · {m.rarity} · {m.points} pts
          </span>
        </div>
      </header>

      <div className="hp-bar" title={`${piece.hp} of ${m.health} health`}>
        <div className="hp-fill" style={{ width: `${hpPct}%` }} />
        <span>
          {piece.hp} / {m.health}
        </span>
      </div>

      <dl className="stat-grid">
        <div>
          <dt>Attack</dt>
          <dd>{m.attack}</dd>
        </div>
        <div>
          <dt>Range</dt>
          <dd>{m.range}</dd>
        </div>
        <div>
          <dt>Move</dt>
          <dd>{m.movement}</dd>
        </div>
        <div className="highlight">
          <dt>Combat Power</dt>
          <dd>{cp}</dd>
        </div>
      </dl>

      <div className="card-row">
        <span className="k">Standing on</span>
        <span className="v">
          {blighted ? "Corrupted" : terrain.name}{" "}
          <em>({(blighted ? -2 : terrain.modifier) >= 0 ? "+" : ""}{blighted ? -2 : terrain.modifier})</em>
        </span>
      </div>
      <div className="card-row">
        <span className="k">Facing</span>
        <span className="v">{{ N: "North", E: "East", S: "South", W: "West" }[piece.facing]}</span>
      </div>

      <div className="sides">
        <span className="k">Sides</span>
        <div className="side-chips">
          {SIDES.map(({ key, label }) => {
            const kind = m.armor.includes(key) ? "armor" : m.weak.includes(key) ? "weak" : "neutral";
            return (
              <span key={key} className={`chip ${kind}`} title={`${label}: ${kind}`}>
                {key}
              </span>
            );
          })}
        </div>
      </div>

      {m.skill && (
        <div className="skill-box">
          <b>{m.skill}</b>
          <span>{SKILL_TEXT[m.skill] ?? "—"}</span>
        </div>
      )}
    </aside>
  );
}
