# FantasyGuru — Design Brief

**For:** Claude Design canvas · v1 Android app
**Status:** Rev 1 · 23 Aug 2026
**Companion doc:** `docs/fantasyguru-v1-spec.html` (build spec — read for context, not for visual direction)

---

## 1. What this is

FantasyGuru is an Android app for people who play fantasy football in **more than one Sleeper league at once**. It does two things:

1. **Shows every league you're in, in one place** — lineups, records, and the players you own across all of them.
2. **Tells you, on Sunday morning, whether any of your lineups are objectively broken** while you can still fix them. Empty slots, players on bye, players ruled OUT.

It is a **safety net, not an advice engine**. It never says "start this guy over that guy." Every statement it makes is a verifiable fact. That restraint is the product's whole character and the design must carry it.

**It cannot fix anything.** The Sleeper API is read-only. Every problem the app surfaces must end in a link that jumps the user into the Sleeper app to make the change themselves. The app's job is to notice, not to act.

### The user

Plays in 3–5 leagues. Checks his phone Sunday morning while doing something else. Has been burned before by starting a player on bye and losing a week to it. Comfortable with dense numbers — this is the person who reads box scores for fun. Does not want a coach; wants a smoke detector.

### The one moment that matters

**Sunday, ~10:00 AM, two to three hours before the 1 PM kickoffs.** A notification lands. He opens the app. In under one second he must know whether he's fine or whether something needs him. Everything else in this design is supporting material for that second.

---

## 2. Aesthetic thesis

> **The interface is monochrome. The only saturated colour on screen is status.**

Slate greys carry the entire UI — surfaces, type, borders, navigation, even the interactive accent, which is a desaturated steel blue that reads as "tappable" and never as "important." Red, amber, and green appear **only** where the app is reporting a condition: a player is out, a slot is empty, a lineup is clean.

This is not a stylistic preference. It is derived from the product's core constraint. The alarm only works if colour means one thing, so colour is spent on one thing. When the screen has a red pixel on it, something is wrong; when it doesn't, nothing is. A user should be able to learn that in one week without being told.

The practical consequence: **do not use colour for branding, decoration, emphasis, illustration, gradients, or category coding.** If a design element needs to stand out, use size, weight, or space.

### Supporting principles

- **Design the calm state first.** Most weeks, for most users, nothing is wrong. "You're set." is the state people will see most often and it must feel like a closed loop — a reward for checking, not an empty screen. If the calm state feels like a placeholder, the design has failed.
- **Dense, not airy.** This is a tool. Over-whitespacing it into a marketing page makes it feel like a toy. Fantasy players are comfortable with a lot of numbers on screen.
- **One big number per row.** Points. Everything else is secondary text at secondary weight.
- **Player identity = team colour bar + position chip.** No headshots (licensing).
- **Speed is part of the look.** Nothing should need a spinner. Where loading is unavoidable, show real progress, not a shimmer.

---

## 3. Platform and canvas setup

| | |
|---|---|
| **Platform** | Android phone. iOS comes later and is explicitly out of scope. |
| **Artboard size** | **412 × 915 dp** — modern Android reference frame (Pixel 8/9 class) |
| **Safe insets** | 24dp status bar at top, 24dp gesture nav at bottom. Draw edge-to-edge; keep content inside the insets. |
| **Built with** | Expo / React Native + NativeWind (Tailwind syntax). Design in constructs that translate: flex layouts, no CSS grid, no floats, no `position: sticky`. |
| **Material 3** | Follow its ergonomics — touch targets, bottom nav, elevation logic — but **not** its visual identity. This should not look like a stock Material app. |
| **Dynamic colour** | **Opted out.** Material You would let the system recolour the UI, which would destroy the status vocabulary. Palette is fixed. |
| **Themes** | Dark is primary and is what to design first. Light theme tokens are provided and should be designed as a genuine second version, not an inversion. |
| **Minimum touch target** | 48 × 48 dp |
| **Screen padding** | 20dp horizontal |

---

## 4. Design system

### 4.1 Colour — dark theme (primary)

```
ground            #0A0E13    app background
surface           #121922    cards, sheets, list rows
surface-raised    #1A2430    pressed states, elevated sheets
line              #253140    hairline dividers
line-strong       #344354    borders that need to read as edges

text              #E9EEF4    primary
text-2            #96A3B1    secondary — metadata, labels
text-3            #64717E    tertiary — disabled, timestamps

accent            #7FA3CC    interactive only: links, selected tab, focus ring
accent-pressed    #A0BFE0
```

**Status — the only saturated colour in the app:**

```
critical          #FF6F5E    on-ground: #2E1512
warning           #F5B33C    on-ground: #2C2110
ok                #4FD99B    on-ground: #10281E
neutral           #7C8B99    informational, no urgency
```

