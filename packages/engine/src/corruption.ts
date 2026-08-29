import type { Owner } from "./types";

/**
 * The blight's spread order is fixed and independent of play, so the whole
 * corruption state is two counters over these precomputed permutations
 * (rules 2.5).
 *
 * Each player has their own front. It starts on the row closest to that player
 * and advances inward, filling each row serpentine: the first row right to
 * left *from that player's own point of view*, the next left to right, and so
 * on. P1 sits at the bottom facing north, so their right is the high columns;
 * P2 sits at the top facing south, so their right is the low columns.
 *
 * Each front consumes exactly half the board, so the two meet in the middle
 * and never overlap — no skip logic is needed.
 */
export function corruptionOrder(size: number, owner: Owner): [number, number][] {
  const rows =
    owner === 1
      ? Array.from({ length: size / 2 }, (_, i) => size - 1 - i) // 7,6,5,4
      : Array.from({ length: size / 2 }, (_, i) => i); // 0,1,2,3

  return rows.flatMap((r, idx) => {
    const startsHighColumn = owner === 1;
    const highToLow = idx % 2 === 0 ? startsHighColumn : !startsHighColumn;
    const cols = Array.from({ length: size }, (_, i) => (highToLow ? size - 1 - i : i));
    return cols.map((c) => [r, c] as [number, number]);
  });
}

export type Corruption = {
  enabled: boolean;
  /** Tiles corrupted so far, per front. */
  fronts: Record<Owner, number>;
};

export function corruptedTiles(size: number, c: Corruption): Set<string> {
  const set = new Set<string>();
  if (!c.enabled) return set;
  for (const owner of [1, 2] as Owner[]) {
    const order = corruptionOrder(size, owner);
    for (let i = 0; i < c.fronts[owner]; i++) set.add(`${order[i][0]},${order[i][1]}`);
  }
  return set;
}

export const blightTotal = (size: number) => size * size;
export const blightDone = (size: number, c: Corruption) =>
  c.enabled && c.fronts[1] + c.fronts[2] >= blightTotal(size);

/** The next tile this player's front will take, or null when their half is full. */
export function nextTileFor(size: number, c: Corruption, owner: Owner): [number, number] | null {
  const order = corruptionOrder(size, owner);
  return c.fronts[owner] < order.length ? order[c.fronts[owner]] : null;
}
