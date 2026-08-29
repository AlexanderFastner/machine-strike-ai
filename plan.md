# Machine Strike — Web Implementation + AI Research Testbed

> Machine Strike is the board game from **Horizon Forbidden West** (not Zero Dawn) — useful when searching for
> rules references.

## 0. Goals

Two stages, sequential, sharing one engine:

- **Stage 1 — A playable game.** A rules-faithful Machine Strike in the browser, **hot-seat player-vs-player
  first**. Two humans on one machine, full rules, no AI anywhere in the codebase. This is the first shippable
  milestone, and nothing in Stage 2 starts until a complete PvP game can be played end to end.
- **Stage 2 — AI opponents.** A testbed for opponent algorithms: heuristic → search → learned. Thousands of
  headless games, agents ranked by Elo, ablations.

Stage 2 is the long-term interest; Stage 1 is the prerequisite that makes it trustworthy. A correct engine plus
a UI you can *watch* is how you'll debug every agent later. Design decisions still lean toward "can I run 10,000
games of this overnight" — that costs nothing in Stage 1 and would be expensive to retrofit.

### Current state of this repo

| Path | What |
|---|---|
| [`docs/rules.md`](docs/rules.md) | **Rules spec** — the authority the engine implements, with every gap marked |
| [`docs/pieces.md`](docs/pieces.md) | **43-piece stat table**, generated from the roster data |
| [`packages/data/machines.json`](packages/data/machines.json) | Roster: stats, armor/weak facings, points, skills |
| [`assets/terrain/`](assets/terrain/) | Your 32×32 tiles (`forrest` → `forest` corrected on import) |
| [`assets/pieces/placeholder/`](assets/pieces/placeholder/) | Generated geometric piece sprites + contact sheet |
| [`tools/`](tools/) | Regenerators for the table and the sprites |

---

## 1. Rules

Machine Strike is a **deterministic, perfect-information, two-player** game. No dice, no hidden state. That is a
big deal: classical adversarial search (alpha-beta) works directly, and AlphaZero-style self-play applies
cleanly.

### 1.1 Baseline

| Element | Rule |
|---|---|
| Board | 8×8 grid |
| Turn | Activate **two pieces** (see 1.2.6) |
| Combat Power | Base Attack + attacker's terrain value |
| Damage | Attacker Combat Power − defender's terrain value |
| Facing | Armored sides reduce damage **and can hurt the attacker**; weak sides increase it |
| Defense Break | Attacking into equal-or-higher CP → both lose 1 HP, attacker knocked back |
| Overcharge | Spend 2 HP to move or attack a second time |
| Sprint | Move past normal range but forfeit attacking (unless overcharging) |
| Machine types | Melee (14), Gunner (8), Pull (6), Ram (5), Dash (5), Swoop (5) — counts from the roster |
| Setup | Team points total **exactly 10**; max 4 identical pieces |
| Points | **One number** = setup cost *and* the VP the opponent gains when the piece dies |
| Victory | First to **7 VP**, or all enemy pieces destroyed |

**Terrain** — six types, stacked low to high:

| Terrain | Tile asset | Modifier | Effect |
|---|---|---|---|
| Chasm | `chasm.png` | −2 | **Only flying (Swoop) pieces may enter** |
| Marsh | `water.png` | −1 | Impedes movement |
| Grassland | `grass.png` | 0 | — |
| Forest | `forest.png` | +1 | — |
| Hill | `hills.png` | +2 | — |
| Mountain | `mountain.png` | +3 | — |

### 1.2 Resolved rules

Settled; the engine implements these as written.

1. **Rotation is free.** Changing facing does not cost movement.
2. **Targeting is derived, not chosen — machine type decides everything.** Each type auto-selects its target
   from facing and range: **Melee** hits the first machine in range (a range-3 Melee still only hits what is
   directly in front); **Gunner** fires at *exactly* maximum range and cannot hit anything closer; **Ram** hits
   the first machine, knocks it back and advances into the vacated tile; **Swoop** hits the first machine and
   moves next to it; **Pull** hits the first enemy and drags it one tile closer; **Dash** charges to the end of
   its range, damaging **every** machine in the lane — its own included — and rotating each 180°, and needs an
   empty landing tile or the attack is illegal.
   → The player's only combat decisions are **where to stand and which way to face**. This collapses the action
   space: `Attack` carries no target. See §2.2.
