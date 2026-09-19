import type { Facing, Machine, MachineType, Side } from "@ms/engine";

/**
 * How a machine is drawn. This is the single source of truth for piece art —
 * the board, the draft, the deploy trays and the reference sheet all render it.
 *
 * Every colour has exactly one meaning:
 *
 *   gold / blue  →  which player owns it       (the whole body)
 *   white        →  an armoured side
 *   red          →  a weak side
 *   near-black   →  outline and type glyph
 *
 * The earlier placeholders broke that rule twice — blue meant both "armoured"
 * and "Player 2", and the amber front marker was exactly Player 1's colour — so
 * a spectator could not tell the sides apart.
 *
 * Facing is carried by the silhouette, not a colour: the body is a teardrop
 * whose point is the machine's front.
 *
 * The two sides also differ in LIGHTNESS, not just hue — Player 1 is a light
 * piece and Player 2 a dark one, the way chess does it. Hue alone failed: in
 * greyscale the first version's two sides were indistinguishable, which means a
 * colour-blind spectator would have had the same problem the user reported.
 */

export const TEAM = {
  1: { name: "gold", body: "#ffc53d", rim: "#7a4f00", core: "#fff1c9", ui: "#ffc53d" },
  2: { name: "blue", body: "#0d2d63", rim: "#4a9dff", core: "#4a9dff", ui: "#4a9dff" },
} as const;
const NEUTRAL = { body: "#c6ced8", rim: "#56616e", core: "#eef2f6" };

export const INK = "#0b0e13";
export const ARMOUR = "#f5f8fb";
export const WEAK = "#ff3b3b";

const ANGLE: Record<Facing, number> = { N: 0, E: 90, S: 180, W: 270 };

// Teardrop: a circle of radius 12.4 about (16,17), drawn to a point at (16,2.2).
// Rotating about the circle's centre keeps the point inside the 32×32 box in
// every direction, so a machine never gets clipped when it turns.
const BODY =
  "M16 2.2 L22.77 6.61 A12.4 12.4 0 1 1 9.23 6.61 Z";

// Side plates, in the machine's own frame (front is up).
const PLATES: Record<Side, { x: number; y: number; w: number; h: number }> = {
  F: { x: 11, y: 8.4, w: 10, h: 2.4 },
  B: { x: 11, y: 23.2, w: 10, h: 2.4 },
  L: { x: 7.4, y: 12, w: 2.4, h: 10 },
  R: { x: 22.2, y: 12, w: 2.4, h: 10 },
};

const GLYPH: Record<MachineType, string> = {
  Melee: "M16 13.4 L19.6 17 L16 20.6 L12.4 17 Z",
  Gunner: "", // drawn as circles below
  Ram: "M16 13.4 L20.3 18.5 L18.1 18.5 L16 16 L13.9 18.5 L11.7 18.5 Z",
  Dash:
    "M16 12.9 L19.7 16.8 L17.9 16.8 L16 14.8 L14.1 16.8 L12.3 16.8 Z " +
    "M16 16.7 L19.7 20.6 L17.9 20.6 L16 18.6 L14.1 20.6 L12.3 20.6 Z",
  Swoop: "M16 13.1 L20.4 20.6 L16 18.3 L11.6 20.6 Z",
  Pull: "M16 20.6 L11.7 15.5 L13.9 15.5 L16 18 L18.1 15.5 L20.3 15.5 Z",
};

type Props = {
  machine: Machine;
  /** Omit for an unowned piece, e.g. in reference material. */
  owner?: 1 | 2;
  facing?: Facing;
  className?: string;
  title?: string;
};

export function PieceToken({ machine, owner, facing = "N", className, title }: Props) {
  const team = owner ? TEAM[owner] : NEUTRAL;
  const sideColour = (s: Side) =>
    machine.armor.includes(s) ? ARMOUR : machine.weak.includes(s) ? WEAK : null;

  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      role="img"
      aria-label={title ?? `${machine.name}${owner ? `, Player ${owner}` : ""}`}
      overflow="visible"
    >
      <g transform={`rotate(${ANGLE[facing]} 16 17)`}>
        {/* A dark outline first, so the piece separates from any terrain. */}
        <path d={BODY} fill={INK} stroke={INK} strokeWidth={2.6} strokeLinejoin="round" />
        {/* The team: the largest area on the piece, light for P1 and dark for P2. */}
        <path d={BODY} fill={team.body} stroke={team.rim} strokeWidth={1.5} strokeLinejoin="round" />

        {(Object.keys(PLATES) as Side[]).map((s) => {
          const colour = sideColour(s);
          if (!colour) return null;
          const p = PLATES[s];
          return (
            <rect key={s} x={p.x} y={p.y} width={p.w} height={p.h} rx={0.9}
              fill={colour} stroke={INK} strokeWidth={0.9} />
          );
        })}

        <rect x={11} y={12} width={10} height={10} rx={2}
          fill={team.core} stroke={INK} strokeWidth={0.8} />

        {machine.type === "Gunner" ? (
          <>
            <circle cx={16} cy={17} r={3.3} fill="none" stroke={INK} strokeWidth={1.5} />
            <circle cx={16} cy={17} r={1.1} fill={INK} />
          </>
        ) : (
          <path d={GLYPH[machine.type]} fill={INK} />
        )}
      </g>
    </svg>
  );
}
