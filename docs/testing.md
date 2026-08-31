# Engine test coverage

**What this document is for.** The engine is the one thing in the project that everything else trusts. The web
app is a view over it, and every AI agent in Stage 2 will be trained and measured against it — so a rule that is
quietly wrong here does not produce a visible bug, it produces an agent that has learned a subtly different
game. This file records what the tests actually check, so that gaps are visible rather than assumed away.

Keep it current: **when you add a rule, add its line here.** An unticked box is a known gap; a missing box is a
gap nobody knows about.

```bash
npm test
```

```bash
npm run test:fuzz:deep
```

`npm test` runs all three suites (a few seconds). `test:fuzz:deep` runs 5000 games instead of 400.

---

## The three suites, and why there are three

They fail in different ways on purpose. Each catches a class of bug the others structurally cannot.

| Suite | File | Catches | Blind to |
|---|---|---|---|
| **Golden** | `test/golden.ts` | Specific rules producing specific numbers — the damage table, skill effects, turn order | Anything nobody thought to write a case for |
| **Perft** | `test/perft.ts` | Any change to the *shape* of the legal action space, whether or not it was intended | Whether the resulting states are sane |
| **Fuzz** | `test/fuzz.ts` | States that are each individually legal but collectively impossible, across thousands of random games | Whether the rules match the real game |

The division earns its keep. The Dash landing bug in §4 was invisible to golden tests (nobody thought to write
that case) and invisible to perft (the action counts were correct — it was the *resolution* that was wrong).
Only fuzz found it, and only because it checked an invariant rather than an expected value.

---

## 1. Golden tests — 123 assertions

Specific positions with hand-computed expected results, taken from [docs/rules.md](rules.md).

### Combat maths (rules 6)
- [x] All 11 rows of the worked damage table in rules §6.2
- [x] Attacker Combat Power = attack + terrain
- [x] Defender Combat Power = terrain only — the defender's Attack stat contributes nothing
- [x] Armoured side +1 to defender CP, weak side −1, neutral 0
- [x] Defense Break triggers on equal-or-lower CP; both lose 1
- [x] Struck side derived from attack direction, for all four facings
- [x] Swoop ignores terrain penalties and gains +1 everywhere
- [x] Pull gains +1 on marsh
- [x] Corrupted tiles replace the terrain modifier entirely, attack and defence
- [ ] Whether Defense Break can kill both machines at once *(rules §6.3, unresolved)*

### Machine types (rules 3.3)
- [x] Gunner fires at exactly maximum range and cannot hit anything nearer
- [x] Melee/Ram/Swoop/Pull take the first machine along the ray
- [x] Friendly machines block a ray and make the attack illegal
- [x] Dash hits every machine in its lane, its own included, and needs an empty landing tile
- [ ] Swoop's reposition-after-attack *(rules §5.4, not implemented — believed to exist)*
- [ ] Whether Swoop chooses its landing tile *(rules §3.3, unresolved)*

### Skills (rules 10) — all 15
- [x] Gallop / Stalk / Climb / High Ground: +1 CP on their own terrain tier only, and nothing while corrupted
- [x] Burn / Freeze / Growth convert the **target's** tile, gated on its terrain
- [x] Alter Terrain sinks the attacker's tile and raises the target's
- [x] The terrain ladder clamps: marsh is the floor for skills, mountain the ceiling — no skill can dig a chasm
- [x] Empower and Blind stack, and apply only to the correct side
- [x] Auras are snapshotted at turn start: moving into one mid-turn does nothing until next turn
- [x] Blind is stamped on the victim, so it bites on the victim's own turn
- [x] Shield adds to defender CP
- [x] Retaliate turns to face its attacker and deals 1 back
- [x] Sweep areas rotate correctly with facing, all four directions
- [x] Sweep hits every machine in its area
- [ ] Spray / Whiplash hitting the owner's own machines *(house-ruled yes, unverified)*
- [ ] Whether Alter Terrain fires on a Defense Break, where no normal damage lands *(rules §10.3)*

