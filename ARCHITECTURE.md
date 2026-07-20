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
- `ARMY` — per unit type: `icon`, `label`, `singular`, `hp`/`dmg` (raid
  combat; first listed type soaks damage first within a pool), `attack`
  (siege dps vs the enemy base). Units live in per-order pools:
  `game.army[order] = { footmen, archers, wounds }` for each of `ORDERS`
  (defend/patrol/explore/attack). Army tiles are one per ORDER; selecting one
  offers per-type move commands — (type present × other order) buttons, unit
  icon with order overlay; tap moves one, hold moves all of that type
  (`armyGroupCommands`, built dynamically per render).

**Adding a building or unit = one table entry (+ `ICONS` line if a new
sprite).** Times/costs are real WC2 values; every duration is multiplied by
`TIME_SCALE` (via `scaledTime`) when a job starts.

### Raid combat
`game.raids` holds live raiding parties (`{ kind, icon, label, size,
grunt: {hp, dmg}, hpPool, arriveIn, strikeIn, targetType, targetHp }`).
`RAIDER_TYPES` is the enemy roster — one party per active type per wave
(grunts wave 1+, axethrowers wave 4+); stats and headcount scale per WAVE
(`game.raid.wave`), defense damage splits across simultaneous parties, and
each raider killed pays its `bounty` in plunder gold. `spawnRaid` on the raid
interval (`game.raid.interval` feeds the countdown ring on the enemy tile);
`raidTick` runs the two sides on offset cadences — my side volleys every
`DEFENSE_VOLLEY_EVERY` (2) ticks, raiders every `RAID_VOLLEY_EVERY` (3) once
arrived. Combat is staged by zone (`raid.atBase`): a raid approaches through
the near zone (patrol fires at it the whole way), then on arrival fights the
patrol there — two-way, patrol only, no defenders or towers — and only once
the patrol is wiped (or was never there) does it break through to the base
zone, where defenders + towers engage it. The breakthrough is sticky: a
patrol re-formed afterwards is bypassed. `defenseDamage(state, raid)` is
stage-aware (near: patrol pool; base: defend pool + towers), and my volley
splits across parties in the same stage. Waves spawn silently and
undiscovered; a standing patrol spots them instantly at spawn (and any patrol
raised mid-approach picks them up next tick) — otherwise the raid appears
only on arrival. Army tiles show the dominant unit type as the primary
icon with the order as a corner badge; a column mid-march renders as its own
tile beside the destination group (kind `march`, badge ring = march
progress, no blinking) and tapping that tile recalls the column. The scouts'
wilderness tile carries an `exploreRing` — progress from the last discovery
milestone to the next. Production chips stay above the town hall. Wound
regen: defenders only (`HEAL_DEFEND_PER_TICK`), paused while a raid is at
the base; no other order heals. Raider targeting: patrol
pool → defend pool → towers (`RAID_TOWER_TARGETS`) → workers → remaining
buildings per `RAID_TARGET_ORDER` (hall last). Explore/attack pools are away
from the base: they neither fight raids nor get targeted. Wounds pools:
`army[order].wounds`, `game.workerWounds`. Alarms via `flashError`
('Patrol spotted enemies approaching!' on discovery, 'Our patrol engages the
raiders!' on arrival with a patrol standing, 'Our town is under attack!' on
breakthrough, 'Our town is being razed!' once warriors are gone). Cheat buttons
can force a raid and spawn footmen.

### Conquerable sites
`SITES` defines garrisoned mini-bases in the far field (guards + watch towers
per `SITE_TOWER`); instances live on `game.sites` with garrison state and up
to three of our columns each: `march` (heading out, `SITE_MARCH_TICKS`),
`strike` (fighting there), `returning` (heading home). Exploration reveals
them like distant nodes — and the scouts that find a garrisoned site storm
it on the spot: the whole explore pool becomes `site.strike` and scouting
pauses until fresh scouts are sent (node finds don't interrupt). Scouts
render as their own `.site-big` wilderness tile (vision badge, kind
`army:explore`) in the sites row, not in the away section. Selecting a site (`kind: 'site'`, keyed by
`site.key`) offers per-type assault commands pulling from the **defend** pool
(tap one / hold all); there is no recall — an assault commits until the
fight resolves. `siteTick` runs the fight on the raid
cadences — our volley chews guards then towers; the garrison hits the strike
pool (`damageStrike`) — and `conquerSite` applies the reward ({cache} pays
out, {nodeId} reveals a `discoverAt: Infinity` node, {units} join the
survivors) and sends everyone home to defend. Expedition units count toward
supply (`siteUnits` in `supplyUsed`); a wiped strike leaves garrison damage
standing. Renders in the far zone as one double-size tile (`.site-big`) of shared
terrain art (`siteTerrain`) with a `rewardIcon` badge top-left,
garrison chips down the right edge, our column's chip bottom-left (blinking
while marching/returning), red garrison hp bar plus a green strike bar.

### Timed jobs (one system)
`game.jobs` — every in-flight timed thing. Shared shape
`{ uid, kind, icon, label, duration, remaining, cost, complete }` plus:
- `kind: 'train'` → `{ producer, supply }`. Per-producer concurrency =
  building count; queue cap = `QUEUE_MAX ×` building count.
- `kind: 'construct'` → `{ workerId, returnTo }` (builder released back to
  its node — or idle — on completion/cancel).
- `kind: 'upgrade'` → `{ tag }` (used to block duplicate upgrades).
- `kind: 'transfer'` → `{ from, to, type, count }` — a timed order-change
  march (`transferTicks` = base + remoteness of both ends). Units leave the
  source pool at start, are delivered by `advanceJobs` (no `complete`), count
  toward supply while marching, and cancelling recalls them to `from`.
  Same-route moves merge into the marching column. Moves TO 'explore'
  skip the job entirely — units join the explore pool instantly.

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
- `runAll` — optional bulk variant fired by press-and-hold (`HOLD_MS` in the
  orders-bar pointer handlers); tap still runs `run` once.
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

### Tile feedback (flashes + hp bars)
`flashTile(key, 'damage'|'spawn')` registers a transient flash for a tile key
(`kind:type:id`); `entityButton` applies the class while fresh (`FLASH_MS`).
Pass `hp: { segments, partial, total }` (from `poolHp`/`raidHp`) to
`entityButton` for the segmented hp bar (green for own tiles, red under
`.danger`).

### Progress rings
`radialProgressCanvas(p, siblings)` draws one ring. The 100ms animator has
exactly three branches: anything carrying `data-job-uid` (construction chips
and march-tile badges), `.job-badge[data-node-id]`, and the scouts'
`.job-badge[data-explore-ring]`. Reuse these data attributes — never add a
fourth lookup scheme.

### Tech, discovery, endgame
`TECH` (lumber/weapons/armor: source building, per-tier icons/costs/times)
generates `techCommand`s on their source structures; levels in `game.tech`
are read by `harvestYield`/`unitDmg`/`unitHp`. Nodes with `discoverAt > 0`
start hidden; exploration accumulates past the enemy-base find and reveals
them. `game.over = { won, day }` freezes the sim and shows the #gameover
overlay (hall destroyed = defeat, enemy base at 0 = victory; tap reloads).

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
- **New conquerable site**: entry in `SITES` (+`ICONS` if a new sprite);
  a `nodeId` reward needs its `NODE_DEFS` entry with `discoverAt: Infinity`.
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
