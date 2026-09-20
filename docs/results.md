# The results store

Every game the arena plays — tournaments, matches and set sweeps — is kept in one SQLite file,
`results/arena.sqlite` (git-ignored). This page covers why it is SQLite, what is stored, how to run the
set-vs-set sweeps it was built for, and how to read results back out.

```bash
npm run arena -- sweep --agent greedy --sets all --opponents 5 --jobs 5
```

```bash
npm run arena -- report sets --agent greedy
```

```bash
npm run arena -- record --game 1234
```

`sweep` measures sets against the field and stores every game, `report` reads the store back (`sets`,
`machines` or `agents`), and `record --game` turns any stored result back into a replay for the viewer.

---

## Files, a spreadsheet, CSV or a database?

The size of the question decides it. With the current roster there are **147,106 legal sets** — exactly ten
points, at most four of any machine — and so **10.8 billion** distinct pairings, before multiplying by boards.

| | Files and folders | CSV | Spreadsheet | **SQLite** | Database server |
|---|---|---|---|---|---|
| **Scale** | Millions of small files: slow to list, slower to scan | Workable to ~10M rows, but every question reads all of them | Excel stops at 1,048,576 rows | Hundreds of millions of rows on a laptop | Any |
| **Asking a question** | A script per question | A script per question | Formulas, within the row limit | One SQL query, seconds | One SQL query |
| **"Has this game been played?"** — what resuming and reuse need | Scan everything | Scan everything | — | Indexed lookup, ~10 µs | Indexed lookup |
| **Several processes writing** | Risky | Lines can interleave | No | Safe | Safe |
| **Adding a column later** | Old files lack it | Old rows break | By hand | `ALTER TABLE` | A migration |
| **Setup** | None | None | None | **None** — built into Node, one file | A server to run |

**SQLite.** It is a single file — copy it to back up, delete it to start over, nothing to install or keep
running — and a real database: indexes, SQL, transactions, and several processes writing safely at once. Node
26 ships it (`node:sqlite`), so it adds no dependency. A database server would add something to run and
administer for no gain at this scale; that is only worth revisiting if several machines need to write to one
store over a network.

CSV and spreadsheets still have a place, as **views** rather than the store: `--csv file` writes any report
for a spreadsheet, and a leaderboard of a few thousand sets sits comfortably in one.

**Storage is not the constraint.** A game costs about **160 bytes** — 100 for the row, 62 for its index —
plus a one-off catalogue of the sets seen, at most ~33 MB for all 147,106. Ten million games is about 1.6 GB.

---

## The constraint is compute

Playing every pair once, on one board, is 21.6 billion games. At the **~70 games/s** that `greedy` sustains on
this machine with `--jobs 5`, that is **ten years per board**; `heuristic` runs at ~10.5 games/s. So "which
set beats every other set" can't be answered by playing everything, however it is stored. It has to be
estimated.

### What "best" means here

A set's **score against the field**: its expected score against an opponent drawn uniformly from all legal
sets, with both sides piloted by the same agent and first-move advantage cancelled by paired games. That is an
*average* over opponents, and an average can be estimated by sampling. Play a set against randomly drawn
opponents and its measured score closes in on the true one at about ±1/√pairs, however large the field:

| Pairs per set | 95% interval, for a set near 50% |
|---|---|
| 5 | ±33 points |
| 50 | ±13 |
| 500 | ±4.4 |
| 2,500 | ±2.0 |

Telling apart sets two points apart takes thousands of pairs each. That is affordable for a few hundred
finalists, and not for 147,106 sets.

### Successive halving

Screen everything cheaply, then spend games only where the answer is still in doubt. Times are for `greedy`
on one board with `--jobs 5`:

| Stage | Command | Games | Time |
|---|---|---|---|
| Screen every set | `sweep --sets all --opponents 5` | 1.47M | ~6 h |
| Refine the top 10,000 | `sweep --sets top:10000 --opponents 50` | 0.9M new | ~4 h |
| Refine the top 1,000 | `sweep --sets top:1000 --opponents 500` | 0.9M new | ~4 h |
| Confirm the top 100, fresh opponents | `sweep --sets top:100 --opponents 2500 --seed 2` | 0.5M | ~2 h |

```bash
npm run arena -- sweep --agent greedy --sets top:10000 --opponents 50 --jobs 5
```

```bash
npm run arena -- report sets --agent greedy --sweep 2
```

Each stage **reuses** the one before. A set's j-th opponent depends only on the sweep's seed, the set and j —
not on how many opponents were asked for — so extending 5 opponents to 50 plays only the 45 new ones. `top:N`
ranks by the lower bound of each set's interval, so a set that won its only few pairs can't crowd out one that
has been measured properly.

The last stage takes a **new seed on purpose**. The finalists were *chosen* for doing well in the earlier games,
and part of that was luck, so those games flatter them — the winner's curse. Fresh opponents give an unbiased
measurement, and `--sweep 2` reports only those.