### Movement (rules 4)
- [x] Friendly machines can be passed through; a machine cannot stop on one
- [x] Enemy machines block movement entirely
- [x] Marsh ends movement on entry; corruption does the same, flyers included
- [x] Chasms are enterable only by Swoop
- [x] Sprint reaches exactly one tile further than a normal move
- [x] Pull machines cross marsh unhindered
- [ ] Whether any machine besides Pull is exempt from the marsh stop *(rules §4.4)*

### Turn structure (rules 5)
- [x] Two activations per turn, and they must be different machines
- [x] A player with only one machine able to act activates it twice
- [x] Rounds advance only when play returns to Player 1
- [x] Overcharge needs 2 health to declare
- [x] Overcharge cost is paid **after** the action: a dying machine still scores its kill
- [x] The opponent scores a machine that dies to its own overcharge
- [ ] Whether overcharge consumes the turn's second activation *(rules §5.5 — **matters for Stage 2**, it changes the action space)*
- [ ] Whether a machine may overcharge twice in one activation *(currently no)*

### Corruption (rules 2.5)
- [x] Serpentine spread order, per side, including the direction reversal each row
- [x] Each front covers exactly half the board; the two never overlap
- [x] Corruption deals no damage on the turn it spreads — the machine gets one turn to leave
- [x] 2 damage per round, on the owner's turn only
- [x] Blight-off falls back to the 50-round limit, higher VP winning
- [x] The blight ending the board ends the game

### Knockback (rules 7)
- [x] Clear tile: the machine moves, no extra damage
- [x] Board edge: 1 extra damage, and it stays put
- [x] Another piece: both take 1
- [x] Chasms are not a special case — the machine simply lands there
- [ ] Whether collisions chain when the blocker is itself against a wall *(house-ruled no)*
- [ ] Whether pulls use the same collision table *(house-ruled yes)*

### Drafting (rules 8.1)
- [x] Maximum 4 copies of any machine
- [x] A set must total exactly 10 points
- [x] The two limits are enforced independently

---

## 2. Perft — 11 frozen counts

Chess-style leaf counts: how many distinct sequences of N activations exist from a fixed position.

**A perft node is a whole activation, not a square.** One node is a *(destination, facing, attack?)* triple, so
every count below carries a ×4 multiplier for the four facings a machine may end its move in — rotation is free
and unlimited during an activation (rules 4.3), and where a machine ends up facing decides what it threatens and
which of its own sides it exposes. That is why these numbers look larger than "squares I could move to". Perft
counts the *legal* action space, not the useful one; Stage 2 search will want to prune facings that change
nothing, but a legality count must not.

**The numbers mean nothing on their own.** Their value is that they move the moment any rule changes — so an
edit that alters the action space without anyone intending it fails loudly. If a number changes, either you
meant it (update the number, and say so in the commit message) or you have just introduced a bug.

**They were derived from the implementation, not guessed** — my first attempt at predicting them was wrong on
6 of 8. That makes hand-verification the safeguard: **every position below carries its derivation inline**, and again in the
test comments, so the frozen numbers are trustworthy rather than merely self-consistent. A count without a
derivation is only self-consistent: it will still fail loudly when a rule changes, but it cannot tell you
whether it was right to begin with.

**Where each machine stands matters as much as the terrain**, so every position names its square. A corner has
only two neighbours, not four — half the cardinal directions are off the board — which is doing as much work in
the numbers below as the terrain is.

- [x] `solo` — **Burrower on a1** (corner), open board: **36** — 9 reachable tiles (2 at distance 1, 3 at 2,
      4 at 3, all clipped by the two board edges) × 4 facings
- [x] `duel` — **Burrower on d4, enemy Burrower on d5**: **87** at depth 1, **7221** at depth 2 — the enemy
      blocks one direction, leaving 21 tiles × 4 = 84 move-only, plus 3 attacking positions (stay on d4 facing
      north, or step to either flank tile beside the target)