### 4.2 Colour — light theme

```
ground            #F4F6F8
surface           #FFFFFF
surface-raised    #EBEFF3
line              #DDE3EA
line-strong       #C2CBD5

text              #101720
text-2            #5A6773
text-3            #8593A0

accent            #2F5F94
accent-pressed    #1F4675

critical          #C4342A    on-ground: #FBE9E7
warning           #96620A    on-ground: #FCF2DF
ok                #10653F    on-ground: #E3F3EA
neutral           #64717E
```

### 4.3 Type

Three faces, three jobs. All available on Google Fonts.

| Role | Face | Used for |
|---|---|---|
| **Display** | **Archivo** 600/700 | The verdict, big point totals, screen titles |
| **UI** | **IBM Plex Sans** 400/500/600 | Everything a person reads as a sentence |
| **Data / label** | **IBM Plex Mono** 500/700 | League names in metadata rows, timestamps, uppercase labels, tabular figures |

The mono face doing the *labelling* work is deliberate — it makes league names and timestamps read as machine facts rather than as content, which keeps the visual hierarchy pointed at the verdict.

**Scale (dp):**

```
verdict     34 / 38    Archivo 700, -0.02em
title       24 / 30    Archivo 700, -0.015em
heading     19 / 25    Archivo 600
body        15 / 22    Plex Sans 400
body-strong 15 / 22    Plex Sans 600
small       13 / 18    Plex Sans 400
label       11 / 14    Plex Mono 700, uppercase, +0.09em
data        15 / 20    Plex Sans 600, tabular-nums
```

Any column of numbers uses **tabular figures**. Always.

### 4.4 Space, shape, motion

```
spacing     4 · 8 · 12 · 16 · 20 · 24 · 32 · 40
radius      card 12 · chip 6 · pill 999 · sheet 20 (top only)
elevation   no drop shadows — separate surfaces by value and hairline only
motion      120ms ease-out for state, 220ms for sheets. Nothing decorative.
            Honour reduced-motion.
```

### 4.5 Core components

**Severity chip** — 11dp mono uppercase, 3/8dp padding, radius 6, status colour on its own tinted ground.

**Problem row** — a 3dp full-height severity bar on the left, then a two-line block (bold problem statement / mono league name), then a right-aligned `FIX →` affordance in accent. The whole row is one 56dp+ touch target.

**League card** — league name in mono label, record and this week's matchup below, a single status dot on the right (ok / warning / critical) so the home screen scans vertically as a column of dots.

**Player row** — 3dp team-colour bar, name in body-strong, position + team + opponent in small text-2, points right-aligned in data. Injury status as a chip only when it is not "healthy."

**Bottom navigation** — 3 destinations: **Home · Players · Live**. Settings lives behind an avatar in the header, not in the nav. Selected tab uses accent; unselected uses text-3. Labels always visible.

---

## 5. Artboards to produce

Ten artboards, laid out in three rows on the canvas: **onboarding** (1–2), **core loop** (3–7), **system surfaces** (8–10).

| # | Artboard | Its job |
|---|---|---|
| 01 | **Cold open** | One input: Sleeper username. No password, no signup. The value proposition in one sentence above it. This screen's entire purpose is to look like it will take ten seconds — because it does. |
| 02 | **Finding your leagues** | The 4–8 second load after submitting. Show real progress, named: "Found 4 leagues → Loading rosters → Checking lineups." This is the first impression of competence. |
| 03 | **Home — calm** | The verdict "You're set." plus the league list. Most-seen screen in the app. Must feel resolved, not empty. |
| 04 | **Home — alarm** | The verdict "3 things need you." plus the problem list, then the league list below. The screen the whole product exists for. |
| 05 | **League detail** | One league's starting lineup with status, bench below, and the week's matchup score at top. |
| 06 | **Players** | Every player you own, across all leagues, with which leagues they're in and whether they're started or benched in each. This is the cross-league view nothing else can offer. |
| 07 | **Live** | Sunday afternoon. All four matchups, one screen, updating. The screen people leave open. |
| 08 | **Notification** | Android lock screen and expanded notification shade, showing the aggregated alarm. Design the notification as a first-class surface — for many users it *is* the product. |
| 09 | **Notification permission** | Android 13+ requires a runtime permission prompt. Design the *pre-prompt* that earns it — shown after the user has seen their leagues, never on first launch. |
| 10 | **Empty & error** | Three states stacked in one artboard: username not found, no leagues in this season, and Sleeper unreachable. |

Optionally, if the canvas has room: **11 — Alarm settings** (quiet hours, per-league mute, channel choice). Useful because it is where the app's notification restraint becomes visible to the user.

---

## 6. Real content to use

