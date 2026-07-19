# Ember Command — working notes for Claude

## What `design.html` is

`design.html` is the living game design document, rendered as a static styled page (not meant to be edited as prose in isolation — open it and read the rendered structure, since sections cross-reference each other with `<code>` order names and `<strong>` building/unit names that must stay consistent).

Every design claim gets a status tag: `<span class="status done">`, `todo`, or `idea`. `done` means implemented in `app.js`/`index.html`, not just decided. Don't mark something `done` without checking the code; don't leave a decided idea untagged.

## The process we've been using to evolve it

1. **Research real WC2 play** (via WebSearch against strategy guides) when the goal is "what do players actually do," not "what did WC2 implement." The point is player *behavior* — economy pumping, scouting timing, harass patterns — not a feature checklist.
2. **Categorize into the existing order/command vocabulary** rather than inventing new mechanics wholesale. New ideas should map onto or extend `Harvest gold/lumber`, `Explore`, `Attack`, `Defend`, `Patrol`, `Train`, `Build`, `Upgrade` where possible. A genuinely new category (e.g. `Raid` split from `Attack`) gets flagged as an open question, not silently added as a real order.
3. **Apply the abstraction rule consistently**: abstraction removes *spatial/execution decisions* (where to place a building, which unit to click) — it never removes *identity*. Unit and building names, roles, and rough power stay WC2-familiar (Peasant, Footman, Grunt, Town Hall → Keep → Castle, Lumber Mill, Blacksmith). See the "What gets abstracted, and what doesn't" note near the top of the doc — treat it as the standing rule for any new system.
4. **Check for duplication before adding a table row.** This doc had Lumber Mill (Structures) and "lumber harvesting efficiency" (Upgrades) drift into two descriptions of the same thing before being reconciled with a "Source building" column. When adding an upgrade/structure, check both the Structures and Upgrades tables.
5. **New systems get their own `<h2>` section with a one-line framing sentence**, not just a table — say what WC2 mechanic it replaces and why the simplification is still recognizable as WC2.
6. **Open design questions go in `<div class="note">`**, not into the tables as fact. Tables are for decided structure; notes are for tensions/unresolved calls (e.g. army-assignment granularity, Raid vs Attack split, save-on-loss behavior).
7. **We do not implement features when asked to document them.** Several sections (Upgrades, Persistence) were added as `idea`-status design work explicitly *without* touching `app.js`. Don't jump ahead to implementation unless asked.

## Implementing UI/gameplay changes (app.js / styles.css / index.html)

This is a separate mode of work from the design-doc process above — most day-to-day requests are small, concrete UI/interaction tweaks against the running app, not design decisions.

- **Read `ARCHITECTURE.md` first** — it maps the files, `app.js` sections, core
  patterns (data tables, unified jobs, command gates, worker lifecycle), and
  has recipes for adding buildings/units/upgrades/nodes.

- **Every pushed change bumps the version.** In `app.js`: `VERSION` +0.01 and
  rewrite `VERSION_TAG` with a very short description of the change. In
  `index.html`: update both `?v=` query strings to the new version. The
  version + tag show at the top of the in-game menu so the user can verify
  which build they're running regardless of caching.

- The app is `index.html` + `app.js` + `styles.css`, no build step, no framework. `game` (in `app.js`) is the single mutable state object; `render()` fully rebuilds the relevant DOM subtree from it on every change — there's no diffing, so wholesale `replaceChildren()` rebuilds (see `renderWorld()`, `renderOrders()`) are the norm, not something to optimize away.
- Established UI conventions (grouped tiles with count badges, stacked/transparent radial progress rings, tappable queue chips for cancel+refund, icon-only command buttons with overlay cost badges, 14px minimum font, persistent cheat toggles) are documented in `design.html` under **"UI Conventions Established So Far"** — read that before adding a new tile/badge/progress pattern so it matches rather than invents a new one.
- **Watch for layout jump.** Elements whose presence/size depends on transient state (queue chips, disabled buttons) should not shift other elements around when that state changes — prefer `position: absolute` overlays or keeping disabled-but-present elements (`button.disabled`) over conditionally adding/removing grid rows.
- Requests arrive as short, iterative, sometimes voice-dictated messages — filler words and occasional transcription errors (e.g. "the face" meant "the phase" indicator) are normal. Read them against the current screen/code state rather than literally when something doesn't quite parse; ask only if genuinely ambiguous.
- The user drives the app and verifies changes visually themselves — don't proactively spin up headless-browser verification after a change. Explain what changed and why it should work; only reach for a browser check if explicitly asked.
- Icons live in `assets/icons/`, extracted from WC2-style sprite sheets via `tools/label-icons.py` (a one-off labeling UI, not part of the running game).

## Where things stand (as of 2026-07-19)

- `app.js` has been refactored to be table-driven: `BUILDINGS` / `UNITS` /
  `ARMY` data tables generate tiles, commands, tech gates, supply, and raid
  defense; all timed work (training, construction, upgrades) runs through one
  `game.jobs` system. **Adding a building/unit should normally mean editing
  only those tables.** See `REFACTOR_NOTES.md` (status block at top) before
  making structural changes.

- Core loop (workers, harvest, farms, barracks, training) is `done`, plus a layer of UI polish on top: grouped worker/farm/barracks tiles, stacked radial progress bars (2x size, transparent-white, alpha divided by sibling count), staggered game-start worker spawn-in, fast-train/fast-harvest cheat toggles, icon-only square command buttons with overlay cost badges, and a top-right tappable production queue (cancel + refund).
- `Command Categories (from WC2 Strategy Research)`, `Upgrades` (incremental + hall tier), and `Persistence / Save Progress` sections are newly added, all `idea` status — design only, not implemented.
- Known open questions living in notes: army-assignment granularity (aggregate vs. per-unit-type vs. hero override), Raid vs. Attack split, win/loss save behavior.
