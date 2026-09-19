# AI heuristics — experiment design

A running list of heuristics and ideas to test on the AI agents, each with **its own metrics**.

Every entry gets metrics of its own because Elo alone can't tell a good idea from a lucky one. An agent can climb
the ladder for the wrong reason — exploiting a bug, or beating a baseline that has an unrelated weakness — and
the rating looks the same either way. Each experiment therefore names what it expects to change, how that will be
measured, and what result would falsify it.

Tooling shared by every entry: the [arena](arena.md) for ratings, and the **replay viewer and game-health
metrics** built for H0 below.

---

## Template for a new entry

```markdown
## Hn — <short name>

**Question.** What are we trying to find out, in one sentence?
**Hypothesis.** What do we expect, and why?
**Method.** Agents, boards, teams, number of games, seeds.
**Metrics.** What gets measured, what counts as success, and what would falsify the hypothesis.
**Status.** Checklist.
**Results.** Numbers, with error bars, and the commit they were measured at.
**Findings.** What we learned, including anything unexpected.
```

---

## H0 — Are the games real?

**Question.** Are the games the arena plays actually the games we think they are — or is something going wrong
behind the scenes that the ratings are hiding?

**Why first.** Every later entry trusts the arena. If games are degenerate — agents never engaging, rules not
firing, the engine doing something it shouldn't — then every rating built on them is measuring the bug. This
entry is the foundation the rest stand on.

**Method.** Pull a game at random from the ones the arena plays, and watch it move by move with a battle report
of what happened. Then measure the same things across many games so one odd replay can be told apart from a
pattern.

### How to use it

**In the browser** — landing page → **Watch an AI game**. A random game loads straight away.

| Key | |
|---|---|
| <kbd>←</kbd> <kbd>→</kbd> | Back or forward one move |
| <kbd>↑</kbd> <kbd>↓</kbd> | Jump to the previous or next attack |
| <kbd>Home</kbd> <kbd>End</kbd> | First or last move |

**Random game** picks a seed from 1–50 and a random side to move first, so it is literally one of the games
`arena tournament --pairs 50` plays. **Game options** changes the agents, board, team and corruption.

**From the command line:**

```bash
npm run arena -- record --a heuristic --b greedy
npm run arena -- health --a heuristic --b greedy --games 100
```

`record` saves a random game to `replays/` (git-ignored — any game can be regenerated from its seed), which
the viewer opens with **Load replay file**. `health` runs the metrics below over many games.

### What the battle report shows

For each move: who acted, where they went, the direction they ended up facing, whether they attacked or
overcharged, and how many legal options they chose from. Then every consequence, in two sections:

1. **What happened** — the effects of the activation itself.
2. **Start of Player N's turn** — what the turn change did afterwards: blight spreading, corruption damage,
   Spray, Whiplash.

Keeping these separate matters. Without it, corruption damage at the start of a turn reads as if the previous
attack caused it.

**The effects are not copied from the engine's log.** They are worked out by comparing the board before and
after the move, so the report is a second, independent account. If the log says *"hits for 3"* and the health
bar moved by 2, the two will visibly disagree instead of one repeating the other. The raw engine log is still
there, collapsed under each section.

On the board: the acting machine's start and end squares are lit, a faded copy marks where it started, damage
shows as red **−N** badges, and destroyed machines stay faded and greyed where they fell.

### Why you can trust what you see

A replay file doesn't store board states — only the setup and every decision made. Viewing one **re-runs the
engine from scratch**, and each step carries a fingerprint (checksum) of the state the original game reached. So
the viewer doesn't just show what happened — it proves the engine *reproduces* it. It checks every step for:

- the state differing from the recording — **the replay has diverged**
- a chosen activation that was not legal in that position
- a different number of legal options than the agent was offered
- a player passing while it had legal moves
- the engine carrying on after the game was already won

Any problem turns that step red in the list and raises a banner in the report. These checks have been seen to
fire: the test suite tampers with recordings on purpose and confirms each one is caught. A detector that has
never been seen to go off proves nothing.

A replay recorded on the command line and opened in the browser re-executes **exactly** — so the Node engine and
the browser engine agree, step for step.

### Metrics

