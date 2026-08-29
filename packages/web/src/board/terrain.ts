import chasm from "@assets/terrain/chasm.png";
import marsh from "@assets/terrain/water.png";
import grassland from "@assets/terrain/grass.png";
import forest from "@assets/terrain/forest.png";
import hill from "@assets/terrain/hills.png";
import mountain from "@assets/terrain/mountain.png";
import corrupt from "@assets/terrain/corrupt.png";

/** Terrain ladder, low to high. Index is the ladder position — skills step +/-1 along it. */
export const TERRAIN = {
  chasm:     { name: "Chasm",     modifier: -2, tile: chasm,     note: "flying only" },
  marsh:     { name: "Marsh",     modifier: -1, tile: marsh,     note: "entering ends movement" },
  grassland: { name: "Grassland", modifier:  0, tile: grassland, note: "" },
  forest:    { name: "Forest",    modifier: +1, tile: forest,    note: "" },
  hill:      { name: "Hill",      modifier: +2, tile: hill,      note: "" },
  mountain:  { name: "Mountain",  modifier: +3, tile: mountain,  note: "" },
} as const;

export type TerrainId = keyof typeof TERRAIN;

/** The blight is an overlay, not a ladder position: -2, and the terrain beneath stops mattering. */
export const CORRUPTION = { name: "Corrupted", modifier: -2, tile: corrupt } as const;

/** Single-letter codes used in the board files. */
export const LEGEND: Record<string, TerrainId> = {
  C: "chasm",
  W: "marsh",
  G: "grassland",
  F: "forest",
  H: "hill",
  M: "mountain",
};

export type BoardFile = {
  id: string;
  name: string;
  description: string;
  rows: string[];
};

/** Parse a board file's row strings into an 8x8 grid of terrain ids. */
export function parseBoard(file: BoardFile): TerrainId[][] {
  return file.rows.map((row, r) =>
    [...row].map((ch, c) => {
      const id = LEGEND[ch];
      if (!id) throw new Error(`Unknown terrain code '${ch}' at row ${r}, col ${c}`);
      return id;
    }),
  );
}
