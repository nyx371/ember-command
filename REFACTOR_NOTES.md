# Ember Command — architecture & refactor briefing

Written for a refactor pass. This captures how the code works today, what it's
good at, and where it hurts. The goal of the game is unchanged and we keep
adding gameplay (buildings, units, upgrades, orders, economy rules), so the
overriding refactor goal is: **make adding a new building / unit / order / timed
process cheap and hard to get wrong.**

See `design.html` for the game-design intent and `CLAUDE.md` for working
conventions. NOTE: `design.html` is currently out of sync with the code (it
still describes an older harvesting model) — trust the code, not the doc.

## Stack

- No framework, no build step, no dependencies. Three files do everything:
  `index.html` (static shell), `app.js` (all logic + rendering), `styles.css`.
- Runs by opening `index.html`. Icons are PNGs in `assets/icons/`, referenced
  through the `ICONS` map and cache-busted with `?v=ICON_VERSION`.
- Mobile-first: touch zoom guards, `pointerup`-based selection with a movement
  threshold, `touch-action`, safe-area insets, 14px min font.

## Core model

- One mutable state object, `game`, produced by `createGame()`. Everything
  hangs off it: `resources`, `workers`, `nodes`, `units`, `structures`,
  `production`, `constructions`, `upgrades`, `selected`, `enemy`, `raid`,
  `cheats`, `log`, `buildMenu`/`buildSource`.
- `render()` **fully rebuilds** DOM subtrees from `game` every time
  (`renderResources`, `renderWorld`, `renderOrders`, `renderLog`) using
  `replaceChildren()`. No diffing, no virtual DOM. This is deliberate and keeps
  UI code stateless — never optimize it into incremental updates.
- Two timers:
  - `gameTick` every 1000ms: advances the simulation (harvest, explore, attack,
    raids, `advanceProduction`/`advanceConstructions`/`advanceUpgrades`) then
    calls `render()`.
  - `updateProgressRings` every 100ms: **does not** call `render()`. It reaches
    into existing DOM and re-draws the canvas progress rings so they animate
    smoothly between ticks (`tickFraction()` interpolates).

## The main patterns

### Commands
`COMMANDS` (static, keyed by selected kind/type) plus dynamic commands built in
`selectedCommands(state)`. A command is a plain object:

```
{ id, icon, label, cost, overlay?,
  enabled(state), available?(state), reason?(state), isActive?(state), run(state) }
```

- `enabled` — can it actually run right now (includes affordability).
- `available` — non-resource prerequisites only. Used purely for **fading**:
  a button fades when unavailable for a non-resource reason, but NOT merely
  because you can't afford it (see `commandFaded`). Costed commands must define
  `available`; cost-free commands fall back to `enabled`.
- `reason` — short string for the error toast when a disabled button is tapped.
- Buttons are never natively `disabled`; they stay tappable so `runCommand` can
  surface `commandError()` in the toast (`flashError`). Errors go to the toast
  only; the menu log is for gameplay events.