| Metric | What it measures | Healthy | Red flag |
|---|---|---|---|
| **Re-execution** | Replay reproduces the recording at every step | exact | any problem at all |
| **First attack** | Round agents first make contact | round 1–3 | never, or very late — agents are not engaging |
| **Attacks P1 / P2** | Aggression per side | both sides attack | one side never attacks |
| **Declined attacks** | An attack was on offer and not taken | occasional | frequent from `greedy`, which should almost always take them |
| **Machines lost** | Attrition per side | — | pieces vanishing without an attack or blight to explain it |
| **Options per decision** | Real branching factor | ~200–300 | near 0 (something is walling agents in) |
| **Passes** | Turns passed | 0 | any pass made while legal moves existed |
| **Idle machines** | Alive all game, never activated | rare | common — agents are using a fraction of their set |
| **Oscillations** | A machine stepping straight back to where it was | ~0 | frequent — the evaluation has flat spots and the agent is dithering |
| **Sprints / overcharges** | Use of those mechanics | some | zero — the mechanic is effectively dead in agent play |
| **Defense breaks** | Attacks into equal-or-higher Combat Power | — | — (information) |
| **Terrain changes** | Terrain skills firing | depends on the team | zero when the team has terrain skills |
| **Blight at end** | How far corruption got | — | — (information) |
| **How it ended** | 7 VP, elimination, or time | — | hitting the activation cap — not a real ending |

### Status

- [x] Games recorded through the same code path the tournament uses, not a parallel copy
- [x] Replay format: setup plus decisions, with a checksum per step
- [x] Re-execution checks, each tested by tampering on purpose
- [x] Replay viewer in the web app, with arrow-key stepping and a battle report
- [x] Random game from the tournament's own seed range, one click
- [x] Command line: `arena record` and `arena health`
- [x] Command-line recordings re-execute exactly in the browser
- [x] Baseline measured over 100 games
- [ ] Watch a sample of games by eye and note anything the metrics don't capture
- [ ] Repeat the baseline on every board and team, not just the defaults

### Results — baseline

`heuristic` vs `greedy`, 100 games, sides alternating, Plains and Forests, standard team, corruption on:

```
re-execution problems   0
rounds                  4.7 average
first attack            round 1.6 average
options per decision    229
attacks declined        2.7 per game
games with a pass       0 of 100
games with idle machines 56 of 100
oscillations            0.2 per game
sprints / overcharges   6.8 / 2.7 per game
defense breaks          0.1 per game
terrain changes         0.0 per game
blight tiles at end     7.8 of 64
how games ended:        100 of 100 by reaching 7 VP
```

**The short answer: the games are real.** They re-execute exactly, the agents engage early, and every game ends
in a genuine win. But H0 found one real bug and three things that aren't what you'd imagine.

### Findings

**1. The engine kept playing after the game was won — fixed.** Found while designing the battle report, before the
viewer even worked. In 57 of 198 games, after the winning blow landed, the engine rolled straight on into the next
player's turn and spread the blight across a finished board. The score happened not to change in that sample, but
it could have: corruption damage or a Spray kill after the win would have awarded points to a game already
decided. A finished game now stays finished. It has a regression test, and the viewer checks for it on every step.

**2. The heuristic agent doesn't manage its facing.** When moving without attacking, it ends up facing forward
24% of the time, sideways 47%, and backward 29% — statistically what a coin toss gives (25 / 50 / 25). And its
machines are struck on a weak side 30% of the time, barely better than `random`'s 36%.

The cause is in the evaluation: it only scores facing against enemies that can reach a machine *right now*. On
an approach move nothing can reach it yet, so all four facings score the same and the tie is broken at random —
which is how, on move 1 of the first replay watched, a Stalker marched forward and turned its weak back towards
the enemy. **So `heuristic`'s 95% win rate is not coming from facing play at all**, in a game where facing is the
entire defence. That makes it the most obvious thing to test next.

**3. Agents use a fraction of their machines.** In 56 of 100 games, at least one machine stays alive the whole game
and is never activated. With games lasting under five rounds there are only about ten activations per side, so
some concentration is rational — but more than half of all games is high enough to watch for.

**4. Some mechanics never happen with the default team.** Terrain changes: **0.0** per game, because the standard
team has no terrain skills. Defense breaks: 0.1 per game. The blight reaches about 8 of 64 tiles before the game
is over. Any conclusion about those mechanics drawn from default arena games is drawn from almost no data. Testing
them needs teams built around them.

### Candidates this surfaced

Not scheduled — listed so they aren't lost:

- **Facing-aware evaluation** — score facing against enemies that could reach a machine *next turn*, not only
  right now (finding 2).
- **Spreading activations** — does using more of the set win more, or are idle machines a correct choice
  (finding 3)?
- **Mechanic-focused teams** — draft-book sets built around terrain skills, Pull and Swoop, so their effect on
  play can be measured at all (finding 4).
