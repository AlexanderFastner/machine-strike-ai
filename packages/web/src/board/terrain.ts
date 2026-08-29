import chasm from "@assets/terrain/chasm.png";
import marsh from "@assets/terrain/water.png";
import grassland from "@assets/terrain/grass.png";
import forest from "@assets/terrain/forest.png";
import hill from "@assets/terrain/hills.png";
import mountain from "@assets/terrain/mountain.png";
import corrupt from "@assets/terrain/corrupt.png";
import { TERRAIN_MOD, TERRAIN_IDS, type TerrainId } from "@engine";

export { TERRAIN_IDS, type TerrainId };
export { parseBoard, type BoardFile } from "@engine";

export const CORRUPT_TILE = corrupt;

const ART: Record<TerrainId, string> = { chasm, marsh, grassland, forest, hill, mountain };

const NOTE: Partial<Record<TerrainId, string>> = {
  chasm: "flying only",
  marsh: "entering ends movement",
};

/** Display data for a terrain: art, label and the modifier from the engine. */
export const TERRAIN = Object.fromEntries(
  TERRAIN_IDS.map((id) => [
    id,
    {
      name: id[0].toUpperCase() + id.slice(1),
      modifier: TERRAIN_MOD[id],
      tile: ART[id],
      note: NOTE[id] ?? "",
    },
  ]),
) as Record<TerrainId, { name: string; modifier: number; tile: string; note: string }>;