Use this content verbatim. It is internally consistent — the week, the bye teams, and the alarms all agree with the real 2026 NFL schedule.

> **Note on accuracy:** player names are real; **team assignments, injury designations and point totals below are invented for layout purposes**. Bye weeks are real (Week 6 byes in 2026 are Cincinnati, Detroit, Miami, Minnesota).

**Context for every screen:** Sunday, October 18, 2026 · 10:14 AM · Week 6 · first kickoff 1:00 PM ET, so "2h 46m until kickoff."

### The user's four leagues

| League name | Format | Record | This week |
|---|---|---|---|
| Dynasty Degenerates | 12-team PPR | 4–1 | 88.4 vs 71.2 |
| The League of Ordinary Gentlemen | 10-team Half-PPR | 2–3 | 64.1 vs 79.8 |
| Sunday Scaries | 12-team Superflex | 5–0 | 102.6 vs 90.3 |
| Office Money League | 10-team Standard | 3–2 | 71.9 vs 71.4 |

### The three alarms (artboard 04)

1. **Critical** — "Jahmyr Gibbs is on bye — starting at RB2" · DYNASTY DEGENERATES
2. **Critical** — "Empty FLEX slot" · SUNDAY SCARIES
3. **Info** — "You started Bijan Robinson here, benched him in Sunday Scaries" · OFFICE MONEY LEAGUE · CROSS-LEAGUE

The third one is the app's signature move — the thing no single-league tool can know. Give it visual distinction without giving it urgency.

### Calm state copy (artboard 03)

- Verdict: **"You're set."**
- Sub: "All 4 lineups are legal and healthy. Next check at 11:30."

### Sample lineup rows (artboard 05 — Dynasty Degenerates)

```
QB    Jalen Hurts        PHI  vs DAL          21.4
RB    Bijan Robinson     ATL  @ SF            18.2
RB    Jahmyr Gibbs       DET  — BYE            0.0   [BYE]
WR    Puka Nacua         LAR  vs SEA          14.8
WR    Nico Collins       HOU  @ IND           11.6
TE    Trey McBride       ARI  vs TB            9.3
FLEX  Jaxon Smith-Njigba SEA  @ LAR           13.1
K     Jake Bates         DET  — BYE            0.0   [BYE]
DEF   Broncos            DEN  vs LV            6.0
```

### Players screen sample (artboard 06)

```
Bijan Robinson    RB · ATL      3 leagues    started 3 / 3
Puka Nacua        WR · LAR      2 leagues    started 2 / 2
Jahmyr Gibbs      RB · DET      2 leagues    started 1 / 2   [BYE]
Trey McBride      TE · ARI      2 leagues    started 1 / 2
Jalen Hurts       QB · PHI      1 league     started 1 / 1
```

### Notification copy (artboard 08)

- **Title:** FantasyGuru
- **Body:** "2 lineups need you — 2h 46m until kickoff"
- **Expanded:** the two critical items, one per line, plus "Open" and "Snooze until 11:30" actions.

Never one notification per problem. Always aggregated.

### Permission pre-prompt copy (artboard 09)

- Heading: "Want a heads-up on Sunday morning?"
- Body: "We'll check your lineups at 10am and only message you if something's actually broken. Most weeks you won't hear from us."
- Primary: "Turn on alerts" · Secondary: "Not now"

That second sentence is the promise the whole notification design has to keep.

---

## 7. Copy voice

- **Plain, short, declarative.** "Jahmyr Gibbs is on bye." Not "Warning: potential lineup issue detected."
- **Never hedge on a fact.** The app only reports things it knows for certain, so it should sound certain.
- **Never give advice.** No "consider starting," no "we recommend." The app reports; the user decides.
- **Second person, present tense.** "You're set." "2 lineups need you."
- **Time is always concrete.** "2h 46m until kickoff," never "kickoff soon."
- **No exclamation marks. No emoji in the UI.**

---

## 8. Anti-goals

- ✗ Do not use green/amber/red for anything that isn't a status.
- ✗ No gradient heroes, no glassmorphism, no neon glow, no card with a coloured left rail used decoratively.
- ✗ No headshots, team logos, or NFL marks — licensing.
- ✗ No streaks, badges, XP, confetti, or gamification of any kind. The reward is being told the truth in time.
- ✗ No dashboard-style stat tiles or donut charts on the home screen. The verdict is the summary.
- ✗ No stock Material 3 look — no filled tonal buttons in system purple, no default M3 chips.
- ✗ Do not design the calm state as an afterthought.

---

## 9. Success test

Hold the phone at arm's length, squint, and look at Home for one second.

**You should be able to tell whether anything is wrong without reading a single word.**

If that isn't true, the verdict isn't big enough, or there's colour somewhere that shouldn't be.