`--board all` runs the same stages on every board **in the rotation** — the five with terrain — with each set
meeting the same opponents on each board, so one set's boards can be compared directly. It multiplies the cost
by the number of boards. Flat sits out: it is all grassland, and terrain is the defender's entire Combat Power,
so there is no position on it worth taking and nothing tactical to measure. `--board flat` still runs on it.

---

## What is stored

**Games, one row each, under their identity:** everything that decides how a game plays out — the code
version, the board, blight on or off, both agents, **where each side's machines started**, and the seed. Games are
deterministic, so one identity has exactly one result, and the store doubles as a cache: a game already played
is looked up rather than replayed. That is what makes a sweep resumable (Ctrl-C, then run the same command
again), extendable, and safe to split across processes.

A row also holds the outcome — winner, each side's VP, rounds, activations, branching, whether it hit the
activation cap — the **checksum of the final position**, the time the game took, the run that played it and,
for sweep games, the sweep's seed and which side held the set being measured.

| Table | Holds |
|---|---|
| `games` | One row per game, as above |
| `runs` | One row per arena command: the command line, start, finish and status, code version, git commit and whether the tree was dirty, Node version, games played and reused |
| `sets` | Every set seen, by key — `burrower+clawstrider+scrounger+spikesnout+stalker`, `burrower:4+grazer:4+scrounger:2` |
| `set_machines` | Each set's machines and copies, for per-machine questions |
| `arrangements` | Every arrangement a side started in, by key — `burrower@b1N+clawstrider@c1N+…` — written from its owner's seat, so it is one row whichever side played it; with the set it fields |
| `boards` | Every board seen, by a hash of its terrain, with the terrain itself — a stored game never depends on a board file still existing |

Keying on the arrangement itself, not on a rule's name, is what makes the store safe for searching over
starting positions. Two candidates that differ by one square are two games; the same arrangement listed in
another order, or played from the other side, is the same one.

**Not stored: replays and per-game metrics.** Both can be regenerated from a game's identity, and storing them
would multiply the size for data that is rarely looked at. `arena record --game <id>` replays any stored game,
checks it ends on the stored final checksum — so it is the same game, not a lookalike — and saves it for the
replay viewer. Metrics can become columns later, backfilled the same way.

### The code version

A result is only as good as the code that produced it. H0 found the engine playing on after a win, a bug
that could have changed scores, and fixing a bug like that must not leave stale games mixed in with fresh
ones. So every game carries a **code version**: a hash of every file that can change how a game plays out —
the engine, the roster, the agents, the game loop and the deployment rule. The list is
`OUTCOME_SOURCES` in [store.ts](../packages/arena/src/store.ts); **a new file that can change a game belongs on
it.** Deployers are agent code, so they are covered by it — but an arrangement handed to `fixedDeployer` is
data, and is covered by the arrangement key instead.

Reports read the current version by default. After an edit to any of those files, a report says the store has
nothing for the new version and lists what it does hold. `--code <version>` reads an older version, and
`--code all` pools them — deliberately, never by accident.

The version is a hash of content, not a commit. Changes that can't alter a game — docs, the CLI, the reports,
adding or renaming a board — leave it alone, and stored games stay valid. Editing a board's terrain makes it a
different board. Each run also records its git commit, for people; results are keyed on the content.

---

## Reading results

```bash
npm run arena -- report sets --agent greedy --board all --top 50
```

```bash
npm run arena -- report sets --agent greedy --min-pairs 100 --csv sets.csv
```

```bash
npm run arena -- report machines --agent greedy
```

```bash
npm run arena -- report agents --team standard
```

- **`report sets`** ranks sets against the field, by the lower bound of a 95% interval.
- **`report machines`** compares the sets that field each machine with the sets that don't. It is descriptive,
  not causal: a 7-point machine leaves room for only 3 points of partners, so part of any gap belongs to what
  the machine crowds out.
- **`report agents`** refits the Elo ladder from stored tournament games without replaying any: 1,000 games
  in half a second.

All three take `--board`, `--corruption` and `--code`. The set reports also take `--sweep` and `--min-pairs`,
and `--csv file` writes the whole table.

Anything else is a SQL query away:

```bash
sqlite3 results/arena.sqlite
```