3. **The damage formula is settled.** The attacker's Combat Power is its **Attack + its terrain**; the
   defender's is **its terrain only** — a defender's Attack stat contributes nothing to its defense. Facing
   modifies the *defender's* CP: **+1** on an armored side, **−1** on a weak side.
   **`damage = attackerCP − defenderCP`**; if `attackerCP <= defenderCP` it is a **Defense Break** instead —
   both machines lose 1 Health and the defender is knocked back one tile.
   → Two consequences that will shape every evaluation function: **high ground is defensively enormous** (a
   Mountain alone blanks an Attack-3 machine attacking from flat ground), and **chasm/corrupted tiles are death
   traps**, adding 2 to every incoming hit on top of the −2 to the occupant's own attacks.
4. **One knockback system, flat damage — and no chasm special case.** A knocked-back machine moves 1 tile
   directly away. Clear tile → it moves, no extra damage. **Board edge → 1 extra damage.** **Another piece →
   both machines take 1 extra damage.** **A chasm → it simply lands in the chasm, undamaged**, and eats the −2
   while there. Chasms are a *control* tool, not an execution. The collision cost is a flat 1, never derived
   from armor layouts.
5. **Pieces move through friendly pieces; enemies block.** No piece ever *ends* on an occupied tile.
   Pathfinding is a real BFS over tiles blocked by enemies, not a distance formula.
6. **Two activations, two different pieces.** A piece normally activates once per turn; the turn's second
   activation must be a different piece. Exceptions: **Overcharge** (2 HP, exhausts the piece), or having
   **exactly one piece left**, which may then be activated twice.
7. **Deployment:** each player places their machines anywhere within their **back two rows**.
8. **Corruption is a toggle, and it decides how the game ends.** On (default) → the blight consumes the board,
   ~32 rounds. Off → a fixed **50-round** limit. Both modes ship; both terminate, so self-play is safe either
   way. Corruption-off is also the cleaner AI baseline, isolating the combat game from the shrinking board.
   A **round** is a full turn cycle — both players.
9. **Marsh is the `water` tile** (−1). Entering it **ends that piece's movement** — a stop, not a cost.
10. **Corruption (the blight) is a core mechanic and the game's ending condition.** Its own tile type with its
    own texture, modeled as an **overlay** on base terrain because it spreads. From turn 2, at the start of each
    player's turn, **one tile becomes corrupted**. Each player has their own front, starting on the row closest
    to them and advancing inward in **serpentine order** — first row right-to-left, next row left-to-right, and
    so on, from that player's own perspective. A corrupted tile is **−2 Combat Power, replacing** the base
    terrain's modifier — the blight flattens the board's terrain advantage as it spreads. A machine entering
    corruption **stops moving**; a machine standing on it **loses 2 Health at the start of its owner's turn**,
    and if it dies the **opponent** scores its points. The two fronts consume 32 tiles each and **meet exactly
    in the middle** — neither ever jumps the other — and when the last tile is blighted **the game ends**.
    → This replaces any artificial turn cap. Two fronts consume 64 tiles at one tile per player turn, so every
    game terminates in **~32 rounds** — the guarantee self-play needs, arising from the game's own rules rather
    than a house rule. It also makes the board a **shrinking arena**: camping is not a strategy, and every
    position has a hard horizon.
11. **Movement and facing are 4-directional only** — no diagonals. Distance is Manhattan along legal paths, for
    both Movement and Range. This fixes the move generator, the ray tables, and the distance metric.
12. **Two board sources:** an authored **library** of fixed layouts, and a **random generator constrained to
    symmetry** so neither side has an advantage. Use **180° rotational symmetry** — a midline reflection would
    hand the players mirrored left/right handedness, whereas rotation makes their views identical.
13. **Swoop is the flying type**, and the terrain specialist: **+1 Combat Power on all terrain** and it
    **ignores terrain penalties**. Flight applies to chasms only — no piece may pass over an enemy. **Pull** is
    the marsh specialist: +1 CP on Marsh, and it moves through Marsh unhindered.
