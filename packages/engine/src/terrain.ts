/** Terrain ladder, low to high. The ordering is mechanically real: skills step +/-1 along it. */
export const TERRAIN_IDS = ["chasm", "marsh", "grassland", "forest", "hill", "mountain"] as const;
export type TerrainId = (typeof TERRAIN_IDS)[number];

export const TERRAIN_MOD: Record<TerrainId, number> = {
  chasm: -2,
  marsh: -1,
  grassland: 0,
  forest: +1,
  hill: +2,
  mountain: +3,
};

/** The blight is an overlay: -2, and the terrain beneath stops mattering for everything. */
export const CORRUPTION_MOD = -2;

/** Single-letter codes used in board files. */
export const LEGEND: Record<string, TerrainId> = {
  C: "chasm",
  W: "marsh",
  G: "grassland",
  F: "forest",
  H: "hill",
  M: "mountain",
};

export type BoardFile = { id: string; name: string; description: string; rows: string[] };

export function parseBoard(file: BoardFile): TerrainId[][] {
  return file.rows.map((row, r) =>
    [...row].map((ch, c) => {
      const id = LEGEND[ch];
      if (!id) throw new Error(`Unknown terrain code '${ch}' at row ${r}, col ${c}`);
      return id;
    }),
  );
}

/** Entering ends movement (rules 4.4). Corruption does the same, handled separately. */
export const stopsMovement = (t: TerrainId) => t === "marsh";

/** Only flying pieces may enter (rules 2.6). */
export const flyingOnly = (t: TerrainId) => t === "chasm";
