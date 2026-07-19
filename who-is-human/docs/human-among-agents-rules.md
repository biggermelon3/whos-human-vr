# Who is Human — rules

A 7-player game of Werewolf/Mafia with a hidden second layer: **one player is a
human pretending to be an AI agent; the other six are AI agents.** The human
wins on two independent axes.

## Two identities per participant

Every participant has:

1. a **werewolf role** — `werewolf | seer | doctor | villager` (decides the
   standard game), and
2. a **meta identity** — `human | ai` (decides the hidden audit).

The two are independent. The human's werewolf role is assigned **at random**, so
the human might be `human + werewolf`, `human + seer`, `human + doctor`, or
`human + villager`.

## Setup (7 players)

```
2 Werewolves · 1 Seer · 1 Doctor · 3 Villagers
1 of the 7 is the Human · the other 6 are AI
```

Everyone is shown only a **public cover profile** (designation + declared
function + communication style + limitation). The human is handed one of these
and must imitate it.

## Standard win conditions

- **Village** wins when all werewolves are eliminated.
- **Werewolves** win when living werewolves ≥ living non-werewolves.
- If neither happens within `maxDays` (default 5), the standard game is a **draw**.

## Round flow

**Night** — werewolves agree on a kill; the seer inspects one player and learns
only *werewolf-aligned* / *not werewolf-aligned*; the doctor protects one player
(not the same target two nights running). A protected kill is saved.

**Day** — deaths are announced (role revealed on death in this version) →
**opening statements** (each living player names a top suspect) → **open
discussion** (the human speaks; the moderator picks the most-relevant agents to
respond) → **final defense** (the two most-suspected defend) → **vote** (highest
tally is eliminated; a tie triggers a single runoff, then no elimination).

Win is checked after every death.

## The hidden Human Audit (goal B)

When the standard game ends, the **six AI agents each secretly and independently**
name the one participant they believe was the human. Dead and eliminated agents
still vote; the human does **not** vote. No discussion happens before the audit
(to avoid a bandwagon).

The human is **detected** only on a strict majority: **≥ 4 of 6** ballots.

Agents are told to weigh weak human-tells (embodied experience, style shifts
under pressure, references to the interface/real time, off-profile emotion, human
self-justification, over-imitating a "robot" tone, natural grasp of humor) — but
that **no single clue is decisive**, and to keep this suspicion **separate** from
werewolf-role suspicion.

## Final result (2×2 matrix)

```
faction win  + undetected  → PERFECT VICTORY       (2 pts)
faction win  + detected    → FACTION VICTORY        (1 pt)
faction loss + undetected  → INFILTRATION VICTORY   (1 pt)
faction loss + detected    → TOTAL DEFEAT           (0 pts)
draw counts as a faction loss for scoring.
```

Score = (faction won ? 1 : 0) + (undetected ? 1 : 0). The point: **even if you
lose the werewolf game, staying hidden still wins you the match.**