14. **Terrain skills are all one passive, on-attack step along the terrain ladder** — never a selected ability.
    Burn (Forest→Grassland), Freeze (Marsh→Grassland) and Growth (Grassland→Forest) are gated on a source type
    and all change the **target's** tile. **Alter Terrain has no gate**: it lowers the **attacker's own** tile
    and raises the **target's**, on any terrain, and is *deliberately double-edged* — it exists to push its
    owner to keep repositioning. Skill-driven changes run **Marsh … Mountain**: no skill can create a Chasm, so
    a piece can never dig an illegal tile out from under itself. Implement one
    `stepTerrain(tile, ±1, requireSource?)` primitive, not four special cases.
15. **A corrupted tile counts *only* as corrupted** — −2 CP, and the terrain beneath stops mattering for
    everything, including the terrain-skill gates. Corruption deals **no damage on the turn it spreads**, so a
    machine always gets one turn to walk out; the start-of-turn order is **damage, then spread**.
16. **Activation rules are tight.** Strictly move-then-attack, and **the attack ends the activation** — no
    moving or rotating afterwards, so the facing you attack from is the facing you are left presenting. **No
    null activations** (a piece may not end on the same tile in the same facing) and **no voluntary passing**
    while any activation is possible. If only one piece is *able* to act, it acts twice.
17. **Overcharge is a sacrifice play, not a second activation.** 2 Health buys **one extra tile of movement or
    one extra attack**, requires 2+ Health to declare, and **the cost is paid after the action resolves** — a
    machine can spend its last Health to land a killing blow, score the points, and die. VP must therefore be
    awarded, and victory checked, before the overcharge cost is applied.
18. **Simultaneous deaths resolve in the active player's favour** — the aggressor's VP is awarded first. If both
    players would cross 7 VP in one exchange, **the active player wins**. VP must be awarded in a defined order
    with the win condition re-checked after each award, not after the whole exchange resolves.
19. **Attacks are patterns, not a range check.** Range is generally a straight cardinal ray, but at least one
    machine attacks a **1×3 area in front of it**, putting target tiles diagonal to the attacker. See §2.2.
20. **Sprint is Movement + 1.** **First player is an option**, currently fixed to Player 1.

### 1.3 Still open

