# Ember Command — codebase map

Orientation doc for anyone (human or model) editing this repo. Read this
first; `CLAUDE.md` has working conventions, `design.html` the game design,
`REFACTOR_NOTES.md` the history of how the code got this shape.

## Files

| file | role |
|---|---|
| `index.html` | Static shell: top bar (resources, menu), production queue strip, world area, command bar, error toast. No templates — all dynamic DOM comes from `app.js`. |
| `app.js` | Everything: data tables, state, simulation, commands, rendering, input. One file, no modules, no build step. |
| `styles.css` | All styling. Mobile-first; note the `@media (max-height: 760px)` compact overrides and `@media (hover: none)` touch overrides. |
| `design.html` | Standalone rendered game-design doc (own inline styles, not linked to the app's CSS). |
| `assets/icons/` | WC2-style sprite PNGs. Referenced only via the `ICONS` map in `app.js`, cache-busted with `?v=ICON_VERSION`. |
| `tools/label-icons.py` | One-off sprite-sheet labeling UI. Not part of the game. |

## app.js section map (banner comments, in file order)

`Tunables` → `Data tables` → `State` → `Small shared helpers` → `Zones` →
`Workers & resource nodes` → `Timed jobs` → `Stats` → `Army` →
`Raid combat` → `Garrison combat` → `Tick` → `Commands` → `Selection` →
`Render helpers` → `Render` → `Input` → `Boot`

## Core concepts

### State
One mutable object `game` from `createGame()`. `render()` fully rebuilds DOM
subtrees from it via `replaceChildren()` — no diffing, deliberately. Two
timers: `gameTick` (1s, simulation + render) and `updateProgressRings`
(100ms, redraws progress rings only, interpolating via `tickFraction`).

### The world is a linear stack of zones
`game.zones` — index 0 is home; higher indices reach outward. Each zone owns
its own `nodes`, `structures`, `structureDamage`, defenders (`zone.army`, one
pool per zone with per-type counts + shared `wounds`), and — while `status`
is `'occupied'` — a `garrison` plus our attacking `strike` column. The zone
accessors (`zoneById`, `zoneByIndex`, `homeZone`, `ownedZones`,
`deepestOwned`, `chartingZone`, `frontierZone`, `nodeZone`,
`totalStructures`) are the only sanctioned way to reach zone contents.

`makeZone(index, wave)` rolls a new zone: 1–2 nodes from `ZONE_NODE_POOL`
(zone 1 is always neutral with gold + lumber via `goldAndLumberNodes`), and a
garrison from `GARRISON_POOL` at `ZONE_OCCUPY_CHANCE` (60%) — except
`STRONGHOLD_DEPTH` (8), which always holds the scripted `STRONGHOLD`; razing
it wins. `scaleGuards` toughens garrisons with both depth and the raid-wave
counter at generation time. `ensureFrontier` keeps exactly one uncharted zone
past the deepest owned one; its contents are rolled immediately but hidden
(`discovered: false`) until scouts arrive. Charted empty zones flip straight
to `owned`; occupied ones must be assaulted.

### Data tables drive content
- `BUILDINGS` — per building: `icon`, `label`, optional `build {cost, time,
  requires, requiresTier}` (worker-constructable; `requiresTier` gates on
  `game.hallTier`), `supply`, `hp`, `dmg` (fires at raids in its zone),
  `blurb(state, zone)`. The hall itself is buildable (1000g 600w) to plant a
  **forward base** in any owned zone; only home's hall is the loss condition
  and only it upgrades tiers.
- `UNITS` — per trainable unit: `producer`, `cost`, `time`, `requires`,
  `done(state, zone)`. Trained units join the producing **zone's** defenders;
  workers join its workforce.
- `ARMY` — footmen, knights, archers, ballistas: `icon`, `label`,
  `singular`, `hp`/`dmg` (listed first soaks first within a pool), `attack`.
- `GARRISON_POOL` / `STRONGHOLD` — garrison templates (guards + watch towers
  per `SITE_TOWER`, `reward` of {cache}/{units}/{workers}, `rewardText`,
  `rewardIcon`); `HOME_NODES` / `ZONE_NODE_POOL` — resource-node templates.
- `TECH` — lumber/weapons/armor/ballista tracks (source building, per-tier
  icons/costs/times). Tech is global: researched at any copy of the source,
  applies everywhere. One research at a time per source building
  (`upgradeSlotFree`) — more blacksmiths = more parallel slots.
- `HALL_TIERS` — Keep (needs barracks) then Castle (needs stables);
  `game.hallTier` on home's hall only. Each tier +600 hall hp, +4 supply
  (`hallTierBonus`, `buildingMaxHp`); Keep gates the Stables via
  `build.requiresTier`.

**Adding a building/unit/garrison/node = one table entry (+ `ICONS` line).**
Times/costs are real WC2 values; every duration is multiplied by
`TIME_SCALE` via `scaledTime` when a job starts.

### Orders
`ORDERS = ['defend', 'explore']` — patrol and attack are gone. A stationed
unit defends the zone it stands in; exploring is marching to chart the next
zone; attacking a garrison is a zone assault. There are no order pools —
`zone.army` is the defend pool of that zone.

### Economy (per zone)
A worker belongs to a zone (`worker.zoneId`) and pins to a node there until
depletion, then idles; `autoAssignWorkers` re-places idle workers **within
their own zone** (preferred resource `worker.pref` first, then gold, then
lumber). Harvest cycle = `HARVEST_GATHER[type] + distance ×
TRAVEL_PER_DISTANCE + depotDistance × HARVEST_DEPOT_TRAVEL` — the depot haul
is zones-to-nearest hall (gold/lumber) or lumber mill (lumber), so forward
halls/mills speed up remote harvesting. `spareWorker` (harvest tap: idle →
same-resource → other-resource, same zone only); `builderWorker(state, zone)`
(idle in zone → any idle → richest crewed node anywhere; settles in the zone
it built in). Repair rides the construct machinery (`startRepair`,
`REPAIR_HP_PER_TICK`); building damage is per zone (`zone.structureDamage`)
and persists until repaired.

### Moving between zones
`startTransfer(state, fromId, toId, type, count, mode)` — a timed `transfer`
job (`transferTicks` = `TRANSFER_BASE_TICKS` + zones crossed ×
`ZONE_MARCH_PER_STEP`); units leave the source zone's pool immediately,
count toward supply in transit, merge into same-route columns, and are
delivered by `arriveColumn`. `mode` ∈ move | explore | assault (sets the
march-tile overlay icon and arrival behavior). `exploreFrom` marches units
at the uncharted zone (creating it if needed); arrival reveals it — empty
ground is claimed, a garrison starts a fight. The **move arm**
(`game.moveArm`) is the one-at-a-time flow: a Move command arms a source
(worker crew / idle worker / unit type), then each tap on a destination zone
(or a specific resource node — which retasks the worker to that resource)
moves exactly one; tapping elsewhere disarms.

### Raid combat
`RAIDER_TYPES` roster (grunts wave 1+, axethrowers 6+, ogres 9+, catapults
12+; gentle ramp, per-party offset volley phases via `foeDelay`). Raids
spawn beyond the **deepest owned zone** and march inward zone by zone
(`raid.index`, `ZONE_MARCH_PER_STEP` between zones), fighting whichever
owned zone they reach: that zone's defenders + towers fire
(`defenseDamage`; siege parties are immune to towers), raiders answer on
their cadence with targeting defenders → towers → workers → buildings
(`RAID_TARGET_ORDER`, home hall's fall = defeat; `siege` parties shell
buildings only). A zone with no defenders, workers, or buildings is
"subdued" and the raid marches on inward. Killed raiders drop `bounty`
plunder. Spawn interval shrinks per day but every once-occupied zone we
cleared (`zone.wasOccupied`) adds `RAID_OUTPOST_RELIEF` back. Defender regen
is per zone (paused while a raid fights there); workers mend slowly, paused
while any raid is at a zone.

### Garrison combat (occupied zones)
Units marched into an occupied zone become `zone.strike` and exchange
volleys with the garrison on the raid cadences — guards soak first, then
watch towers fall. Garrisons **reinforce** while under attack
(`GARRISON_REINFORCE`: +1 guard every 7 ticks up to 10). `conquerZone` on
clearing: reward pays out ({cache} instantly, {workers} spawn into the
zone, {units} join), **survivors + freed units settle as the zone's
defenders**, status flips to `owned`, `wasOccupied` marks it for raid
relief; the stronghold (`final`) wins the game. A wiped strike leaves
garrison damage standing. Garrison composition is veiled in the UI until
our own column engages.

### Timed jobs (one system)
`game.jobs` — shared shape `{ uid, kind, icon, label, duration, remaining,
cost, complete }` plus:
- `kind: 'train'` → `{ producer, zoneId, supply }`. Keyed per producer per
  zone: N barracks in a zone train N at once, queue cap `QUEUE_MAX × N`.
- `kind: 'construct'` → `{ workerId, zoneId, returnTo, repairKey? }`.
- `kind: 'upgrade'` → `{ tag, source }` (`tag` blocks duplicate tracks,
  `source` enforces one research per source building). Never takes a worker.
- `kind: 'transfer'` → `{ from, to, type, count, mode }` (zone ids).
One `advanceJobs`, one `cancelJob` (refund + builder release / column
recall), one `jobProgress`, one `jobChip`. Chips live in the fixed-height
`#queue` strip under the resource bar (`renderQueueStrip`). Don't add
parallel job arrays.

### Commands
Plain objects `{ id, icon, label, cost, overlay?, hidden?, enabled(s),
available?(s), reason?(s), run(s), runAll?(s) }`, resolved per selection by
`selectedCommands`; everything acts on `selectedZone(state)` (falls back to
home). `zoneCommands`: an uncharted zone offers per-type **explore** sends
from the owned zone behind it; an occupied zone offers per-type **assault**
sends; an owned zone offers Build (opens the build menu for that zone).
Structure commands (train/tiers/tower upgrades/tech/repair) come from the
static `COMMANDS.structure` map. Commands render in one horizontally
scrollable `.command-strip` row (scrollLeft preserved across renders); the
build menu's back button leads its list. `gated([[test,'reason'],…])` keeps
available/reason in sync; errors → toast (`flashError`), events → log.
Press-and-hold (`HOLD_MS`) fires `runAll`.

### Selection
`game.selected = { kind, type, id, zoneId }`, kinds `structure | node |
army | workerGroup | enemy | zone`. Army tiles are one per unit type per
zone (`type` = ARMY key, `id` = zoneId). Tapping a zone band (or caption)
selects the zone — including uncharted ones, so scouts can be sent. A stale
selection is left alone: `selectionValid` gates `selectedCommands` /
`entityInfo`, so a gone target just shows an empty command card; nothing
auto-selects. Keep `SELECTION_VALID` in sync when adding a kind; ids are
compared with `String()`.

### Render
`renderWorld` builds one **band per zone**, newest (frontier) at the top,
home at the bottom; the world view boots scrolled to home. Band classes:
`zone-field` (uncharted wilderness + the war-signs `.forecast` strip),
`zone-occupied` (red tint, garrison tile with chips + reward badge),
`zone-owned` / `zone-home`. Each band has a `zone-caption`
(`name · status`) and an inset ring when selected. Inside a band: enemy
raid tiles, defender tiles (one per unit type), node tiles with harvest
rings, structure tiles, march tiles for columns headed there. The
war-signs forecast (vague 'imminent…distant' + 'few…a horde per type', no
numbers) shows only while scouts are marching and the frontier band exists.

### Tile feedback (flashes + hp bars)
`flashTile(key, 'damage'|'spawn'|'attack')` — two independent channels per
tile (overlay flash vs attack lunge) with per-tile 50–100ms stagger via
`--flash-delay`/`--shake-delay`; attack lunges are directional (friendly
tiles nudge up, `.danger` tiles nudge down; pure transforms, no relayout).
`hpBarEl` renders ONE combined bar per group from `hp.total` (green own,
red under `.danger`); payloads from `poolHp` / `nodeHp` / `buildingHp` /
`raidHp` / `garrisonHp` / `strikeHp`, shown only while damaged
(+`HP_BAR_LINGER_MS`).

### Progress rings
`radialProgressCanvas(p, siblings)` draws one ring. The 100ms animator has
exactly three branches: anything carrying `data-job-uid` (queue chips and
march-tile badges), `.job-badge[data-node-id]` (harvest rings), and
`.job-badge[data-explore-ring]`. Reuse these data attributes — never add a
fourth lookup scheme.

## Recipes

- **New building**: entry in `BUILDINGS` (+`ICONS`). `build:` puts it in
  every owned zone's build menu; `requiresTier` gates on hall tier.
- **New trainable unit**: entry in `UNITS` (+`ICONS`); if it's an army type,
  add the `ARMY` entry and have `done` increment `zone.army.<key>`.
- **New garrison flavor**: entry in `GARRISON_POOL` (rewards: cache/units/
  workers compose freely).
- **New resource node flavor**: entry in `ZONE_NODE_POOL` (or `HOME_NODES`).
- **New upgrade**: a command via `gated(...)` calling `startUpgrade` with a
  unique `tag` and a `source` building. See `towerUpgradeCommand`.

## Invariants (don't break)

- Full-rebuild render; no diffing layer, no framework, no build step.
- Zone contents are reached through the zone accessors, never by walking
  `state.zones` ad hoc.
- Mobile input: `pointerup` selection with a 10px move threshold; zoom
  guards keep exempting interactive controls; `touch-action: manipulation`.
- Error toast is for errors only; gameplay events go to the menu log.
- Balance numbers live in the Tunables block / tables, not inline.
- Cheats (+10k, fast train/harvest, force raid, spawn footman/worker/farm,
  reveal, kill attackers) must keep working — they're the manual-test loop.
- Every pushed change bumps `VERSION`/`VERSION_TAG` and both `?v=` strings.

## Testing

No test files in-repo. The DOM-stubbed smoke harness used through v0.41
(stub `document`/`performance`, `eval` app.js, drive `gameTick`/
`runCommand`/`selectEntity`) predates the world-zone rework and its
assertions no longer match the model — rebuild it against zones before
trusting it. The user verifies visually — don't spin up headless browsers
for routine tweaks.
