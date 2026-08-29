# Machine Strike

A browser reimplementation of **Machine Strike**, the board game from *Horizon Forbidden West* — and a testbed
for building AI opponents for it.

**▶ Play the current build: [machine-strike-ai.web.app](https://machine-strike-ai.web.app)**

Two players, one device. A fan project, not affiliated with Guerrilla.

---

## Why this exists

The game itself is the near-term goal; the interesting part is what comes after. Machine Strike is
**deterministic and perfect-information** — no dice, no hidden state once the sets are drafted — which makes it
a clean environment for classical search *and* for AlphaZero-style self-play. The plan is to build a correct,
fast rules engine first, then work up a ladder of opponents on top of it: random → greedy → alpha-beta →
MCTS → a trained network, all ranked against each other in a headless arena.

See **[plan.md](plan.md)** for the full two-stage plan.

## Status

**Stage 1 — playable hot-seat game.** Mostly there.

| Working | Not yet |
|---|---|
| Landing → board select → hidden two-player draft → alternating deployment → play | AI opponents (Stage 2) |
| Full combat: Combat Power, facing, Defense Break, knockback, collisions | Board library beyond the flat test board |
| All six machine types, including derived targeting | Random symmetric map generator, map editor |
| All fifteen skills | Draft options (open/alternating/bans) |
| Corruption — the blight, with a toggle for the 50-round alternative | Save / load games |
| Sprint, overcharge, two activations, victory points, win conditions | |

123 engine tests, run with `npm test`.

## Running it

```bash
npm install
npm run dev
```

```bash
npm test
```

```bash
npm run deploy
```

`dev` serves on :5173, `test` runs the engine's golden tests, `deploy` typechecks, builds and ships to Firebase
Hosting.

## How to play

Draft a set totalling **exactly 10 points** (at most 4 of any machine), deploy in your back two rows, then take
turns activating **two different machines**. Destroy enemy machines to score their point value; **first to 7
victory points wins**, or destroy everything.

A machine is defended by *where it stands*, not by how hard it hits: the defender's Combat Power is its terrain
alone, plus **+1** on an armoured side and **−1** on a weak one. Attack into equal-or-higher Combat Power and
you get a **Defense Break** instead — you both lose 1 and the defender is shoved back. Facing is the whole game.

| Key | Action |
|---|---|
| <kbd>E</kbd> | Turn the selected machine a quarter clockwise |
| <kbd>F</kbd> | Confirm a proposed move |
| <kbd>Enter</kbd> | End the activation |
| <kbd>Esc</kbd> | Cancel a proposed move |

Clicking a destination *proposes* it rather than committing: the machine is ghosted there and the card, combat
power, attack range and damage preview all update to the position it would be in. Orange tiles are attack
range, deep red means an enemy is standing in it, and blue-outlined tiles are sprint range — one further, but
you forfeit the attack unless you overcharge.

## Repo layout

```
packages/engine   pure rules — no UI, no dependencies. The foundation.
packages/data     machine roster, board files
packages/web      Vite + React app
assets/           32×32 terrain tiles, generated placeholder piece sprites
tools/            regenerators for the stat table and the sprites
docs/             rules spec, piece stats
```

## Documentation

- **[docs/rules.md](docs/rules.md)** — the rules specification the engine implements. Every statement is marked
  **[C]** confirmed, **[H]** a deliberate house rule, or **[?]** still unknown, so an invented rule can never be
  mistaken for a real one.
- **[docs/pieces.md](docs/pieces.md)** — all 43 machines with stats, armour/weak facings, points and skills.
  Generated from `packages/data/machines.json`; edit the JSON and rerun `tools/gen_pieces_table.py`.
- **[plan.md](plan.md)** — architecture and the road to the AI stage.

## Credits

Machine Strike was designed by **Guerrilla** for *Horizon Forbidden West*. This is a non-commercial fan
reimplementation using original art; no game assets are included.