### Entities & selection
`game.selected = { kind, type, id }`. Kinds: `structure`, `workerGroup`, `node`,
`army`, `enemy`. `entityButton()` renders every tile. Selection happens on
`pointerup` over `.entity` (with a move threshold so scrolling the node row
doesn't select). `id` is loosely typed — usually `1` for singleton structures,
a string node-id for nodes — so comparisons use `String(...)`.

### Workers & resource nodes
- `game.workers`: `{ id, job, nodeId, cooldown }`, `job ∈ idle|gold|lumber|building`.
- `game.nodes`: `{ id, type, label, icon, distance, capacity, remaining }`.
  `nodeCooldown(node) = HARVEST_GATHER[type] + distance * TRAVEL_PER_DISTANCE`.
- Workers are **pinned to a specific node** (`nodeId`) and harvest it until it
  depletes, then go idle. `autoAssignWorkers` re-pins idle workers to gold
  (first live gold node), else lumber. Tapping a node's harvest command calls
  `sendWorkerToNode`, which pulls a `spareWorker` in priority order: idle →
  same-resource worker on another node → other-resource worker.
- This worker/assignment model has **changed direction several times** this
  session (per-node → type-based "nearest" → back to per-node). The rules now
  live scattered across `gameTick` (harvest loop), `autoAssignWorkers`,
  `spareWorker`, `sendWorkerToNode`, and `releaseBuilder`.

### Timed processes (the biggest duplication)
There are **three near-identical subsystems**, each an array on `game` with its
own advance/cancel/render-queue functions and its own branch in
`updateProgressRings`:

| concern      | array            | advance              | cancel              | render chips            |
|--------------|------------------|----------------------|---------------------|-------------------------|
| unit train   | `production`     | `advanceProduction`  | `cancelJobByUid`    | `renderTrainingQueue`   |
| structures   | `constructions`  | `advanceConstructions` | `cancelConstruction` | `renderConstructionQueue` |
| upgrades     | `upgrades`       | `advanceUpgrades`    | `cancelUpgrade`     | `renderUpgradeQueue`    |

`production` also has a per-producer concurrency cap (`producerCapacity` =
building count) and a queue cap (`queueMax` = `QUEUE_MAX` × building count).
`constructions` tie up a worker (with return-to-node logic). `upgrades` use no
worker. All three are structurally the same "job with `duration`/`remaining`
that runs a `complete(state)` callback and can be cancelled with refund."

### Progress rings
`radialProgressCanvas(p, siblings)` draws a conic-gradient ring on a `<canvas>`.
Rings are created in two unrelated places: during `render*` (initial draw) and
again every 100ms in `updateProgressRings`, which finds elements by data
attributes (`data-progress-key`, `data-uid`, `data-construction-id`,
`data-upgrade-id`), removes the old canvas, and appends a fresh one. **Every new
animated-progress location needs a data-* key at the render site AND a matching
branch in `updateProgressRings`.** This is the most error-prone coupling.

## What the codebase is optimized for

- **Tiny, fast, iterative UI/gameplay tweaks.** The full-rebuild `render()`
  means you never chase stale DOM. Add a command object, add an icon line, add a
  tile — it just shows up.
- **Grep-ability.** One file, no indirection, no framework magic. Easy to read
  top-to-bottom.
- **Touch/mobile feel.** Instant taps, cancel chips, cost badges, radial timers.
- **Cheats** (`fastTrain`, `fastHarvest`, +resources) make manual testing quick.

## What's hard / tech debt (refactor targets)

1. **Three copies of the timed-job system** (production / constructions /
   upgrades). Unify into one generic "job" abstraction: `{ kind, duration,
   remaining, cost, complete, cancelRefund, concurrency?, worker? }` with one
   `advanceJobs`, one `cancelJob`, one `renderJobQueue`. This alone removes a
   large fraction of the file and the "add an upgrade" ceremony.

2. **Progress animation is dual-sourced.** Unify: store the live job/worker
   objects on the chip (or a small registry) and have a single animation pass
   read `remaining` — so adding an animated ring never means editing
   `updateProgressRings`.

3. **Adding a building touches ~6 places**: `structures` state key,
   `BUILDABLE_STRUCTURES`, `ICONS`, `STRUCTURE_TILES` (in `renderWorld`),
   `entityInfo`, and sometimes `COMMANDS.structure`. Collapse into **one data
   table per building/unit** (cost, build time, prereqs, produced-by, effect,
   icon, blurb) that drives commands, tiles, info, and tech-gates.

4. **`enabled` / `available` / `reason` re-encode the same predicates** (supply
   cap, queue full, barracks/lumber-mill prereqs appear repeatedly and must be
   kept in sync by hand or they drift). Introduce composable predicates
   (`needs('lumbermill')`, `supplyOk`, `queueOk`, `afford(cost)`) and derive the
   three from them.

5. **Simulation and rendering are fused.** `gameTick`, command `run`s, and
   `complete` callbacks all mutate `game` and often `writeLog`, and `render()`
   is called imperatively after mutations. There's no pure core, so nothing is
   unit-testable without a DOM. Consider splitting `sim.js` (pure state +
   reducers/selectors, no DOM) from `view.js` (render only).

6. **Worker/assignment rules are diffuse.** The full worker lifecycle
   (auto-assign gold-first, pinning, spare-worker sourcing, builder return,
   depletion→idle) is spread across five functions. Centralize into a small,
   documented worker module with one place that answers "where should this
   worker be?".

7. **Inconsistent schema/naming.** `structures` mixes plural and singular keys
   (`farms`, `barracks`, `lumbermill`, `blacksmith`, `towers`, `guardtowers`);
   `units.soldiers` internally but "footman" in the UI; `selected.id` is
   sometimes a number, sometimes a string. Normalize.

8. **Ad hoc stale-selection handling.** Only depleted **nodes** get a reset
   guard in `render()`. Depleting/removing a selected structure (e.g. a tower
   consumed by an upgrade) leaves selection dangling. A general rule
   ("selection must point at something that still exists/renders") would cover
   all kinds.

9. **Balance constants half-centralized.** Many are `const`s at the top, but
   some live inline (raid formula `RAID_BASE_STRENGTH + day*2`, distances in
   `NODE_DEFS`, tower powers). A single tunables table would help balancing.

10. **No persistence.** State is in-memory; refresh resets. `design.html` has a
    (idea-status) persistence section if that becomes in scope.

## Feature trajectory (so the refactor anticipates it)

We are steadily turning this into a WC2-flavoured *abstract* RTS: you command
via standing orders and high-level taps, not unit micro. Recent direction:
depletable resource nodes with distance-based harvest times, auto-managed
workers (auto-mine, tap-to-rebalance), timed builds using real WC2 times, a
budding tech tree (lumber mill gates archers; tower → guard tower upgrade), and
per-command error feedback. Expect continued additions of: more buildings and
units, more upgrades/tech gates, richer economy (oil, second town-hall tier),
and more standing-order behaviours. The refactor should make each of those a
**data addition**, not a spread of code edits.

## Don't-break list

- Keep the full-rebuild `render()` model; don't introduce a diffing layer.
- Keep it dependency-free and build-step-free (plain ES in one file is fine to
  split into a few `<script type="module">` files, but no bundler/toolchain).
- Preserve mobile behaviours: `pointerup` selection with move threshold, zoom
  guards that exempt interactive controls, cost badges, cancel chips, radial
  timers, error toast (errors only), `touch-action: manipulation`.
- Keep cheats working.
