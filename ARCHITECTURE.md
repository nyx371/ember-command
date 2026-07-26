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
`deepestOwned`, `chartingZone`, `nodeZone`, `totalStructures`) are the only sanctioned way to reach zone contents.

`makeZone(index, wave)` rolls a new zone: 1–2 nodes from `ZONE_NODE_POOL`
(zone 1 is always neutral with gold + lumber via `goldAndLumberNodes`), and a
garrison from `GARRISON_POOL` at `ZONE_OCCUPY_CHANCE` (60%) — except
`STRONGHOLD_DEPTH` (8), which always holds the scripted `STRONGHOLD`; razing
it wins. `garrisonComposition` toughens garrisons with both depth and the raid-wave
counter at generation time, mixing in axethrowers and ogres at depth
(garrisons hold per-raider-type `units` + `stats`, not a single guard blob). `ensureFrontier` keeps exactly one uncharted zone
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

### No standing orders
Patrol and attack (and the old ORDERS list) are gone. A stationed unit
defends the zone it stands in (`zone.army` is that zone's defend pool);
exploring is marching to chart the next zone; attacking a garrison is a
zone assault.

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
`startTransfer(state, fromId, toId, type, count)` — **instant**: units leave
the source zone's pool and `arriveColumn` delivers them into the destination
in the same beat. No travel time, no distance cost, no in-transit state.
`arriveColumn` decides what arrival means: an unrevealed zone is charted,
empty ground is claimed as `owned` (units become its defenders), an occupied
zone takes them as its `strike` column. **Exploring is the exception** — it takes time. `exploreFrom` pulls the
units out of their zone and puts them on a shared `explore` job (one per
uncharted zone, `exploreJob(state, zoneId)`) whose `rate` equals the number
of scouts, so `EXPLORE_TICKS` is divided by party size and reinforcing a
party mid-way speeds it up. On completion `arriveColumn` delivers the whole
party and reveals the zone; tapping a scout tile (`scoutTiles`, rendered in
the frontier band) cancels the job and sends everyone home. The
**move arm**
(`game.moveArm`) is the one-at-a-time flow: a Move command arms a source
(worker crew / idle worker / unit type), then each tap on a destination zone
(or a specific resource node — which retasks the worker to that resource)
moves exactly one; tapping elsewhere disarms.

### Raid combat
`RAIDER_TYPES` roster (grunts wave 1+, axethrowers 6+, ogres 9+, catapults
12+; gentle ramp, per-party offset volley phases via `foeDelay`). Raids
spawn beyond the **deepest owned zone** and move inward zone by zone.
`mergeRaids` (top of `raidTick`) folds parties of the same type standing in
the same zone into one stack — size and `hpMax` add, per-raider hp/dmg
become the size-weighted mix — so a fresh wave reinforces the one already
fighting instead of stacking up a second tile. Raids move
(`raid.index`) with **no travel time** — they appear in the zone they're set
on and fight the same tick (`raid.atIndex` tracks the last announced zone so
arrival flashes/logs fire once). That zone's defenders + towers fire
(`defenseDamage`; siege parties are immune to towers), raiders answer on
their cadence with targeting defenders → towers → workers → buildings
(`razeOrder()` = `RAID_TARGET_PRIORITY` then every other non-tower building
from `BUILDINGS`, hall last — derived so no building is unhittable; home
hall's fall = defeat; `siege` parties shell buildings only). A zone with no defenders, workers, or buildings is
"subdued" and the raid moves on inward immediately. Killed raiders drop `bounty`
plunder. Spawn interval shrinks per day but every once-occupied zone we
cleared (`zone.wasOccupied`) adds `RAID_OUTPOST_RELIEF` back. Defender regen
is per zone (paused while a raid fights there); workers mend slowly, paused
while any raid is at a zone.

### Garrison combat (occupied zones)
Units sent into an occupied zone become `zone.strike` and exchange
volleys with the garrison on the raid cadences — guards soak first, then
watch towers fall. Garrisons **reinforce** while under attack
(`GARRISON_REINFORCE`: +1 guard every 7 ticks up to 10). `conquerZone` on
clearing: reward pays out ({cache} instantly, {workers} spawn into the
zone, {units} join), **survivors + freed units settle as the zone's
defenders**, status flips to `owned`, `wasOccupied` marks it for raid
relief; the stronghold (`final`) wins the game. A wiped strike leaves
garrison damage standing. Garrison composition is veiled in the UI until
our own column engages.

### Fog of war
`zoneFogged(state, zone)` — true when a charted zone holds none of ours (no
`zone.army`, no `zone.strike`, no live workers, no structures); `zoneBand`
adds `.zone-fogged`, whose `::before` washes the band dark. Uncharted bands
are flat black via `.zone-field`. Presence, not memory: the wash comes back
the moment a zone empties out.

### Splash (siege)
`splashFactor(foes)` = `1 + SPLASH_PER_FOE × (foes − 1)`, capped at
`SPLASH_MAX`. Applied per attacker type by `poolDamage(state, pool, foes)`
and by the tower term in `defenseDamage` — anything flagged `splash: true`
(ballistas, cannon towers) scales with the size of the stack it fires into.
`foes` is the raid's `size`, or `garrisonCount(g)` when assaulting.

### Zone bands (fixed four rows)
`renderZoneBand` always emits the same four `tileRow`s — theirs / ours /
ground / built — mounted whether or not they hold tiles, and `.world-zone`
is `min-height: calc(var(--tile) * 4)`. Add content to an existing row;
adding a fifth row breaks the "nothing moves" guarantee.

### HP bars
One bar per stack, `{ total }` only — `stackHp(current, peak)` clamps it.
`stackHp(current, peak, segments)` — `segments` is the stack's current unit
count; the paint draws one cell per unit (dividers across the whole track,
skipped above 24 units). `hpBarEl` returns a CANVAS with track and fill
painted as pixels — the same
primitive as the radial progress rings, proven on every device. No CSS is
involved in showing OR moving the value, and none should be reintroduced —
three CSS-based fills in a row rendered fine in Chromium and sat frozen on
iOS. CSS only places it (absolute, explicit `width: calc(100% - 4px)` since
replaced elements ignore left+right sizing, `z-index: 1` above the flash).
The model damages at the top of the tick but the hurt flash waits out the
projectile flight, so a bar painted at the model's value moves ~300ms BEFORE
the visible impact. Instead the bar holds its last-shown value (`hpShown`)
while shots fly, then a rAF loop repaints it draining across the flash's
strike window, with the just-lost slice drawn as a bright fading chip so a
1-2% volley still reads. A mid-drain render replacement is fine: the loop
stops when its canvas is disconnected and the successor resumes from
`hpShown`.
`peak` is the stack's combined hp when the fight started (`pool.hpPeak` /
`strike.hpPeak` stamped by `damagePool`/`damageStrike` on the first hit,
`raid.hpMax` at spawn, `g.maxPool` for garrisons). Never measure against the
current count: a death removes its wound along with the unit, so the bar
would snap back toward full mid-fight. Reinforcements arriving mid-fight
raise `hpPeak` instead of pinning the bar to full.

### Combat feedback (flashes, strikes, projectiles)
`flashTile(key, kind, hits, hold)` — `hits` draws one strike per attacker (up
to `HIT_MAX`, `HIT_SPAN_MS` apart, via `--hits`/`--hit-span` on the tile);
`hold` delays the first one so a victim's hurt flash lands WITH the blow —
`MELEE_LAND_MS` for a swing, `PROJECTILE_MS` for a shot. Keep
`hold + span × hits` under one tick or the next render restarts it.
Only melee tiles lunge (`.melee-attacker`); ranged units and towers hold
still (`.ranged-attacker`, no structure attack flash). Ranged attackers
carry `shot: '<icon>'` — real WC2 sprites from `resources/missiles.png`
(`p_*.png`, extracted pointing up; `launchShots` rotates them along the
flight, thrown axes spin instead). Cannonballs and boulders bloom on
landing (`impactBurst`). Floating combat text (`queueFloat`/`launchFloats`,
same launcher pattern as shots) shows -damage on the target with the hurt
flash's hold, and +gold where bounty is earned. The built row is one SLOT
per type in `BUILDINGS` order (`structTiles`): the standing stack, else
rubble, else the construction site — so finished buildings appear in place
and effects land where the stack's tile stood. A stack falling to ZERO (not
each copy) pushes `{zoneId, key, until}` onto `game.rubble` (cleared after
`RUBBLE_TICKS`) and jolts the viewport (`shakeWorld`, `.world-shake`); a
construct job (tagged `buildKey`) shows its site tile only while no copy of
that type stands (kind `worksite`, tap-inert, ring = build timer) — adding
to a standing stack just ticks the count up on completion. (ARMY / RAIDER_TYPES / BUILDINGS
towers); combat code calls `queueShot(fromSel, toSel, icon, hits)` and
`launchShots()` (end of `render()`) flies the sprite tile-to-tile with WAAPI
over `PROJECTILE_MS`. Endpoints are selectors over the data attributes tiles
already carry (`selArmy`/`selStruct`/`selRaid`/`selStrike`/`selFoe`) — the
per-type tiles that share a zone-level kind/type are told apart by
`data-unit`. Damage stays a single pooled number per volley (see Splash above).

