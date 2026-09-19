import type { GameState } from "./types";

/**
 * A short fingerprint of everything that affects play: pieces, terrain, blight,
 * score, whose turn it is. Two states with the same checksum play identically.
 *
 * The log is deliberately excluded — it is narration, not state — so a change
 * to wording never looks like a change to the game.
 *
 * Used to prove a replay re-executes exactly: record a game in one runtime,
 * rebuild it in another, and compare fingerprints step by step.
 */
export function checksum(s: GameState): string {
  const canonical = JSON.stringify({
    turn: s.turn,
    round: s.round,
    turnNumber: s.turnNumber,
    activationsLeft: s.activationsLeft,
    activated: [...s.activated].sort((a, b) => a - b),
    vp: [s.vp[1], s.vp[2]],
    winner: s.winner,
    corruption: [s.corruption.enabled, s.corruption.fronts[1], s.corruption.fronts[2]],
    grid: s.grid.map((row) => row.join(",")).join("/"),
    pieces: [...s.pieces]
      .sort((a, b) => a.uid - b.uid)
      .map((p) => [p.uid, p.machineId, p.owner, p.row, p.col, p.facing, p.hp, p.attackMod]),
  });
  // FNV-1a, 32-bit: tiny, fast, and identical in every JS runtime.
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