- [x] `gunner` — **Scrapper on d4, enemy Burrower on d5**: **87** — the same 21 tiles × 4 = 84, plus 3 tiles
      sitting exactly two away along a ray; one within normal movement, two only by sprinting, which needs an
      overcharge to keep the attack. The matching total is a coincidence of geometry, not a bug
- [x] `sprinter` — **Leaplasher on d4**, open board, movement 4 sprinting to 5: **200** — distance rings of
      4+8+12+14+12 = 50 destinations × 4 facings. The rings are clipped by the board edges, so they stop growing
      at distance 4 and shrink at 5
- [x] `marsh` — **Burrower on a1** (corner) with marsh on a2, b1 and b2: **8** — two effects stack. The corner
      leaves only two neighbours, and both are marsh, which ends movement on entry, so movement 2 and sprint 3
      buy nothing beyond them: 2 reachable tiles × 4 facings. b2 is marsh as well, but that is not why it is
      unreachable — every route to it passes through a2 or b1, and both stop you on arrival
- [x] `chasm` — **Burrower on a1** (corner) with chasms on a2 and b1: **0 activations** — both neighbours are
      illegal for a non-flyer, so it cannot move at all, and with nothing to attack it has no legal activation
- [x] `flyer` — **Glinthawk on a1**, same chasms: not walled in, because Swoop may enter a chasm
- [x] A player with no legal activation forfeits the turn instead of deadlocking

Also recorded, not asserted: **~685,000 activations/sec**, which is the number that decides whether the engine
needs its typed-array conversion before self-play (see [plan.md](../plan.md) §2.1).

---

## 3. Fuzz — 400 random games per run, 5000 on demand

Seeded random playouts. Every failure prints a seed that reproduces it exactly.

### Invariants checked after every single activation
- [x] No machine on the board at 0 or less health
- [x] No machine above its maximum health
- [x] Every machine within the board bounds
- [x] **No two machines on the same tile**
- [x] Victory points never decrease
- [x] **Points balance**: points scored + points still on the board = points deployed. Catches VP appearing from nowhere or a death going unscored
- [x] Terrain is always a valid type
- [x] The blight never exceeds the board

### Per game
- [x] Every game terminates — no infinite games
- [x] Blight-on games end by ~round 33; blight-off by round 51
- [x] Games are played across both flat and mixed terrain (chasms, marsh, mountains)
- [x] Both corruption settings are exercised, alternating by seed

### Determinism
- [x] The same seed produces a byte-identical game, twice — pieces, victory points, round, terrain and blight

### Current run
3000 games, ~379,000 activations, no violations. 2741 decided, 259 drawn, averaging 33.4 rounds.

---

## 4. What the tests have actually caught

Worth recording, because it is the argument for the effort.

- **Dash landing collision** *(found by fuzz, first run)* — a Dash charge validates that its landing tile is
  empty when the attack is declared. But if a machine in its lane triggers a Defense Break, that defender is
  knocked *backwards* — which is exactly where the charge was heading. The Charger then landed on top of it.
  Invisible to golden tests (nobody would have written that case) and invisible to perft (the action counts were
  right; the resolution was wrong). Now the landing tile is re-checked after damage resolves, and a blocked
  charge holds its ground.

---

## 5. Known gaps

Honest list of what these tests do **not** cover.

- [ ] **The UI has its own action path.** `applyActivation` is what perft and fuzz exercise; the web app drives
      `movePiece` / `attackWith` / `endActivation` itself. They agree today, but nothing enforces that. **The
      next refactor should make the UI go through `applyActivation`**, so the tests protect what players
      actually run.
- [ ] **The roster is an unverified wiki transcription.** Four entries have been checked and two were wrong. No
      test can catch a wrong stat — only the in-game piece cards can. This is the largest correctness risk in
      the project.
- [ ] **23 open rules questions** remain in [rules.md §13](rules.md#13-open-questions), each with a house rule
      standing in. The tests verify the house rules, not the real game.
- [ ] **No UI tests.** Screens are verified by hand in the browser.
- [ ] **Perft depth is shallow** (2 in the committed set). Deeper counts on larger positions would catch more,
      but the tree grows too fast for the current engine to explore them in a test run.