### Timed jobs (one system)
`game.jobs` — shared shape `{ uid, kind, icon, label, duration, remaining,
cost, complete }` plus:
- `kind: 'train'` → `{ producer, zoneId, supply }`. Keyed per producer per
  zone: N barracks in a zone train N at once, queue cap `QUEUE_MAX × N`.
- `kind: 'construct'` → `{ workerId, zoneId, returnTo, repairKey? }`.
- `kind: 'upgrade'` → `{ tag, source }` (`tag` blocks duplicate tracks,
  `source` enforces one research per source building). Never takes a worker.
- `kind: 'explore'` → `{ to, from, scouts, rate }` (zone ids; `scouts` is a
  sparse ARMY-key map). Cancelling returns the scouts to `from`.
Any job may carry `rate` (default 1) — ticks are multiplied by it, which is
how a bigger scouting party finishes sooner.
(Plain unit movement is *not* a job — it resolves instantly, see above.)
One `advanceJobs`, one `cancelJob` (refund + builder release), one
`jobProgress`, one `jobChip`. Chips live in the fixed-height
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
exactly two branches: anything carrying `data-job-uid` (queue chips and
march-tile badges) and `.job-badge[data-node-id]` (harvest rings). Reuse
these data attributes — never add a third lookup scheme.

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

`node tools/smoke.js` — a DOM-stubbed smoke harness for the zone model
(39 assertions): boot, harvest, train/cancel, zone build menu, barracks
gating, exploring/claiming zone 1, cross-zone worker moves, a deterministic
garrison assault + conquest, a raid repelled at the frontier, repair,
TIME_SCALE, and the stronghold victory. Zones it relies on are overwritten
with deterministic contents right after creation (makeZone rolls randomly).
Run it after any change to combat, zones, jobs, or the economy, and
recalibrate its bounds when balance shifts. The user verifies visuals
themselves — don't spin up headless browsers for routine tweaks.
