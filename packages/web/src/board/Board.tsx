import type { CSSProperties } from "react";
import { TERRAIN, CORRUPT_TILE, type TerrainId } from "./terrain";
import { MACHINE_BY_ID, SPRITE } from "../data/machines";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

/** Facing is 4-directional. Sprites are drawn facing north, so this is a rotation. */
export type Facing = "N" | "E" | "S" | "W";
const ROTATION: Record<Facing, number> = { N: 0, E: 90, S: 180, W: 270 };

export type PlacedPiece = {
  machineId: string;
  row: number;
  col: number;
  facing: Facing;
  owner: 1 | 2;
  /** Index into the owner's drafted set, so a placed piece can be picked back up. */
  poolIndex?: number;
  uid?: number;
  hp?: number;
};

type Props = {
  grid: TerrainId[][];
  scale?: 32 | 64 | 96;
  pieces?: PlacedPiece[];
  /** Tiles to mark as valid targets. */
  highlight?: (row: number, col: number) => boolean;
  onTileClick?: (row: number, col: number) => void;
  selectedUid?: number;
  /** Keys "row,col" of blighted tiles. */
  corrupted?: Set<string>;
  /** Combat Power to show under each piece. */
  powerOf?: (piece: PlacedPiece) => number;
  /** Predicted damage per piece uid, for the attack preview. */
  preview?: Map<number, { damage: number; lethal: boolean }>;
};

export function Board({
  grid,
  scale = 64,
  pieces = [],
  highlight,
  onTileClick,
  selectedUid,
  corrupted,
  powerOf,
  preview,
}: Props) {
  const size = grid.length;
  const at = new Map(pieces.map((p) => [`${p.row}-${p.col}`, p]));

  return (
    <div className="board-wrap" style={{ "--tile": `${scale}px` } as CSSProperties}>
      <div className="ranks">
        {grid.map((_, r) => (
          <span key={r}>{size - r}</span>
        ))}
      </div>

      <div className="board" role="grid" aria-label="Machine Strike board">
        {grid.map((row, r) =>
          row.map((id, c) => {
            const t = TERRAIN[id];
            const piece = at.get(`${r}-${c}`);
            const lit = highlight?.(r, c) ?? false;
            const blighted = corrupted?.has(`${r},${c}`) ?? false;
            const coord = `${FILES[c]}${size - r}`;
            const machine = piece && MACHINE_BY_ID[piece.machineId];

            return (
              <div
                key={`${r}-${c}`}
                className={`tile${lit ? " lit" : ""}${onTileClick ? " clickable" : ""}`}
                role="gridcell"
                aria-label={`${coord}, ${t.name}${machine ? `, ${machine.name}` : ""}`}
                title={
                  (machine ? `${machine.name} · ` : "") +
                  (blighted ? `${coord} · Corrupted (-2)` : `${coord} · ${t.name} (${t.modifier >= 0 ? "+" : ""}${t.modifier})`)
                }
                onClick={onTileClick ? () => onTileClick(r, c) : undefined}
              >
                <img className="terrain" src={t.tile} alt="" draggable={false} />
                {blighted && <img className="terrain blight" src={CORRUPT_TILE} alt="" draggable={false} />}
                {piece && machine && (
                  <img
                    className={`piece p${piece.owner}${piece.uid === selectedUid ? " selected" : ""}`}
                    src={SPRITE[piece.machineId]}
                    alt={machine.name}
                    draggable={false}
                    style={{ transform: `rotate(${ROTATION[piece.facing]}deg)` }}
                  />
                )}
                {piece && machine && piece.hp !== undefined && (
                  <span className={`hp p${piece.owner}`}>{piece.hp}</span>
                )}
                {piece && machine && powerOf && (
                  <span className="power" title="Combat Power from this tile">
                    {powerOf(piece)}
                  </span>
                )}
                {piece && preview?.has(piece.uid!) && (
                  <span className={`dmg${preview.get(piece.uid!)!.lethal ? " lethal" : ""}`}>
                    −{preview.get(piece.uid!)!.damage}
                  </span>
                )}
              </div>
            );
          }),
        )}
      </div>

      <div className="files">
        {FILES.slice(0, size).map((f) => (
          <span key={f}>{f}</span>
        ))}
      </div>
    </div>
  );
}

export function TerrainLegend() {
  return (
    <div className="legend">
      {(Object.keys(TERRAIN) as TerrainId[]).map((id) => {
        const t = TERRAIN[id];
        return (
          <div key={id} className="legend-item">
            <img src={t.tile} alt="" draggable={false} />
            <div>
              <b>{t.name}</b>
              <span className={t.modifier === 0 ? "mod zero" : t.modifier > 0 ? "mod up" : "mod down"}>
                {t.modifier >= 0 ? "+" : ""}
                {t.modifier}
              </span>
              {t.note && <em>{t.note}</em>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