```sql
-- How much is moving first worth, per board and agent?
SELECT b.name AS board, g.agent1 AS agent, ROUND(AVG(g.winner = 1), 3) AS p1_wins, COUNT(*) AS games
FROM games g JOIN boards b ON b.id = g.board GROUP BY b.name, g.agent1;

-- Does the number of machines matter? Score against the field by set size.
SELECT s.machines,
       ROUND(AVG(CASE WHEN g.winner = g.subject THEN 1.0 WHEN g.winner = 0 THEN 0.5 ELSE 0 END), 3) AS score,
       COUNT(*) AS games
FROM games g JOIN sets s ON s.id = CASE g.subject WHEN 1 THEN g.set1 ELSE g.set2 END
WHERE g.subject IS NOT NULL AND g.agent1 = 'greedy'
GROUP BY s.machines ORDER BY s.machines;

-- The best-scoring arrangements of the standard team as Player 1, with at least 20 games each.
SELECT a.key, ROUND(AVG(g.winner = 1), 3) AS p1_wins, COUNT(*) AS games
FROM games g JOIN arrangements a ON a.id = g.deploy1
WHERE g.set1 = (SELECT id FROM sets WHERE key = 'burrower+clawstrider+scrounger+spikesnout+stalker')
GROUP BY a.id HAVING games >= 20 ORDER BY p1_wins DESC LIMIT 10;

-- Every stored game involving one set.
SELECT g.id, g.seed, s1.key AS p1_set, s2.key AS p2_set, g.winner
FROM games g JOIN sets s1 ON s1.id = g.set1 JOIN sets s2 ON s2.id = g.set2
WHERE 'burrower+clawstrider+scrounger+spikesnout+stalker' IN (s1.key, s2.key);
```

Python reads the file directly with the standard library's `sqlite3`, or with `pandas.read_sql`.

---

## Running long sweeps

- **`--jobs n`** splits a sweep across n processes, all writing to the same file. On this machine — an Apple
  A18 Pro, with two performance cores and four efficiency cores — 5 is the sweet spot: 2.2× one process, and
  6 is no faster.
- **Ctrl-C** stops cleanly after the current pair and keeps everything played so far. Running the same command
  again resumes, and replays nothing.
- **Breadth first.** Every set gets its first pair on every board before any set gets a second, so a sweep
  stopped half way is an even, smaller sweep rather than a thorough one of the first half of the list.
- **One store per machine.** SQLite's locking is for the processes of one machine; don't share the file over
  a network drive. Merging stores from several machines is a known gap, below.
- **Backups:** copy the file while nothing is writing, or at any time run
  `sqlite3 results/arena.sqlite ".backup backup.sqlite"`.

---

## What a result means, and what it doesn't

- **It is relative to the pilot.** `greedy` looks one activation ahead and values damage. The best set for it
  may not be the best set for a stronger player. Screen with a fast agent, re-measure the finalists with the
  strongest one available, and again as the agents improve. Results are stored per agent, so none are lost.
- **It is relative to how the sets were deployed.** Unless an agent chooses, a set starts by the default rule:
  sorted by machine id, centred in its back row. Arrangement matters. On the agent ladder, rearranging the
  standard team across the same five squares cut `heuristic`'s score from 95% to 88%, and a *random*
  arrangement beats the default 60% of the time on Plains and Forests
  ([arena.md](arena.md#starting-positions-already-matter-to-heuristic--and-depend-on-the-board)). A set that is
  strong in one arrangement may not be in another; the store keeps the arrangement of every game, so this can be
  asked of the data.
- **The field is uniform.** "Best against every legal set" is not "best against good sets". Most legal sets
  are weak, and the set that beats them most reliably need not be the one that beats strong sets. The next
  question is how the top sets fare against a field made of top sets. There may also be no single best at
  all: if A beats B, B beats C and C beats A, the answer is a mixture, the equilibrium of the draft, and the
  stored games are exactly the data that computing it needs.

---

## Known gaps

- [ ] **Evolutionary search over starting positions**, and later over sets. The parts are in place — an
      arrangement is a genome (`fixedDeployer`), fitness is a paired match against a baseline or the population,
      and the store keys games on the arrangement, so a candidate seen twice is free. The search itself isn't
      written. Worth doing per board: a random arrangement already beats the default rule on one board and not
      on others ([arena.md](arena.md#starting-positions-already-matter-to-heuristic--and-depend-on-the-board)).
- [ ] **A strength model per machine.** `report machines` is descriptive. A regression of outcome on set
      composition would say what each machine is worth with its partners held fixed, and would predict the score
      of sets that have never been played.
- [ ] **`arena verify`** — replay a sample of stored games under new code and compare final checksums. If a
      change provably leaves play untouched, its old results could be adopted rather than replayed.
- [ ] **Fields other than uniform**, such as `--field top:1000`, to measure sets against strong opposition.
- [ ] **Merging stores** recorded on different machines.
- [x] ~~**Deployment is fixed**, not chosen.~~ Agents may choose where they start; the default rule applies
      only to those that don't ([arena.md](arena.md#choosing-where-to-start)).
- [ ] **Deployment is blind.** Both sides place at once; the house rule's alternating placement, where a
      player can react to what the other has placed, isn't modelled yet.
- [ ] **Tournaments and matches use one core.** Only sweeps take `--jobs`.