**The full list lives in [`docs/rules.md` §13](docs/rules.md#13-open-questions)** — a Phase 0 checklist ordered
by how much damage getting each one wrong would do. Everything still unknown is marked **[?]** in that document,
and every placeholder decision is marked **[H]** so faithful rules are never confused with invented ones.

**Nothing structural is unknown any more.** The board, terrain, corruption, movement, activations, overcharge,
combat formula, knockback, all six machine types and all fifteen skills are specified. **Phase 1 can start.**

What remains in [`docs/rules.md` §13](docs/rules.md#13-open-questions) is confirmation and interaction detail —
whether `Empower` is turn-scoped, whether `Swoop`'s terrain immunity applies on defense, whether rotating in
place is a legal activation. Each has a decision in place, so the engine is fully defined; these refine it
rather than unblock it.

**The fifteen skills collapse into seven mechanisms**, and the engine should implement them as a data table
rather than a switch statement:

| Mechanism | Skills |
|---|---|
| Attack-from-terrain bonus (+1 CP) | `Gallop` Grassland · `Stalk` Forest · `Climb` Hill · `High Ground` Mountain |
| Terrain conversion on the target's tile | `Burn` · `Freeze` · `Growth` |
| Dual terrain step after damage | `Alter Terrain` |
| Start-of-turn aura within Attack Range | `Empower` · `Spray` · `Whiplash` · `Blind` |
| Defensive CP bonus | `Shield` |
| On-being-attacked response | `Retaliate` |
| Area attack | `Sweep` |

One symmetry worth noticing: the four terrain bonuses are **one per terrain tier from Grassland up**, which is a
strong hint the design is regular and that a data-driven implementation will fit it cleanly.

> **Architectural consequence of the skills:** several (`Alter Terrain`, `Burn`, `Growth`) **mutate the board**.
> Terrain is *dynamic state*, not a static backdrop. It must live inside `GameState`, be included in the Zobrist
> hash, be restored by `undoAction`, and be re-encoded per position in the NN input planes. Getting this wrong
> is a class of bug that only surfaces as mysterious search instability much later.

**[`docs/rules.md` §11](docs/rules.md#11-verification-checklist) is 25 situations to play and record** — now
confirmations rather than discoveries. Each becomes a golden test, but none of them gates Phase 1.

---

## 2. Architecture

```
machine-strike/
├── plan.md
├── docs/
│   ├── rules.md                # authoritative rules spec (Phase 0 output)
│   ├── pieces.md               # generated stat table
│   └── notation.md             # position/game notation
├── packages/
│   ├── engine/                 # pure rules. zero dependencies. the foundation.
│   ├── data/                   # machines.json + schema, board layouts
│   ├── web/                    # React app (Stage 1 deliverable)
│   ├── ai/                     # agents                                        (Stage 2)
│   └── arena/                  # headless runner, Elo, tournaments             (Stage 2)
├── assets/{terrain,pieces}/
├── tools/                      # data + asset generators
├── firebase.json               # hosting config -> packages/web/dist
├── training/                   # Python: PyTorch, ONNX export                  (Stage 2)
└── experiments/                # run configs + results                         (Stage 2)
```

**npm workspaces**, TypeScript on the JS side. (Plan originally said pnpm; npm workspaces does the same job here
and is already installed, so it saves a dependency.) Create `ai/`, `arena/`, `training/` only when Stage 2
begins.

### 2.1 `packages/engine` — the critical piece

Everything else is replaceable; this is not.

**Correctness**, enforced by tests, not by care.

**Speed.** Target **>100k action applications/sec** single-threaded. Irrelevant for hot-seat, decisive for
Stage 2, unaffordable to retrofit:
- Board state in flat `Int8Array`/`Uint8Array`s, not objects — one array per plane (occupant, hp, facing,
  terrain base, terrain overlay, flags).
- **Make/unmake, not copy.** `applyAction` returns an undo record; `undoAction` restores. This also hands the
  hot-seat UI a free, correct **undo button** — a Stage 1 feature falling out of a Stage 2 requirement.
- Precompute static tables: terrain values, distance/ray tables, facing→armor lookup per machine.
- Zobrist hashing over pieces **and mutable terrain** for transposition tables and repetition detection.

> **Deviation, recorded deliberately.** The Stage 1 engine (`packages/engine`) is written for *clarity* — plain
> objects and copy-on-write transitions — not for the speed target above. That is the right trade while the goal
> is a correct, playable hot-seat game, and the golden tests pin the behaviour so a rewrite is safe. **But it
> must be converted to typed arrays and make/unmake before Stage 2**, because self-play generation is the
> bottleneck there and a copying engine will not sustain it. Treat this as a scheduled debt, not a decision
> reversed.

**Purity.** No I/O, no randomness, no `Date.now()`. Randomness comes from an injected seeded PRNG. A game must
replay bit-identically from `(seed, action list)`.

```ts
type GameState   // opaque, mutable, owned by caller
type Action      // atomic: see 2.2
type Undo

function initialState(setup: Setup): GameState
function legalActions(s: GameState, out: Action[]): number   // reusable buffer, returns count
function applyAction(s: GameState, a: Action): Undo
function undoAction(s: GameState, u: Undo): void
function outcome(s: GameState): Outcome | null               // null = in progress
function hash(s: GameState): bigint
function features(s: GameState): Float32Array                // Stage 2
function toNotation(s: GameState): string
function fromNotation(str: string): GameState
```

An immutable façade (`freeze`/`clone`) sits on top **for the UI only**. UI convenience must not tax the search.

### 2.2 Action model — atomic, not turn-level

The single most important modeling decision.

A *turn* is "activate two different pieces, each of which may move and/or attack, possibly overcharging."
Treating a whole turn as one action gives a branching factor in the millions. Decompose into **atomic actions**,
with side-to-move flipping only when the turn completes:

```
Move(pieceId, destTile, facing)
Rotate(pieceId, facing)          // free — rule 1.2.1
Attack(pieceId, targetTile)      // target is CHOSEN — rule 1.2.2
Overcharge(pieceId)
EndActivation(pieceId)
EndTurn()
```

**Because targeting is derived** (rule 1.2.2), `Attack` carries **no target** — the machine's type, facing and
range determine who gets hit. This is a significant win for search: the branching factor is
`positions × facings`, with attacking a boolean on top, rather than multiplying by target choice. The
interesting decisions all live in **placement and orientation**, which is also what makes the game's facing
system the heart of its strategy.

**But attacks are still shapes, not a range check.** One attack hits a **1×3 area in front of the attacker**,
putting two target tiles *diagonal* to it even though movement is strictly orthogonal — and since all six types
are now specified as ray-based, that shape must come from a **skill**. So an attack resolves through a
**pattern** — offsets in the piece's own frame, rotated by facing — plus a per-type selection rule (first in
range / exactly max range / everything in the lane):

```ts
type AttackPattern = { offsets: Offset[]; mode: "single" | "all" }
```

Melee strikes, Gunner shots, Dash lanes and frontal sweeps are then one mechanism with different data. Writing
`manhattan(a, b) <= piece.range` produces a move generator that **cannot express the game**, and it is the
single most expensive assumption to unpick once a search sits on top of it.

**Rotation is constrained in a way that helps the search.** Facing may change freely *until* the piece attacks,
at which point it locks — and the attack ends the activation. So there is exactly one facing decision per
attacking activation, and no post-attack repositioning to enumerate. Combined with the ban on null activations,
the generator never emits do-nothing moves.

**Because rotation is free**, prune dominated facings in the *move generator*: only generate rotations that
change which side faces a live threat. Naively enumerating 4 facings per destination inflates the tree fourfold
for nothing. Do it in the generator, not the search, so UI and AI agree on what's legal.

Rough branching per atomic action: `pieces_available × reachable_tiles × useful_facings`, plus attacks — order
10²–10³, turns 2–6 plies deep. Measure it for real in Phase 1; it dictates which Stage 2 algorithms are viable.

### 2.3 Notation

A compact text format for positions and games (call it MSN). Needed for test fixtures, bug reports, saved games,
shareable positions, and later puzzle suites and datasets. Cheap, and every later phase leans on it. Worth doing
in Stage 1 — a hot-seat game you can save and reload is a real feature. Must encode mutable terrain, not just
pieces.

---

## 3. Correctness strategy

The likeliest failure mode is a subtly wrong engine that quietly corrupts everything downstream.

1. **Golden tests** — hand-built positions asserting exact damage, per machine type, per terrain pair, per
   facing, per knockback obstacle (edge / chasm / piece), per skill.
2. **Perft** — chess-style leaf counts from fixed positions at depth N. Any rules change that shifts a number is
   caught immediately. Freeze once the rules are verified.
3. **Property/fuzz tests** — random playouts never crash; HP never negative; VP monotonic; undo restores an
   identical hash (**including terrain and corruption**); every game terminates (the blight guarantees it in
   ~32 rounds — assert it).
4. **Replay determinism** — `(seed, actions)` → identical final hash across runs and machines.
5. **Ground truth** — play real games in Horizon Forbidden West and replay them through the engine, asserting
   each state matches. Tedious, and the only real defense against confidently-wrong rules. *(The old Android
   repo is not a reference — its rules were never fully implemented.)*

---

## 4. Stage 1 — the hot-seat game

Deliverable: two people play a complete, correct game of Machine Strike in a browser tab.

- **Stack:** Vite 7 + React 19 + TypeScript, deployed to **Firebase Hosting**. Zustand for UI state when the
  board needs it — not yet. Board as CSS grid + inline SVG — not Canvas until
  profiling says otherwise; DOM gives free accessibility and easy hit-testing on 64 tiles.
- **Flow:** draft (exactly 10 points, max 4 identical) → deployment (back two rows) → alternating turns of two
  activations → victory at 7 VP, elimination, or the blight consuming the board.
- **Hot-seat specifics:**
  - Always visible: whose turn, activations remaining, both VP totals, and the **blight front** — how much
    board is left. Corruption is a visible clock; the UI should make it impossible to ignore.
  - Confirm-before-commit on attacks and overcharge; **undo** for misclicks (free, via `undoAction`).
  - Optional "pass device" screen between turns — trivial now, and it's the seam an AI player slots into later.
- **Interaction:** click a piece → legal destinations highlighted (BFS; pieces block; chasms excluded unless
  Swoop) → drop → pick facing → optionally attack a highlighted target → end activation.
- **Overlays, built early** — they're how you'll understand agents in Stage 2:
  - Damage preview on hover: attacker CP, defender terrain, facing modifier, knockback bonus, resulting HP.
  - Threat map: which of my pieces are attackable next turn, and for how much.
- **Worker boundary:** engine in a Web Worker from day one, even though hot-seat doesn't need it. AI must never
  block the UI, and retrofitting the boundary hurts.
- **Player abstraction:** the UI talks to `Player` (`requestAction(state) → Promise<Action>`), with
  `HumanPlayer` the only Stage 1 implementation. Stage 2 adds `AgentPlayer` and changes nothing else. This is
  what keeps the AI stage from becoming a UI rewrite.

### 4.1 Assets

**Terrain** — your tiles, imported to `assets/terrain/` as 32×32 PNGs with `.xcf` sources, `forrest` corrected
to `forest`. `heart.png` is the HP icon. `corrupt.png` is the **blight overlay** (rule 1.2.10) — rendered *over*
the base tile, since the underlying terrain still governs Combat Power.
- Render at **integer scale only** (32 → 64 → 96 px) with `image-rendering: pixelated`. Fractional scaling
  destroys pixel art.
- Sprite-sheet them with a JSON atlas once the set is final; individual `<img>` tags are fine until then.

**Pieces** — geometric placeholders are generated for all 43 machines in `assets/pieces/placeholder/`
(`tools/gen_placeholder_pieces.py`, driven by `machines.json`). Open
[`contact-sheet.html`](assets/pieces/placeholder/contact-sheet.html) to see them all. Convention:

- Every sprite is drawn **facing north**; the app rotates the whole sprite by the piece's facing. This is why
  facing is a render transform, never a separate asset.
- A **mitred frame** around the body marks each side in the piece's own frame: **blue = armored**, **red =
  weak**, **grey = neutral**. This is the one thing the art must communicate — it drives every combat decision.
- An **amber chevron** above the body marks the front, so facing stays readable even when the front is neutral.
- The **centre glyph** encodes machine type: diamond = Melee, crosshair = Gunner, chevron-up = Ram, double
  chevron = Dash, dart = Swoop, chevron-down = Pull.
- Ten distinct armor/weak layouts exist across the roster — a useful checklist for the facing golden tests.
- Player colors aren't baked in; tint the body at render time.

Original art only — non-commercial fan reimplementation, no Guerrilla assets, credit them in the README.

### 4.2 Hosting and the build loop

**Firebase Hosting** is a good fit and needs no compromises: the whole game runs client-side, so there is nothing
to serve but static files. That stays true through Stage 2 — the trained net ships as an ONNX file loaded by the
browser, not as an inference API. Firebase only becomes more than a static host if online multiplayer or saved
accounts are wanted later, at which point Firestore is there.

```bash
npm run dev       # local dev server on :5173
npm run build     # typecheck + production build to packages/web/dist
npm run deploy    # build, then firebase deploy --only hosting
```

`firebase.json` points hosting at `packages/web/dist`, rewrites all routes to `index.html` for the SPA, and sets
immutable caching on hashed assets with `no-cache` on `index.html` — so a deploy is visible immediately rather
than being held by a stale cached shell.

**The working loop for Stage 1**: build a feature → verify locally → deploy → look at it on the real URL. Worth
doing every step rather than in one lump at the end, since pixel-art scaling and board layout are exactly the
things that look fine in dev and wrong on a different screen.

---

## 5. Stage 2 — AI ladder

```ts
interface Agent {
  name: string
  chooseAction(s: GameState, budget: Budget): Action   // budget = time | nodes | simulations
}
```

Everything compared under **equal budget**; every agent deterministic given a seed.

### Rung 1 — Baselines
- `Random` — uniform over legal actions. The floor; anything that can't beat it is broken.
- `Greedy` — maximize immediate damage / VP, one atomic action deep.
- `Scripted` — hard-coded heuristics: take high terrain, present armor to the nearest threat, hit weak sides,
  shove enemies into chasms and edges for the bonus. Probably strong, and a good sparring partner.

### Rung 2 — Classical search
- Alpha-beta over atomic actions: iterative deepening, transposition table, move ordering (killer moves, history
  heuristic, damage-first), quiescence through attack sequences.
- **Hand-crafted evaluation**, linear in features: material (HP × piece points), VP differential, terrain
  occupancy, facing exposure, threat count, mobility, tempo, proximity to chasms/edges (weapon *and* liability,
  straight out of the knockback rules), and **distance from the advancing blight** — the board shrinks on a
  known schedule, so board control has an expiry date that a static eval would miss entirely.
  The settled damage formula already tells you two features will carry real weight: **terrain height is both
  offense and defense** (it is the defender's *entire* Combat Power), and **being on a −2 tile is doubly bad**.
  A first-cut eval that only counts material will lose badly to one that understands elevation.
- **Tune weights, don't guess them.** Logistic regression on `features → outcome` over self-play positions
  (Texel tuning) first; CMA-ES/SPSA against the arena if it plateaus.

### Rung 3 — MCTS
UCT with random rollouts, then heuristic rollouts, then early cutoff using the tuned eval. Multi-ply turns mean
the tree naturally models "sequence within a turn." If alpha-beta beats MCTS here — plausible in a small,
deterministic, tactical game — that's a real finding worth writing up.

### Rung 4 — Neural (AlphaZero-lite)
- **Input:** ~8×8×N planes. Per side: one plane per machine type, normalized HP, 4 facing planes,
  activated/overcharged flags. Plus 6 terrain planes (**recomputed per position** — terrain mutates), VP totals
  broadcast as constants, side-to-move, activations remaining, plus a **corruption plane** and both blight
  front counters. Budget ~40–60 planes.
- **Policy head:** `8×8×K` — from-square × action-type planes (move-offset × facing, attack-by-direction,
  rotate, overcharge, end). Mask illegal actions before softmax.
- **Value head:** scalar in [−1, 1], plus an auxiliary head predicting final VP differential — a richer signal
  than win/loss, and the blight's fixed horizon makes VP a meaningful target.
- **Net:** small ResNet, ~6–10 blocks × 64–128 channels. On an 8×8 board this is tiny; don't over-build.
- **Loop:** self-play (PUCT MCTS, Dirichlet root noise, temperature schedule) → replay buffer → train → gate
  against the old net in the arena (promote above 55%) → repeat.

### Rung 5 — Experiments (the payoff)
- Elo ladder with confidence intervals.
- Ablations: policy head vs value-only; simulations vs strength; eval feature ablations; learned eval *inside*
  alpha-beta (a cheap hybrid that often beats full MCTS at low budget).
- **Draft generalization:** teams total exactly 10 points from 43 pieces, so the draft is a large combinatorial
  space. Does a net trained on one composition transfer to another? Genuinely underexplored, and this game is a
  clean testbed for it.
- Behavioral analysis: does the net learn facing management and knockback tactics, or just trade material?

---

## 6. Training infrastructure (Stage 2)

**Bridge problem:** engine in TypeScript, training in PyTorch. Pick (a):

- **(a) Recommended.** Self-play in **Node** (`worker_threads`, N cores) on the TS engine, inference via
  `onnxruntime-node`. Games written to disk as JSONL/npz. **Python trains** and exports ONNX back. Files are the
  interface; runtimes never talk directly. Simple, debuggable, trivially parallel — and the same ONNX file
  drives `onnxruntime-web` in the browser, so the shipped app runs the exact trained net.
- (b) Pure TypeScript with tfjs-node — one language, weaker training ecosystem. Fallback.
- (c) Port the engine to Python — rejected. Two engines means two rule sets means silent divergence.

**Hardware:** on Apple silicon, PyTorch MPS handles a net this small comfortably. The bottleneck is **self-play
generation**, not gradients — which is why engine speed is priority #1.

**Reproducibility:** every run is a checked-in config (`experiments/<name>/config.yaml`) plus results with seed,
git SHA, agent versions, and full Elo output.

---

## 7. Arena (Stage 2)

```bash
arena match --a minimax:depth=4 --b mcts:sims=2000 --games 200 --seed 42
arena tournament --agents agents.yaml --rounds 10 --out results/
arena puzzle --suite tactics.msn --agent minimax:depth=6
```

- Paired games, colors swapped, identical seeds → much lower variance per game played.
- Elo with error bars; report intervals, never a bare number.
- Fixed draft book so agents are compared on play, not luck of the draft.
- Tactical puzzle suite with known-best actions — fast regression without a full tournament.
- Parallel across worker threads; the point is running it overnight.

---

## 8. Phases

### Stage 1 — playable PvP

| Phase | Deliverable | Done when |
|---|---|---|
| **0. Rules** | ✅ **Done.** `docs/rules.md`, `docs/pieces.md`, roster data, placeholder art | No blocking questions remain |
| **1. Engine** | `packages/engine` + tests | 🔄 In progress. Combat, movement, targeting, activations, knockback and corruption done, with 70 golden tests. Remaining: skills, sprint, overcharge, perft, fuzz, and the typed-array conversion |
| **2. Hot-seat** | `packages/web` — draft, deploy, play, win | 🔄 Landing, board select (with the corruption toggle), two-player hidden draft, alternating deployment, and a turn loop with combat and the blight. Remaining: skills, sprint, overcharge |
| **3. Polish** | Undo, save/load via MSN, damage + threat overlays | You'd hand it to a friend without explaining anything |

**Deferred to after the hot-seat milestone** — real features, deliberately not on the critical path:

- **Map editor** — author a board tile by tile and save it into the library.
- **Generator controls** — roll a random map, optionally specifying how many tiles of each terrain type. Keep
  the board format a plain, hand-editable terrain grid so both of these stay cheap.
- **Drafting modes** — open vs hidden, simultaneous vs alternating, bans, restricted collections, and different
  rules for human-vs-human than human-vs-AI. Note a hidden simultaneous draft is a **separate
  imperfect-information game** on top of the perfect-information board game: an agent that drafts well is
  solving a different problem from one that plays well, so keep the two separable and let the arena hold the
  draft fixed when measuring play.
- **First-player options** beyond the current fixed Player 1.

**Stage gate:** don't open `packages/ai` until Phase 3 is done. The hot-seat game is what proves the rules are
right; debugging an agent on an unproven engine is the expensive way to find rules bugs.

### Stage 2 — AI

| Phase | Deliverable | Done when |
|---|---|---|
| **4. Arena** | Headless runner, Random + Greedy, `AgentPlayer` in the UI | `arena match` produces Elo with error bars |
| **5. Search** | Alpha-beta + tuned eval | Beats Greedy >90%; you lose to it at depth 4 |
| **6. MCTS** | UCT + variants | Ranked against alpha-beta at equal time budget |
| **7. Neural** | Self-play loop, PyTorch, ONNX | A trained net beats the tuned alpha-beta |
| **8. Study** | `docs/experiments/` write-ups | Ablations answer questions you actually had |

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| **Rules are wrong** → Stage 2 results built on sand | Ground-truth replay (§3.5) and the §11 confirmations. The spec marks every assumption **[H]**, so wrong guesses stay findable rather than buried |
| **Roster data is an unverified wiki scrape** | Spot-check in game before freezing perft; treat `machines.json` as provisional |
| **Branching factor too large** for alpha-beta | Measure in Phase 1 before choosing an algorithm. Atomic actions + facing pruning (§2.2) are the levers |
| **Engine too slow** for self-play | Typed arrays + make/unmake from day one; retrofitting means a rewrite |
| **Mutable terrain modeled as static** | Terrain in `GameState`, in the Zobrist hash, in undo, in the NN planes — decided now, not later |
| **Corruption modeled as a 64-tile bitmap** | Its spread order is fixed and play-independent, so the whole blight state is **two counters** over a precomputed tile permutation. Cheap in the hash, cheap in make/unmake |
| **Stage 1 never ends** (art, polish) | Phase 2's bar is "correct and playable", not "pretty". Placeholder pieces are acceptable indefinitely |
| **UI can't accept an AI player later** | The `Player` interface + Worker boundary in §4, both built in Stage 1 |
| **Neural training silently not learning** | Gate against previous nets; keep Random and Greedy in every tournament as reference points |
| **Assets / IP** | Original art only, non-commercial, credit Guerrilla in the README |

---

## 10. First steps

Phase 0 is complete — rules specified, roster in data, placeholder art generated.

1. Scaffold the pnpm workspace and `packages/engine` with the §2.1 API — signatures only, no logic.
2. Write the **golden tests first**, straight from the §6.2 worked table in `docs/rules.md`: 11 damage cases,
   then one per armor/weak layout, one per knockback outcome, one per skill mechanism.
3. Encode the four `Sweep` areas as per-piece offset lists in `machines.json`.
4. Implement until the golden tests pass; then perft; then fuzz.
5. Build the hot-seat UI.
6. Whenever the game is in front of you, work through the §11 confirmations and fold each result back into
   `docs/rules.md`, converting **[H]** to **[C]**.

Within Stage 1 the engine still comes before the board rendering — but the *goal* of Stage 1 is the playable PvP
game, and every engine decision should be measured against getting there.
