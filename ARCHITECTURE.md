# Ember Command — codebase map

Orientation doc for anyone (human or model) editing this repo. Read this
first; `CLAUDE.md` has working conventions, `design.html` the game design,
`REFACTOR_NOTES.md` the history of how the code got this shape.

## Files

| file | role |
|---|---|
| `index.html` | Static shell: top bar (resources, menu), world area, command bar, error toast. No templates — all dynamic DOM comes from `app.js`. |
| `app.js` | Everything: data tables, state, simulation, commands, rendering, input. One file, no modules, no build step. |
| `styles.css` | All styling. Mobile-first; note the `@media (max-height: 760px)` compact overrides and `@media (hover: none)` touch overrides. |
| `design.html` | Standalone rendered game-design doc (own inline styles, not linked to the app's CSS). |
| `assets/icons/` | WC2-style sprite PNGs. Referenced only via the `ICONS` map in `app.js`, cache-busted with `?v=ICON_VERSION`. |
| `tools/label-icons.py` | One-off sprite-sheet labeling UI. Not part of the game. |

## app.js section map (banner comments, in file order)

`Tunables` → `Data tables` → `State` → `Small shared helpers` →
`Workers & resource nodes` → `Timed jobs` → `Stats` → `Army` → `Raid` →
`Tick` → `Commands` → `Selection` → `Render helpers` → `Render` → `Input` →
`Boot`

## Core concepts

### State
One mutable object `game` from `createGame()`. `render()` fully rebuilds DOM
subtrees from it via `replaceChildren()` — no diffing, deliberately. Two
timers: `gameTick` (1s, simulation + render) and `updateProgressRings`
(100ms, redraws progress rings only, interpolating via `tickFraction`).

### Data tables drive content
- `BUILDINGS` — per building: `icon`, `label`, optional `build {cost, time}`
  (worker-constructable), `supply`, `hp` (raiders must raze it), `dmg` (shoots
  back at raiders), `blurb` (info line, string or `fn(state)`), `onBuilt`.
  Generates: `game.structures` keys, structure tiles, the build menu, supply
  cap, tower damage, info text.
- `UNITS` — per trainable unit: `producer` (structure key), `cost`, `time`,
  optional `requires: [structureKey]`, `done(state)`. Generates train
  commands, auto-attached to their producer's command list.
- `ARMY` — per standing-order group (`game.units` keys): `icon`, `label`,
  `singular`, `hp`/`dmg` (raid combat; first listed group soaks damage first),
  `attack` (siege dps vs the enemy base). Generates army tiles, order
  commands, combat.

**Adding a building or unit = one table entry (+ `ICONS` line if a new
sprite).** Times/costs are real WC2 values; every duration is multiplied by
`TIME_SCALE` (via `scaledTime`) when a job starts.

### Raid combat
`game.raids` holds live raiding parties (`{ size, grunt: {hp, dmg}, hpPool,
arriveIn, strikeIn, targetType, targetHp }`). Grunt stats scale with the day
(`RAIDER_HP_PER_DAY` / `RAIDER_DMG_PER_DAY`). `spawnRaid` on the raid
interval (`game.raid.interval` feeds the countdown ring on the enemy tile);
`raidTick` runs volleys every `VOLLEY_EVERY` ticks — patrol strikes during
the approach, defend+patrol+towers after arrival. Raider targeting: warriors
→ towers (`RAID_TOWER_TARGETS`) → workers (wounds pools: `units[k].wounds`,
`game.workerWounds`) → remaining buildings per `RAID_TARGET_ORDER` (hall
last). Alarms go through `flashError`. Cheat buttons can force a raid and
spawn footmen.

### Timed jobs (one system)
`game.jobs` — every in-flight timed thing. Shared shape
`{ uid, kind, icon, label, duration, remaining, cost, complete }` plus:
- `kind: 'train'` → `{ producer, supply }`. Per-producer concurrency =
  building count; queue cap = `QUEUE_MAX ×` building count.
- `kind: 'construct'` → `{ workerId, returnTo }` (builder released back to
  its node — or idle — on completion/cancel).
- `kind: 'upgrade'` → `{ tag }` (used to block duplicate upgrades).

One `advanceJobs`, one `cancelJob` (refund + builder release), one
`jobProgress`, one `jobChip`/`renderJobQueue`. Don't add parallel job arrays.

### Commands
Plain objects: `{ id, icon, label, cost, overlay?, enabled(s), available?(s),
reason?(s), isActive?(s), run(s) }`, resolved per selection by
`selectedCommands`. Semantics:
- `enabled` — actually runnable (includes affordability).
- `available` — non-resource prerequisites only; drives **fading**
  (`commandFaded`). A costed command missing only resources stays lit.
- `reason` — toast text when a disabled command is tapped. Buttons are never
  natively `disabled`; `runCommand` routes refusals to `flashError`.
- Build `available`/`reason` from one `gated([[test, 'reason'], …])`
  checklist so they can't drift.
- Errors → toast only. Gameplay events → `writeLog` (menu log).

### Workers & nodes
Workers `{ id, job: idle|gold|lumber|building, nodeId, cooldown }` are pinned
to a node and harvest it until depletion (then idle). `autoAssignWorkers`
(every tick + on spawn/train) sends idle workers to the first live gold node,
else lumber — idle is transient. `spareWorker` (node harvest tap): idle →
same-resource other node → other resource. `builderWorker` (constructions):
idle → most plentiful node's crew. Harvest cycle =
`HARVEST_GATHER[type] + distance × TRAVEL_PER_DISTANCE`.

### Selection
`game.selected = { kind, type, id }`, kinds `structure | workerGroup | node |
army | enemy`. `validateSelection` (top of `render()`) resets anything that no
longer renders to the town hall — keep `SELECTION_VALID` in sync when adding a
kind. `selected.id` is compared with `String()` (node ids are strings).

### Progress rings
`radialProgressCanvas(p, siblings)` draws one ring. The 100ms animator has
exactly two branches: `.construction-chip[data-job-uid]` and
`.job-badge[data-node-id]`. Anything rendered through `jobChip` or a node
badge animates for free — never add a third lookup scheme.

## Recipes

- **New building**: entry in `BUILDINGS` (+`ICONS`). `build:` puts it in the
  build menu; `supply`/`hp`/`dmg`/`blurb`/`onBuilt` as needed. Done.
- **New trainable unit**: entry in `UNITS` (+`ICONS`); if it's an army group,
  add the `ARMY` entry and have `done` increment `units.<key>.count`.
- **New upgrade**: a command via `gated(...)` calling `startUpgrade` with a
  unique `tag`; block duplicates with `pendingUpgrades(s, tag)`. See
  `guardTowerCommand`.
- **New resource node**: entry in `NODE_DEFS`. Tiles, harvest, depletion,
  auto-assign all follow.
- **New standing order**: add to `makeOrderCommands` and `orderIcon`; hook
  behavior in `gameTick`/`raidTick` via `unitsOnOrder`/`homeGroups`.

## Invariants (don't break)

- Full-rebuild render; no diffing layer, no framework, no build step.
- Mobile input: `pointerup` selection with a 10px move threshold; zoom guards
  must keep exempting interactive controls; `touch-action: manipulation`.
- Error toast is for errors only.
- Balance numbers live in the Tunables block / tables, not inline.
- Cheats (`fastTrain`, `fastHarvest`, +10k) must keep working — they're the
  manual-testing loop.

## Testing

No test files in-repo. For structural changes, a DOM-stubbed smoke test works
well: stub `document`/`performance`/`setInterval`, `eval` app.js, then drive
`gameTick`/`runCommand`/`selectEntity` and assert on `game`. (Pattern used
for the 2026-07 refactor; see REFACTOR_NOTES.md.) The user verifies visually
— don't spin up headless browsers for routine tweaks.
