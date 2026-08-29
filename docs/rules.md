# Machine Strike — Rules Specification

**This document is the authority the engine implements.** Not the wiki, not memory, not any other
implementation. Where the real game is unknown, that is marked and a house rule is chosen so the engine is
always fully specified.

## Status legend

| Mark | Meaning |
|---|---|
| **[C]** | **Confirmed** — verified from play or settled by the project owner. Implement as written. |
| **[H]** | **House rule** — the real game may differ, or doesn't specify. Deliberate choice, implement as written. |
| **[?]** | **Open** — not yet known. **Engine must not be written against these until resolved.** |

Every **[?]** is repeated in [§13 Open Questions](#13-open-questions) as a single checklist — the Phase 0 to-do
list.

---

## 1. Overview

Machine Strike is a two-player, **deterministic, perfect-information** board game — no dice, no hidden
information, no simultaneous decisions. Both players see the entire state at all times, and any action's result
is fully determined by the state it is applied to.

Each player fields a set of pieces representing machines, drafted to a fixed point budget, and wins by
destroying enough of the opponent's pieces before the **blight** consumes the board.

---

## 2. Board and terrain

### 2.1 Board

- **[C]** The board is an **8×8 grid** of tiles.
- **[C]** Each tile holds **at most one piece**.
- **[C]** Each tile has exactly one **base terrain type** from §2.2, plus a **corruption overlay** flag (§2.5).

**[C] For now: one flat test board.** `packages/data/boards/flat.json` is 8×8 all-grassland — every terrain
modifier is 0, so combat maths is unmodified and any wrong number in a test is a bug in the formula rather than
in the terrain. Build against this first.

**Deferred until the game is playable:**

1. **Board library** — authored, fixed layouts in `packages/data/boards/`, each a named 8×8 terrain grid.
   Mirrors how the real game ships a distinct board per opponent.
2. **Random mirrored generator** — procedurally generated boards that are **symmetric, so neither side has an
   advantage**.

Both are cheap to add later *provided* the board format stays a plain, hand-editable terrain grid — which is why
`flat.json` already uses the full legend and row format rather than a special case.

**[C] Symmetry for generated boards, when built: 180° rotational symmetry**, i.e. `tile(r, c) == tile(7−r, 7−c)`.

> Why rotation and not reflection: with players deployed on opposite back rows, a reflection across the
> horizontal midline gives each player the same terrain *ahead* of them, but **mirrored handedness** — what sits
> on one player's left sits on the other's right. Rotational symmetry makes each player's view of the board
> identical *including* left/right, which is the stricter fairness property. On an even-sized board no tile maps
> to itself, so there is no center tile needing special handling.
>
> This also interacts with corruption (§2.5): the two blight fronts advance from opposite edges, and rotational
> symmetry keeps them symmetric too.

- **[?]** Generator constraints beyond symmetry: how much of each terrain type, chasm placement rules, whether
  the deployment rows are guaranteed passable. A purely random terrain assignment will produce unplayable
  boards — this needs authored constraints, not just a symmetry filter.
- **[H]** Until tuned: terrain sampled from a fixed distribution, chasms capped, deployment rows restricted to
  non-chasm terrain, generated for one half and rotated into the other.

> **TODO (future) — map editor and generator controls.** Two features to build once the game is playable:
> 1. A **map editor** letting a player author their own board tile by tile and save it into the library.
> 2. **Generator controls** — roll a random map, and optionally specify **how many tiles of each terrain type**
>    it should contain, rather than accepting a fixed distribution.
>
> Neither is needed for the hot-seat milestone. Both are cheap once the board format and the symmetry
> constraint exist, which is why the format should be a plain, hand-editable terrain grid from the start.

### 2.2 Terrain types

Terrain modifies **Combat Power** (§6). Listed low to high — this **ladder ordering is mechanically real**, not
just presentational: several skills move a tile one step along it (§2.4).

| # | Terrain | Asset | Modifier | Additional effect | Status |
|---|---|---|---|---|---|
| 0 | Chasm | `chasm.png` | **−2** | Only **flying** pieces may enter (§2.6) | **[C]** |
| 1 | Marsh | `water.png` | **−1** | Entering **ends movement** (§4.4) | **[C]** |
| 2 | Grassland | `grass.png` | **0** | — | **[C]** |
| 3 | Forest | `forest.png` | **+1** | — | **[C]** |
| 4 | Hill | `hills.png` | **+2** | — | **[C]** |
| 5 | Mountain | `mountain.png` | **+3** | — | **[C]** |

**[C]** Terrain is **mutable** — skills change it during play, and corruption spreads across it. Terrain is game
state, not a static backdrop.

### 2.3 Terrain-altering skills

**[C]** Four skills change terrain. Every one moves a tile **exactly one step along the §2.2 ladder**. All four
fire **passively on attack** — none is a selected or activated ability, and none costs an action.

| Skill | Source gate | Effect | Tile affected | Step |
|---|---|---|---|---|
| **Burn** | Forest only | Forest → Grassland | **Target's** | −1 |
| **Freeze** | Marsh only | Marsh → Grassland | **Target's** | +1 |
| **Growth** | Grassland only | Grassland → Forest | **Target's** | +1 |
| **Alter Terrain** | **None — any terrain** | **Lowers** the attacker's own tile, **raises** the target's | **Both** | −1 / +1 |

**[C] Alter Terrain's range on the ladder is Marsh … Mountain.** It has a **floor at Marsh — it can never create
a Chasm** — and a ceiling at Mountain. Chasms exist only where a board author placed them.

- **[C]** `Burn`, `Freeze` and `Growth` are **gated on the source terrain** and do nothing otherwise. Burn only
  ever affects Forest; Freeze only Marsh; Growth only Grassland.
- **[C]** All three change the **target's** tile — the terrain under the machine being attacked, not the
  attacker's.
- **[C]** **`Alter Terrain` has no source gate** and applies to any terrain. It moves **two** tiles at once: the
  attacker's own tile down a step, the target's up a step. It may repeat across many attacks until each tile
  reaches its limit — **Marsh** at the low end, **Mountain** at the high end.
- **[C]** **`Alter Terrain` is deliberately not purely beneficial.** Lowering your own tile costs you Combat
  Power and raising the target's helps them; the skill exists to **push its owner to keep repositioning** rather
  than to sit and trade from one square. Implement it exactly as written — it is not an inverted description.

> The Marsh floor exists precisely to prevent the degenerate case: a machine cannot dig itself into a Chasm and
> create an illegal position under its own feet. The worst it can do is bog itself down to −1 and a movement
> stop (§4.4) — which is exactly the "keep repositioning" pressure the skill is for.

### 2.4 Terrain ladder implementation note

Because every terrain skill is a ±1 step with a source precondition, implement **one** primitive:

```ts
stepTerrain(tile, delta: +1 | -1, requireSource?: Terrain)
```

Do not write four independent special cases; `requireSource` is simply absent for `Alter Terrain`.

- **[C]** Steps **clamp — they never wrap.** Mountain is the ceiling and Marsh the floor; a step past either
  limit is a no-op, and a Mountain never rolls over into a Marsh.
- **[C]** **The floor for skill-driven changes is Marsh, not Chasm.** No skill can create a Chasm. The ceiling is
  Mountain. So `stepTerrain` operates on the sub-ladder **Marsh (1) … Mountain (5)**; Chasm (0) is authored-only
  terrain.

### 2.5 Corruption (the blight) — core mechanic

**[C] Corruption is a game option**, and when enabled it is the game's ending condition.

| Corruption | Game ends when |
|---|---|
| **On** (default) | The blight consumes the last tile — roughly **32 rounds** |
| **Off** | A fixed **50-round** limit is used instead (§9.3) |

Both modes must be supported, and both guarantee termination — which is what self-play needs. Corruption-off is
also the cleaner baseline for AI experiments, since it isolates the combat game from the shrinking-board
dynamic; expect to run agent ladders in both modes.

**Representation**
- **[C]** Corruption is its **own tile type with its own texture** (`corrupt.png`), but is **modeled as an
  overlay** on the base terrain, because it spreads over time and the underlying terrain still matters for
  layout and rendering.
- **[C]** **A corrupted tile counts only as a corrupted tile.** Its Combat Power modifier is **−2** and the
  terrain beneath it **no longer matters for any purpose** — not Combat Power, and not as a source type for the
  terrain-skill gates in §2.3. You cannot `Burn` a corrupted Forest, because it is no longer a Forest. The base
  type is retained for rendering only.
- The blight therefore flattens the board's terrain advantage as it spreads: a corrupted Mountain is as bad to
  stand on as a Chasm.

**Spread schedule**
- **[C]** From the **second turn onward**, at the **start of each player's turn**, **exactly one tile** becomes
  corrupted.
- **[C]** Each player has **their own blight front**, beginning on the **row closest to that player** and
  advancing inward.
- **[C]** Spread within a row is **serpentine**: the first row fills **right to left**; the next row fills
  **left to right**; the third **right to left** again, and so on.
- **[C]** "Right to left" is **from the perspective of the player whose front it is**.
- **[C]** When there is no terrain left for the blight to spread to, **the game ends** (§9.3).
- **[C]** **The two fronts never overlap.** Advancing one tile per player turn from opposite edges, they consume
  32 tiles each of the 64 and meet exactly in the middle. There is no case where one front jumps the other; when
  the last tile is blighted, the game is over. No skip logic is required.

> **Engine consequence — corruption is nearly free to store.** The spread order is *fixed and independent of
> play*: it is a precomputed permutation of tiles per side. The entire corruption state is therefore **two
> integers** (tiles corrupted per front), not a 64-tile bitmap. That keeps it cheap in the Zobrist hash and in
> make/unmake, and lets the NN derive the corruption plane from a counter.

**Effects on machines**
- **[C]** A machine that **lands on** corrupted terrain has its **further movement that turn restricted** —
  **[H]** movement ends immediately on entering. **This applies to all machines, including flying ones.**
- **[C]** At the start of **its owner's** turn, a machine standing on corrupted terrain **loses 2 Health** —
  **2 damage per round**, not 4. Corruption damage is scoped to the active player's own machines.
- **[C]** **Corruption deals no damage on the turn it spreads.** When the blight appears underneath one of your
  machines, that machine is not hurt immediately — you get that turn to move it out. Damage only applies to a
  machine that was *already* standing on corruption at the start of the turn. See the ordering in §5.2.
- **[C]** If a machine is destroyed by corruption, its **Victory Points are awarded to the opponent** of its
  owner.

### 2.6 Flying

- **[C]** **Flying is exactly the `Swoop` type** — Glinthawk, Skydrifter, Sunwing, Dreadwing, Stormbird.
- **[C]** Only flying pieces may enter a **Chasm**.
- **[C]** A flying piece **may end its movement on a Chasm**, and **does take the −2 Combat Power modifier**
  while standing there. It is a real positional tradeoff, not a free shortcut.
- **[C]** Flying does **not** permit passing over enemy pieces. It applies to chasms only.

---

## 3. Pieces

### 3.1 Stats

Every piece has **Type**, **Health**, **Attack**, **Range**, **Movement**, **Points**, an **armor/weak facing
layout**, and optionally one **Skill**.

Full roster: **[docs/pieces.md](pieces.md)** — 43 pieces, generated from
[`packages/data/machines.json`](../packages/data/machines.json).

> **[?] The roster is a wiki transcription, only partly verified.** Two errors have already been found and
> corrected against the in-game cards — **Scrounger** (health 4 → 5) and **Stormbird** (armor/weak were
> inverted: now armor F, weak B). Both are recorded in `machines.json`'s `_notes`.
>
> **[C] The other three armor-back/weak-front pieces are verified correct** — Glinthawk, Sunwing and Waterwing
> genuinely are armored behind and weak in front. Only Stormbird was inverted. The layout is real, and it is a
> nice piece of design: those machines want to be flown *past* a target and are punished for facing it head-on.

- **[C]** **Points** is one number serving two roles: the **setup cost** to field the piece, and the **victory
  points the opponent gains** when it is destroyed.
- **[C]** **Health** — at 0 or below the piece is destroyed and removed (§9.4).
- **[C]** **Attack** — the base value of its Combat Power (§6).
- **[C]** **Range** — how far a target may be, measured per §4.1.
- **[C]** **Movement** — how far the piece may move in one activation, per §4.1.

### 3.2 Facing and sides

- **[C]** Every piece faces one of **four** directions (§4.1).
- **[C]** Each side — **front (F), back (B), left (L), right (R)**, in the piece's own frame — is **armored**,
  **weak**, or **neutral**.
- **[C]** Attacking an **armored** side deals **reduced** damage and **can damage the attacker** (§6.4).
- **[C]** Attacking a **weak** side deals **increased** damage.
- **[C]** Ten distinct layouts exist across the roster — see the end of [docs/pieces.md](pieces.md). Each is one
  required golden test.
- **[?]** The exact magnitude of the armor/weak modifier — see §6.3.

### 3.3 Machine types

**[C] Machine type is fully specified, and it is the most important single fact about a piece.** Type does not
set range or movement — it sets **how the attack resolves**: who gets hit, what happens to them, and where the
attacker ends up.

**[C] Targeting is derived, not chosen.** Every type picks its own target automatically from the piece's facing
and range. The player's decisions are **where to stand and which way to face** — never "whom to attack". This
supersedes the earlier note claiming target selection was a free choice.

| Type | n | Target selection | Effect |
|---|---|---|---|
| **Melee** | 14 | The **first machine** along its facing within range | Plain attack. Range >1 does **not** let it reach past a nearer machine. |
| **Gunner** | 8 | The machine at **exactly maximum range** | Cannot hit anything closer. A range-2 Gunner with an enemy adjacent **cannot shoot it**. |
| **Ram** | 5 | The **first machine** within range | Attacks, **knocks it back** (§7), then **advances into the tile it vacated**. |
| **Swoop** | 5 | The **first machine** within range | Attacks, then **moves next to it**. Flying (§2.6), plus terrain immunities — see §6.1. |
| **Pull** | 6 | The **first enemy** within range | Attacks and **pulls it one tile closer**. Marsh specialist — see §6.1 and §4.4. |
| **Dash** | 5 | **Every machine in its path** | Moves to the **end of its attack range**, damaging everything it passes through **including its own pieces**, then **rotates each of them 180°**. Requires an **empty tile to land on**, or it cannot attack at all. |

**Consequences worth noting:**

- **Gunner's minimum range equals its maximum.** It is a piece that must be kept at a precise distance, and it
  is helpless against anything that closes. This is the missing Melee/Gunner distinction.
- **Melee's range is a reach limit, not a choice of target.** A range-2 Melee cannot shoot past an adjacent
  machine to hit a juicier one behind it.
- **Ram and Swoop both reposition the attacker**, so attacking changes where you stand — the activation's final
  facing and tile are consequences of the attack, not free choices.
- **Dash is the one source of friendly fire in the game** (§6.4), and it is deliberate: it damages and rotates
  *your* machines standing in its lane as readily as the enemy's.
- **Dash requires an empty landing tile.** A blocked lane makes the attack simply illegal — a real positional
  counter to it.

Open details:

- **[C]** **Your own pieces count as "the first machine" and block the attack.** You cannot strike through your
  own line. Friendly pieces screen the enemy from your Melee, Ram and Swoop — so a crowded formation gets in its
  own way, and body-blocking is a real defensive tool.
- **[?]** `Pull` is described as targeting the first **enemy** rather than the first machine. Is that a genuine
  exception — a Pull reaching past its own pieces — or just loose phrasing? **[H]** Loose phrasing: friendly
  pieces block for every type.
- **[?]** Does `Swoop` choose **which adjacent tile** to land on after attacking, or is it determined?
- **[?]** What does `Dash` do to a machine it passes through that would be **rotated into** an illegal state?
  Rotation has no legality constraints, so probably nothing — confirm.
- **[?]** Does `Dash` damage each machine in its lane by the normal §6.2 formula, computed per target?

---

## 4. Movement

### 4.1 Geometry, range and attack shapes

- **[C]** Movement and facing are **4-directional only** — north, south, east, west. No diagonals.
- **[C]** Movement distance is **Manhattan distance along legal paths**.
- **[C]** **Range is generally measured in a straight line** — a cardinal ray out from the attacker, not path
  distance around corners.

- **[C]** **Targeting is derived from the machine's type, facing and range** (§3.3) — the player never picks a
  target. The choice is where to stand and which way to face.

> **[C] But at least one attack is a shape, not a ray.** A swooping attack exists that hits a **1×3 area
> directly in front of the attacker** — three tiles abreast — putting two target tiles **diagonal** to it even
> though movement is strictly orthogonal. With the six machine types now fully specified as ray-based (§3.3),
> this must come from a **skill** rather than a type — `Sweep` is the strong candidate (§10.2).

**Engine consequence — model attacks as patterns, not as a distance check.** An attack is a **set of tile
offsets in the piece's own frame**, rotated by the piece's facing:

```ts
type AttackPattern = { offsets: Offset[]; mode: "single" | "all" }
```

A range-1 melee strike, a range-2 Gunner shot, a Dash lane and a 1×3 frontal sweep are then the same mechanism
with different data plus a per-type selection rule. Writing range as `manhattan(a, b) <= piece.range` produces a
move generator that cannot express the game, and it is expensive to unpick once a search sits on top of it.

- **[?]** **Which pieces have non-linear patterns, and what is each shape?** The 1×3 frontal attack is very
  likely the `Sweep` skill — Stormbird carries `Sweep`, and its three fellow `Sweep` users (Thunderjaw,
  Tremortusk, Ravager) are large machines a wide swing suits. Confirm, and map every shape.
- **[?]** For a multi-tile pattern, does it hit **every** piece in the area, friendlies included, the way `Dash`
  does?

### 4.2 Blocking

- **[C]** **A piece may move *through* its own pieces.** Friendly pieces do not block movement.
- **[C]** A piece may **not end its movement** on an occupied tile — one piece per tile (§2.1).
- **[C]** **Enemy pieces block movement.** Only friendly pieces may be passed through.
- **[C]** Movement is therefore a **breadth-first search** over tiles that are passable (terrain) and not
  occupied by an enemy — not a distance formula.
- **[C]** Flying does **not** help here — no piece may pass through an enemy (§2.6).

### 4.3 Rotation

- **[C]** **Rotation is free** — changing facing costs no movement, and a piece may rotate as many times as it
  likes during its activation.
- **[C]** **Attacking locks the facing.** The rotation you attack from is final: once the attack resolves you
  may not rotate again. Combined with §5.4 (an attack ends the activation), facing at the moment of attack is
  the facing you are left presenting to the enemy — which is the central defensive decision in the game.
- **[C]** **Rotating in place is not, by itself, a legal activation.** A piece may not end its activation on the
  same tile with nothing but a facing change; the activation must either **change tile** or **attack** (§5.3).

> **[?] Two statements about this conflict and need one observation to settle.** "You can take a turn simply to
> rotate and stay in place" versus "you cannot rotate in place and end your turn on the same tile unless you are
> attacking." The second was given as a correction, so it is what the engine implements — but if rotate-in-place
> *is* legal, that is a meaningful tactical option (spend an activation to present armor) and it changes the
> action space, so it is worth being sure.

### 4.4 Movement-stopping terrain

- **[C]** **Marsh impedes movement on landing in it** — entering a Marsh tile **ends that piece's movement for
  the turn**. It is not a cost; it is a stop.
- **[C]** **Corrupted terrain does the same** (§2.5), for **all** machines including flyers.
- **[C]** Entering always ends movement — a piece cannot pass through and keep going.
- **[C]** **`Pull` machines are exempt.** They traverse Marsh without their movement being hindered (§6.1) —
  they are the game's marsh specialists, and also gain +1 Combat Power while standing in it.
- **[?]** Is any *other* piece or skill exempt — `Climb` (Lancehorn) is a candidate — and does any exemption
  extend to corruption? **[H]** No: corruption stops **all** machines (§2.5), Pull included.

### 4.5 Sprint

- **[C]** A piece may **sprint** — move beyond its normal Movement — but then **cannot attack**, unless it
  overcharges (§5.4).
- **[C]** **Sprint extends movement by exactly 1 tile.** Sprint range = **Movement + 1**.

---

## 5. Turn structure

### 5.1 Rounds

- **[C]** Players alternate turns. A **round is one full turn cycle** — both players having taken a turn.
- **[C]** **There is no fixed turn limit.** The game ends when the blight consumes the board (§2.5, §9.3).
  Because corruption advances one tile per player turn and never reverses, the game is **guaranteed to
  terminate** in roughly 32 rounds — which is what self-play training requires.
- **[C]** **First player is a game option.** For now it is fixed: **Player 1 always goes first.** Build it as a
  setting so alternatives (deployment-order based, alternating across a match) can be tested later — first-player
  advantage is exactly the sort of thing the arena should measure once agents exist.

### 5.2 Start-of-turn sequence

**[C]** At the start of each player's turn, in this order:

1. **Corruption damage** — the active player's machines standing on **already-corrupted** tiles lose 2 Health.
2. **Corruption spreads** — one new tile becomes corrupted (from turn 2 onward, §2.5).
3. **Skill triggers** — `Spray`, `Empower` and any other start-of-turn effects (§10).
4. Deaths are resolved and Victory Points awarded (§9.4).

**Damage before spread is the whole point of the ordering.** A tile corrupted this turn deals no damage this
turn, so a machine the blight appears under always gets one turn to walk out. Implementing it the other way
around silently makes corruption far more lethal.

- **[?]** Do `Spray` / `Empower` fire on **every** player's turn or only their owner's? See §10.1.

### 5.3 Activations

- **[C]** On your turn you take **two activations**.
- **[C]** They must be **two different pieces**.
- **[C]** **Exception — fewer than two pieces *able to act*.** If only one piece can act, whatever the reason
  (you have only one piece left, or the others are unable to), **that piece acts twice**. The rule is about
  pieces *able* to act, not pieces owned.
- **[C]** **A turn cannot be passed while any activation remains possible.** You must use every activation you
  legally can. There is no voluntary pass.
- **[C]** **A null activation is illegal** — a piece may not end its activation on the same tile in the same
  facing. Every activation must **change tile** or **attack** (§4.3).

### 5.4 A single activation

- **[C]** An activation is **moving and/or attacking** with one piece.
- **[C]** **The order is strictly move, then attack — and the attack ends the activation.** A piece cannot move
  after attacking, and cannot rotate after attacking (§4.3).
- **[?]** `Swoop` is reported to attack and *then* reposition next to its target (§3.3). If true that is a
  skill-driven exception to the ordering rule, not a general permission. Confirm.

### 5.5 Overcharge

- **[C]** **Overcharge sacrifices 2 Health** to buy either **one extra tile of movement** or **an extra
  attack**. It is a small, precise boost — not a whole second activation.
- **[C]** **A piece may only overcharge with 2 or more Health remaining.**
- **[C]** **The Health cost is paid *after* the action completes, not before.** A machine that would lose its
  last Health by overcharging still **carries out the attack in full first**, and is destroyed afterwards.
- **[C]** **Any Victory Points earned by that final attack are still awarded to the attacker.** A 2-Health
  machine can overcharge, kill an 5-point piece, score the 5 points, and die — and the points count.

> This "resolve the action, then apply the cost" ordering makes overcharge a genuine **sacrifice play**, and it
> interacts directly with the simultaneous-death rule in §9.4. The engine must apply overcharge cost in a
> distinct post-action step, and must check the victory condition *after* awarding the attacker's points.

- **[?]** Does overcharging consume the turn's **second activation**, or is it independent? Significant tempo
  question: if independent, a player effectively acts three times in a turn.
- **[?]** May a piece overcharge **more than once** in a single activation — paying 4 Health for two extra
  tiles?
- **[?]** Earlier notes described overcharge as "exhausting" the piece. Given the above, is there any lasting
  exhaustion state at all, or is the 2 Health the entire cost? **[H]** The 2 Health is the entire cost; no
  lasting exhaustion.
- **[?]** When a machine dies from its own overcharge cost, does the **opponent** receive its Victory Points?
  (By analogy with corruption deaths in §2.5, presumably yes.)

---

## 6. Combat

**[C] The damage formula is settled.** This section is no longer speculative — the two competing models
described in earlier drafts are resolved in favour of the comparative one, with a crucial refinement: **the
defender contributes no attack power of its own.**

### 6.1 Combat Power

| | Combat Power |
|---|---|
| **Attacker** | its **Attack stat** + the **terrain modifier** of the tile it stands on |
| **Defender** | the **terrain modifier of its tile only** — its Attack stat contributes **nothing** |

- **[C]** A defending machine is defended by **where it stands**, not by how hard it hits. A Slaughterspine
  (Attack 4) parked on Grassland defends exactly as well as a Burrower (Attack 2) on Grassland: both at 0.
- **[C]** **Facing modifies the defender's Combat Power:**
  - attacking an **armored** side → defender **+1 CP**
  - attacking a **weak** side → defender **−1 CP**
  - attacking a **neutral** side → no change

```
attackerCP = attacker.attack + terrain(attacker.tile) + typeModifier
defenderCP = terrain(defender.tile) + facingModifier      // +1 armored, -1 weak, 0 neutral
```

**[C] Two machine types modify their own Combat Power by terrain:**

| Type | Effect |
|---|---|
| **Swoop** | **+1 Combat Power on all terrains**, and **ignores all terrain penalties** — negative modifiers do not apply to it. |
| **Pull** | **+1 Combat Power while standing on Marsh** (and moves through Marsh unhindered, §4.4). |

- **[C]** Swoop's terrain contribution is **`max(0, terrain) + 1`** — penalties are zeroed out, bonuses from
  Hill and Mountain still count, and the +1 applies everywhere. A Swoop on a Mountain is still better placed
  than one in a Chasm.
- **[?]** Does the terrain immunity apply when **defending**? A defender's CP is its terrain alone, so this is
  the difference between a Swoop in a Chasm defending at **−2** or at **+1** — a four-point swing on every
  incoming attack, and enough to change how Swoop pieces should be priced. **[H]** Yes, it applies to defense.

### 6.2 Damage

- **[C]** **`damage = attackerCP − defenderCP`**, dealt to the defender's Health, whenever
  `attackerCP > defenderCP`.
- **[C]** If `attackerCP <= defenderCP`, no normal damage occurs; the attack is a **Defense Break** (§6.3).

**Worked examples** — attacker with **Attack 3**. These are the first golden tests to write.

| Attacker terrain | Defender terrain | Side hit | attCP | defCP | Result |
|---|---|---|---|---|---|
| Grassland (0) | Grassland (0) | neutral | 3 | 0 | **3 damage** |
| Grassland (0) | Grassland (0) | armored | 3 | 1 | **2 damage** |
| Grassland (0) | Grassland (0) | weak | 3 | −1 | **4 damage** |
| Hill (+2) | Grassland (0) | neutral | 5 | 0 | **5 damage** |
| Grassland (0) | Hill (+2) | neutral | 3 | 2 | **1 damage** |
| Grassland (0) | Hill (+2) | armored | 3 | 3 | **Defense Break** |
| Grassland (0) | Mountain (+3) | neutral | 3 | 3 | **Defense Break** |
| Grassland (0) | Mountain (+3) | weak | 3 | 2 | **1 damage** |
| Hill (+2) | Mountain (+3) | neutral | 5 | 3 | **2 damage** |
| Grassland (0) | Chasm (−2) | neutral | 3 | −2 | **5 damage** |
| Grassland (0) | Corrupted (−2) | weak | 3 | −3 | **6 damage** |

Two consequences worth noting for evaluation functions later: **high ground is defensively enormous** — a
Mountain alone (+3) blanks any Attack-3 machine attacking from flat ground — and **corrupted or chasm tiles are
death traps**, since a −2 defender CP adds 2 to every incoming hit on top of the −2 to its own attacks.

### 6.3 Defense Break

- **[C]** Triggered when the attacker's Combat Power is **lower than or equal to** the defender's.
- **[C]** **Both machines lose 1 Health.**
- **[C]** **The defending machine is knocked back one tile** (§7), directly away from the attacker.
- **[C]** It is the **defender** that is knocked back, not the attacker. A failed attack still shoves its
  target.
- **[?]** Can Defense Break kill either machine? At 1 Health, both are at risk. If both die, §9.4's ordering
  rule decides the points.

### 6.4 Attack legality

- **[C]** **No friendly fire — with one deliberate exception.** A machine cannot target its own side, but
  **`Dash` damages and rotates every machine in its lane, including its owner's** (§3.3). Treat friendly fire as
  a property of the *effect*, not of targeting: nothing chooses a friendly target, but area effects do not
  discriminate.
- **[?]** Can a piece standing between attacker and target **block a ray attack** aimed past it? (§4.1)

---

## 7. Forced movement and knockback

**[C] One collision system governs every forced move.** This supersedes all earlier descriptions.

### 7.1 Knockback

- **[C]** A knocked-back machine moves **one tile in the opposite direction from its attacker**.
- **[C]** Sources of knockback: **Defense Break** (§6.3), and the push effects of machine types such as `Ram`.

### 7.2 Collision

What sits behind the machine decides the outcome:

| Behind the machine | Result |
|---|---|
| **Clear tile** | It moves there. No extra damage. |
| **Board edge** — no tile at all | It loses an **additional 1 Health**. |
| **Another piece** | **Both machines lose an additional 1 Health.** |
| **A Chasm** | It lands in the Chasm. **No damage** — see §7.3. |

- **[C]** The collision damage is a **flat 1**, to each machine involved. It is *not* derived from the
  armor/weak layouts of the colliding pieces — that earlier description is superseded.
- **[?]** In the blocked cases (edge, occupied), does the machine **stay where it is**? Nothing can move it, so
  presumably yes. **[H]** It stays in place and takes the extra damage.
- **[?]** Does colliding with a **friendly** piece also cost both 1 Health? The rule says "another piece"
  without qualification. **[H]** Yes — friendly or not.
- **[?]** Does a chain form — if the blocking piece is itself against a wall, does it get pushed too? **[H]** No
  chaining: exactly two machines are involved, and the blocker does not move.

### 7.3 Chasms — no special case

- **[C]** **There is no chasm knockback rule.** A machine knocked or pulled into a Chasm simply **ends up in the
  Chasm**. No extra damage, no destruction.
- **[C]** It could not have *moved* there under its own power (§2.6), but being forced in is legal, and it takes
  the ordinary **−2** Combat Power while it stands there — as attacker and, being terrain, as defender too.
- **[C]** Chasms are therefore a **control tool, not a kill**: shoving something into one is a strong tempo and
  position play, not an execution. Every trained agent will still learn to use them, but they will not dominate
  the game the way an instant-kill would have.
- Getting out is ordinary movement — the restriction is on *entering* a Chasm, not leaving one.

### 7.4 Pull

- **[C]** A `Pull` moves the target **one tile toward** the attacker (§3.3).
- **[?]** Do pulls use the §7.2 collision table — 1 damage each against an edge or an occupied tile? With
  knockback now unified and flat, they probably share it. **[H]** Pulls use §7.2 unchanged.
- **[?]** Is push/pull distance always exactly 1?

## 8. Setup

### 8.1 Drafting

- **[C]** A team's Points must total **exactly 10**.
- **[C]** At most **4 identical pieces** per team.
- **[C]** **All 43 pieces are available to both players** — no restricted collection for now.
- **[C]** **Drafting is hidden**: neither player sees the other's team until deployment.
- **[C]** Drafting rules will eventually **differ between human-vs-human and human-vs-AI**.

> **TODO (future) — drafting modes.** Build the draft as a pluggable step so alternatives can be added:
> open vs hidden, simultaneous vs alternating pick, banned pieces, drafting *against* a revealed opponent team,
> and restricted collections. For AI experiments this matters more than it looks: a hidden simultaneous draft is
> a **separate imperfect-information game** sitting on top of the perfect-information board game, and an agent
> that drafts well is solving a different problem from one that plays well. Keep the two separable so the arena
> can hold the draft fixed and measure play alone.

### 8.2 Deployment

- **[C]** Each player places pieces anywhere within **their own back two rows** — rows 0–1 and rows 6–7.
- **[?]** Simultaneous or alternating placement?
- **[?]** Starting **facing** — chosen freely, or fixed toward the opponent?
- **[H]** Players alternate placing one piece at a time, each choosing facing freely.

> Note the interaction with corruption: the back two rows are **where each player's blight front begins**
> (§2.5). Deployment territory is the first thing to be consumed, so pieces cannot simply camp at home.

---

## 9. Victory and game end

### 9.1 Victory points

- **[C]** Destroying an enemy piece awards its **Points** value to the destroyer.
- **[C]** **First player to reach 7 Victory Points wins immediately.**
- **[C]** A piece destroyed by **corruption** awards its Points to the **opponent of its owner** (§2.5).

### 9.2 Elimination

- **[C]** Destroying **all** enemy pieces wins, regardless of VP.

### 9.3 Time limit — depends on the corruption setting

- **[C]** **Corruption on (default):** when there is **no terrain left to corrupt**, the game ends. Corruption
  advances one tile per player turn and never reverses, so this lands at roughly **32 rounds** — sooner in
  practice, as machines caught in the blight bleed 2 Health per turn.
- **[C]** **Corruption off:** the game ends after a fixed **50 rounds**.
- **[C]** **Who wins on time is not a real concern.** Long before the board is fully blighted, machines standing
  in corruption are bleeding 2 Health a turn, so pieces start dying and the game resolves by Victory Points or
  elimination on its own.
- **[H]** The engine still needs a defined answer for the degenerate case: **highest Victory Point total wins;
  equal VP is a tie.** It should almost never fire, and if it fires often in self-play that is a signal
  something else is wrong.
- Both modes terminate, so self-play is safe either way.

### 9.4 Destruction and simultaneous deaths

- **[C]** A piece at **0 or less Health** is destroyed and removed from the board.
- **[C]** **When two or more machines are destroyed at the same time, the player whose turn it is is awarded
  their Victory Points first.** The canonical case is two pieces killing each other in one exchange — **the
  aggressor scores first**.
- This is not a cosmetic ordering rule: if both players would cross 7 VP on the same exchange, **the active
  player wins**. The engine must award VP in a defined order and check the win condition after each award, not
  after resolving the whole exchange.
- **[?]** Does the same ordering apply to simultaneous **corruption** deaths at the start of a turn — the active
  player's kills counting first? **[H]** Yes, same rule.

---

## 10. Skills

**[C] All fifteen skills are specified.** Per-piece assignments are in [docs/pieces.md](pieces.md).

They are not fifteen special cases. They collapse into **seven mechanisms**, and the engine should implement
them that way — a table of skill definitions, not a switch statement:

### 10.1 Attack-from-terrain bonuses

**One per terrain tier from Grassland upward.** All grant **+1 Combat Power to the attacker** when attacking
*from* that terrain.

| Skill | Terrain | Pieces |
|---|---|---|
| **Gallop** | Grassland | Charger, Grazer |
| **Stalk** | Forest | Clamberjaw, Stalker |
| **Climb** | Hill | Lancehorn |
| **High Ground** | Mountain | Fanghorn |

> A clean symmetry: four skills, four terrain tiers, one mechanism —
> `attackFromTerrainBonus(terrain) → +1 CP`.

### 10.2 Terrain conversion on attack

All change the **target's** tile, gated on its current terrain, one step along the ladder (§2.2).

| Skill | Conversion | Step | Pieces |
|---|---|---|---|
| **Burn** | Forest → Grassland | −1 | Fireclaw, Scorcher, Elemental Clawstrider |
| **Freeze** | Marsh → Grassland | +1 | Frostclaw |
| **Growth** | Grassland → Forest | +1 | Plowhorn |

### 10.3 Alter Terrain

- **[C]** **After inflicting damage**, the terrain under the **attacker** lowers one step and the terrain under
  the **target** rises one step. No terrain gate; floor Marsh, ceiling Mountain (§2.3).
- **[C]** Pieces: Bilegut, Rockbreaker, Slitherfang, Tracker Burrower.
- **[?]** "After inflicting damage" — does it fire on a **Defense Break**, where no normal damage is dealt but
  both machines lose 1 Health? **[H]** No: it requires normal damage.

### 10.4 Start-of-turn auras

All apply to every machine within the skill-holder's **Attack Range**.

| Skill | Effect | Pieces |
|---|---|---|
| **Empower** | Friendly machines gain **+1 Attack Power**. Stacks. | Longleg, Leaplasher |
| **Spray** | **All** pieces lose **1 Health**. | Bellowback, Bristleback, Slaughterspine |
| **Whiplash** | **All** pieces **rotate 180°**. | Dreadwing, Waterwing |
| **Blind** | Enemy machines lose **1 Attack Power** for the rest of the turn. Stacks. | Redeye Watcher |

- **[C]** `Blind` is explicitly **turn-scoped** — it lasts "for the rest of the turn" and stacks within it.
- **[?]** Is `Empower` turn-scoped the same way, or is its +1 permanent and cumulative? Both stack, so if
  Empower persists it grows without bound. **[H]** Turn-scoped, matching Blind.
- **[H] Implementation note:** `Empower` and `Blind` are built as **continuous auras**, recomputed from board
  position whenever attack power is needed, rather than stamped on at the start of a turn. They stack
  identically, but a machine that moves into range gains the effect immediately instead of next turn. This keeps
  them stateless — there is no modifier to reset, and none can be left behind on a destroyed piece. If the real
  game snapshots at turn start, this is the single place to change.
- **[?]** Do these fire on **every** player's turn, or only their owner's? **[H]** Only the owner's turn,
  matching corruption damage (§2.5).
- **[?]** `Spray` and `Whiplash` say "all pieces" — confirm they hit the owner's own machines too. `Whiplash`
  spinning your own line around would be a serious drawback. **[H]** Yes, all pieces regardless of owner.

> **`Whiplash` is more dangerous than it looks.** Rotating a machine 180° turns its front to its back — so an
> enemy presenting armor is suddenly presenting its weak side, and the facing system (§3.2) is the whole
> defensive game. Expect any competent agent to build around it.

### 10.5 Defensive and reactive

| Skill | Effect | Pieces |
|---|---|---|
| **Shield** | **+1 Combat Power when defending** — added to the defender's CP (§6.1). | Behemoth, Shell-Walker |
| **Retaliate** | **On being attacked**, rotates to face its attacker and deals **1 damage**, if the attacker is in range. | Apex Clawstrider, Rollerback |

- **[?]** `Retaliate`'s free rotation happens outside its own activation — does it also apply against the *next*
  attacker in the same turn, and does it fire when the attack is a Defense Break? **[H]** It fires on every
  attack against it, Defense Breaks included.
- Note `Retaliate`'s rotation is itself defensively useful: it turns the machine's front toward the threat.
  Both `Retaliate` pieces are armored on the front (Apex Clawstrider F,L,R; Rollerback F,L,R), so it
  effectively re-presents armor at the attacker.

### 10.6 Sweep — area attack

- **[C]** A `Sweep` attack hits its target **and any machines perpendicular to it**.
- **[C]** The exact area is **per-piece**, following from each machine's type and range:

| Piece | Type | Area |
|---|---|---|
| **Ravager** | Gunner | **1×3, two tiles ahead** — consistent with Gunner firing at exactly max range (§3.3) |
| **Thunderjaw** | Dash | **1×3 directly in front** |
| **Tremortusk** | Dash | **1×3 directly in front** |
| **Stormbird** | Swoop | **3×3 in front** |

- This is the source of the 1×3 frontal shape noted in §4.1 — it is a skill, not a machine type.
- **[C] Encoded** in `machines.json` as `attackArea`: a list of **`[right, forward]` offsets in the piece's own
  frame**, rotated by facing at resolution time. `+forward` is tiles ahead, `+right` is tiles to the piece's
  right.

| Piece | `attackArea` | Tiles |
|---|---|---|
| Thunderjaw | `[-1,1] [0,1] [1,1]` | 3 |
| Tremortusk | `[-1,1] [0,1] [1,1]` | 3 |
| Ravager | `[-1,2] [0,2] [1,2]` | 3 |
| Stormbird | rows at forward 1, 2 and 3, each spanning right −1…+1 | 9 |

These are **per-piece data, not derivable from type** — Thunderjaw and Tremortusk are both Dash at range 2 and
share a shape, but Stormbird's 3×3 does not follow from Swoop, and Ravager's sits two tiles out because Gunner
fires at exactly max range.
- **[?]** Does `Sweep` hit **friendly** machines caught in the area, the way `Dash` does (§6.4)? **[H]** Yes —
  friendly fire is a property of area effects, not of targeting.
- **[?]** Is damage computed independently per machine in the area, by the normal §6.2 formula against each
  one's own terrain and facing? **[H]** Yes.

---

## 11. Verification checklist

**Nothing structural is unknown any more.** The damage formula (§6), machine types (§3.3) and all fifteen skills
(§10) are specified. What remains is confirmation and interaction detail — worth doing, but the engine no longer
waits on it.

**Confirm the combat formula** — spot-check against the worked table in §6.2

| # | Situation | Expected under §6 |
|---|---|---|
| 1 | Attack 3 from Grassland → defender on Grassland, neutral side | 3 damage |
| 2 | Same, defender on **Hill** | 1 damage |
| 3 | Same, defender on Hill, **armored** side | Defense Break (3 vs 3) |
| 4 | Attack 3 from Grassland → a **high-Attack** defender on Grassland | Still 3 — the defender's Attack must not matter |
| 5 | Attack a **Shield** piece (Behemoth) on Grassland, neutral side | Confirms Shield is +1 to defender CP |
| 6 | Defense Break with both machines at 1 Health | Whether it can kill both, and who scores |

**Skill interactions** — the bulk of what is left

| # | Situation | Resolves |
|---|---|---|
| 7 | `Empower` over several turns | Turn-scoped like `Blind`, or permanent and cumulative? |
| 8 | `Spray` / `Whiplash` with own machines in range | Whether they hit their owner's pieces |
| 9 | `Spray` / `Empower` / `Whiplash` observed on both players' turns | Owner's turn only, or every turn? |
| 10 | `Retaliate` against a Defense Break, and against two attackers in one turn | Its trigger conditions |
| 11 | `Alter Terrain` on an attack that Defense Breaks | Whether "after inflicting damage" excludes it |
| 12 | `Sweep` with a friendly machine in the area | Whether area effects hit allies, as `Dash` does |
| 13 | `Sweep` against targets on differing terrain | Whether damage is computed per target |

**Machine type details**

| # | Situation | Resolves |
|---|---|---|
| 14 | **Swoop** attack with several open tiles beside the target | Whether the landing tile is chosen or determined |
| 15 | Attack a **Swoop** sitting in a Chasm | Whether its terrain immunity applies on **defense** |
| 16 | **Pull** with a friendly piece in front of the target enemy | Whether Pull really reaches past its own line |
| 17 | **Dash** through a mixed lane | Per-target damage and the 180° rotations |
| 18 | **Dash** with a blocked landing tile | Confirms the attack is simply illegal |

**Knockback, movement, turns**

| # | Situation | Resolves |
|---|---|---|
| 19 | Knock a machine back into a **friendly** piece | Whether allies collide |
| 20 | Knock a machine into a piece that is *itself* against a wall | Whether collisions chain |
| 21 | **Pull** a target against an edge and against a piece | Whether pulls share the collision table |
| 22 | Move any non-`Pull` machine through Marsh | Whether other exemptions exist |
| 23 | **Rotate in place**, no move or attack | Settles the §4.3 contradiction |
| 24 | **Overcharge** twice in one activation, then check remaining activations | Repeat overcharge; activation cost |
| 25 | Let the blight spread under a machine, then move it out next turn | Confirms no damage on the spreading turn |

---

## 12. Deliberate deviations from the real game

| # | House rule | Reason |
|---|---|---|
| 1 | **180° rotational symmetry** for generated boards | Strictest fairness property; see §2.1 |
| 2 | Everything marked **[H]** above | Placeholder decisions so the engine is fully specified; each is replaced as its **[?]** resolves |

The **50-round limit is not a house rule** — it is the real ending condition whenever corruption is switched
off (§2.5, §9.3). With corruption on, the blight ends the game on its own.

---

## 13. Open questions

**No blocking questions remain.** The board, terrain, corruption, movement, activations, overcharge, combat
formula, knockback, all six machine types and all fifteen skills are specified. The engine can be built.

Everything below is confirmation or interaction detail. Each has a **[H]** decision in place, so the engine is
fully defined in the meantime — these refine it rather than unblock it.

**Worth settling early — they change tactics, not architecture**

- [ ] §6.1 Does `Swoop`'s terrain immunity apply on **defense**? A four-point swing on every attack against a
      Swoop in a Chasm, and enough to change how the type should be valued.
- [ ] §10.4 Is `Empower` turn-scoped like `Blind`, or permanent and cumulative? Unbounded if it persists.
- [ ] §10.4 Do start-of-turn auras fire on **every** player's turn or only the owner's?
- [ ] §10.4 Do `Spray` and `Whiplash` hit their **owner's** machines?
- [ ] §10.6 Does `Sweep` hit friendlies, and is damage computed per target?
- [ ] §4.3 **Is rotating in place a legal activation?** Two statements conflict; the engine currently says no.
- [ ] §5.5 Does **overcharge consume the second activation**? Can it be used twice in one activation?

**Detail**

- [ ] §3.3 Does `Swoop` **choose** its landing tile after attacking?
- [ ] §3.3 Does `Pull` really target the first *enemy*, reaching past friendly pieces?
- [ ] §10.3 Does `Alter Terrain` fire on a Defense Break, where no normal damage is dealt?
- [ ] §10.5 `Retaliate`'s exact trigger conditions.
- [ ] §6.3 Can Defense Break kill both machines?
- [ ] §7.2 Do **friendly** collisions cost both machines 1? Do collisions **chain**?
- [ ] §7.4 Do **pulls** use the same collision table? Is push/pull distance always 1?
- [ ] §5.5 Does the opponent score points when a machine dies to its **own overcharge cost**?
- [ ] §4.4 Is any piece besides `Pull` exempt from the Marsh stop?
- [ ] §8.2 Deployment: simultaneous or alternating; free facing or fixed.

**Data and content**

- [ ] §3.1 **Verify the rest of the roster** against in-game piece cards. Four entries checked so far;
      two were wrong, so assume more errors remain.
- [ ] §10.6 Encode the four **`Sweep` areas** as per-piece offset lists in the roster data.
- [ ] §2.1 Build the **board library**, and tune the random generator's terrain constraints.

**Future features — deliberately deferred**

- [ ] §2.1 **Map editor** — author a board tile by tile and save it to the library.
- [ ] §2.1 **Generator controls** — roll a random map, optionally specifying terrain counts.
- [ ] §8.1 **Drafting modes** — open vs hidden, simultaneous vs alternating, bans, restricted collections, and
      different rules for human-vs-human than for human-vs-AI.
- [ ] §5.1 **First-player options** beyond the current fixed Player 1.
