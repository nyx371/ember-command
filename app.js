// ── Tunables ───────────────────────────────────────────────────────────────

// Bump VERSION (+0.01) and rewrite VERSION_TAG with every pushed change —
// they render at the top of the menu so a stale cache is immediately visible.
const VERSION = '0.01';
const VERSION_TAG = 'version + latest-change tag in menu';

const MAX_LOG_LINES = 9;
const ICON_VERSION = '20260719-design1';
const TICK_MS = 1000;
const DAY_TICKS = 60;
const CHEAT_SPEED = 5;          // multiplier applied by fast-train / fast-harvest toggles
const TIME_SCALE = 0.3;         // global multiplier on ALL build/train/upgrade durations
                                // (tables keep real WC2 seconds; this scales them at job start)

const HARVEST_YIELD = 100;
const HARVEST_GATHER = { gold: 6, lumber: 12 };   // ticks spent gathering at the node itself
const TRAVEL_PER_DISTANCE = 2;                     // extra ticks per distance unit (round trip to town hall)

const QUEUE_MAX = 5;            // queued units allowed per producing structure
const SUPPLY_BASE = 4;

const EXPLORE_THRESHOLD = 90;   // explore-unit-ticks to find enemy base
const ENEMY_REBUILD = 0.05;     // enemy strength rebuilt per tick
const RAID_INTERVAL_BASE = 90;  // ticks between raids on day 0
const RAID_INTERVAL_SCALE = 8;  // reduce interval by this per day
const RAID_INTERVAL_MIN = 25;
const RAID_BASE_SIZE = 3;       // grunts in a day-0 raiding party
const RAID_SIZE_PER_DAY = 2;
const RAID_ARRIVE_TICKS = 6;    // approach window — only patrol strikes during it
const VOLLEY_EVERY = 2;         // ticks between combat volleys (attack cooldown, both sides)
const RAIDER = { hp: 60, dmg: 7 };   // per grunt at day 0 (WC2 grunt ≈ footman)
const RAIDER_HP_PER_DAY = 6;    // grunts toughen and hit harder as days pass
const RAIDER_DMG_PER_DAY = 1;
const WORKER_HP = 30;
// Raider targeting: warriors first, then the towers shooting at them, then
// workers, then the remaining buildings — the town hall falls last.
const RAID_TOWER_TARGETS = ['guardtower', 'tower'];
const RAID_TARGET_ORDER = ['farm', 'barracks', 'lumbermill', 'blacksmith', 'hall'];

const NODE_DEFS = [
  { id: 'gold-1',   type: 'gold',   label: 'gold mine',  icon: 'goldSite',   distance: 1, capacity: 20000 },
  { id: 'forest-1', type: 'lumber', label: 'forest',     icon: 'lumberSite', distance: 1, capacity: 25000 },
  { id: 'forest-2', type: 'lumber', label: 'far forest', icon: 'lumberSite', distance: 5, capacity: 25000 }
];

// ── Data tables ────────────────────────────────────────────────────────────
// Adding a building or unit should normally mean touching ONLY these tables
// (plus an ICONS entry if it uses a new sprite).

// Buildings. `build` marks worker-constructable ones (cost + real WC2 seconds);
// `supply` adds to the supply cap; `hp` is what raiders must chew through to
// destroy one; `dmg` makes it shoot back at raiders each volley; `blurb` feeds
// the command-info line (string or fn(state)); `onBuilt` runs after the count
// increments.
const BUILDINGS = {
  hall: {
    icon: 'hall', label: 'town hall',
    supply: 4, hp: 1200,
    blurb: s => `Town Hall · ${productionMeta(s, 'hall') || 'ready'}`
  },
  farm: {
    icon: 'farm', label: 'farm',
    supply: 4, hp: 400,
    build: { cost: { gold: 500, lumber: 250 }, time: 100 },
    blurb: 'Farm · +4 supply'
  },
  barracks: {
    icon: 'barracks', label: 'barracks', hp: 800,
    build: { cost: { gold: 700, lumber: 450 }, time: 200 },
    blurb: s => `Barracks · ${productionMeta(s, 'barracks') || 'ready'}`,
    onBuilt: s => { s.selected = { kind: 'structure', type: 'barracks', id: 1 }; }
  },
  lumbermill: {
    icon: 'lumbermill', label: 'lumber mill', hp: 600,
    build: { cost: { gold: 600, lumber: 450 }, time: 150 },
    blurb: 'Lumber Mill · unlocks archers'
  },
  blacksmith: {
    icon: 'blacksmith', label: 'blacksmith', hp: 775,
    build: { cost: { gold: 800, lumber: 450 }, time: 200 },
    blurb: 'Blacksmith'
  },
  tower: {
    icon: 'tower', label: 'tower', hp: 100, dmg: 3,
    build: { cost: { gold: 550, lumber: 200 }, time: 60 },
    blurb: 'Tower · upgradable to guard tower'
  },
  guardtower: {
    icon: 'guardtower', label: 'guard tower',   // via tower upgrade, not the build menu
    hp: 130, dmg: 8,
    blurb: 'Guard Tower · base defense'
  }
};

// Trainable units. `producer` is the structure that trains them; `requires`
// are extra tech prerequisites; `done` receives state on completion.
const UNITS = {
  worker: {
    icon: 'worker', label: 'worker', producer: 'hall', time: 45, cost: { gold: 400 },
    done: s => {
      const w = createWorker();
      s.workers.push(w);
      autoAssignWorkers(s);
      if (w.nodeId) flashTile(`node:${w.job}:${w.nodeId}`, 'spawn');
      writeLog(s, 'Worker ready.');
    }
  },
  footman: {
    icon: 'footman', label: 'footman', producer: 'barracks', time: 60, cost: { gold: 600 },
    done: s => { s.army.defend.footmen += 1; flashTile('army:defend:1', 'spawn'); writeLog(s, 'Footman ready.'); }
  },
  archer: {
    icon: 'archer', label: 'archer', producer: 'barracks', time: 70, cost: { gold: 500, lumber: 50 },
    requires: ['lumbermill'],
    done: s => { s.army.defend.archers += 1; flashTile('army:defend:1', 'spawn'); writeLog(s, 'Archer ready.'); }
  }
};

// Army unit types. `hp`/`dmg` drive raid combat (listed first = soaks damage
// first within a pool); `attack` is siege dps against the enemy base. Units
// live in per-order pools on `game.army` (see ORDERS).
const ARMY = {
  footmen: { icon: 'footman', label: 'footmen', singular: 'footman', hp: 60, dmg: 7, attack: 0.10 },
  archers: { icon: 'archer',  label: 'archers', singular: 'archer',  hp: 40, dmg: 5, attack: 0.06 }
};

// Standing orders an army unit can hold. Units live in one pool per order and
// are moved between pools one at a time (workers-row style).
const ORDERS = ['defend', 'patrol', 'explore', 'attack'];

const GUARD_TOWER = { cost: { gold: 500, lumber: 150 }, time: 140 };

const ICONS = {
  gold: 'assets/icons/r_gold.png',
  lumber: 'assets/icons/r_lumber.png',
  oil: 'assets/icons/r_oil.png',
  supply: 'assets/icons/r_food.png',
  worker: 'assets/icons/h_unit_peasant.png',
  goldSite: 'assets/icons/n_bld_goldmine.png',
  lumberSite: 'assets/icons/n_bld_forest.png',
  footman: 'assets/icons/h_unit_footman.png',
  archer: 'assets/icons/h_unit_archer.png',
  hall: 'assets/icons/h_bld_townhall.png',
  farm: 'assets/icons/h_bld_farm.png',
  barracks: 'assets/icons/h_bld_barracks.png',
  lumbermill: 'assets/icons/h_bld_lumbermill.png',
  blacksmith: 'assets/icons/h_bld_blacksmith.png',
  tower: 'assets/icons/h_bld_tower.png',
  guardtower: 'assets/icons/h_bld_watchtower.png',
  enemy: 'assets/icons/o_unit_grunt.png',
  enemyBase: 'assets/icons/o_bld_greathall.png',
  attack: 'assets/icons/c_sword1.png',
  stop: 'assets/icons/c_stop.png',
  defend: 'assets/icons/c_hshield1.png',
  patrol: 'assets/icons/c_hpatrol.png',
  explore: 'assets/icons/c_hmove.png',
  build: 'assets/icons/c_build.png',
  harvest: 'assets/icons/c_harvest.png'
};

// ── State ──────────────────────────────────────────────────────────────────

let idCounter = 0;

function nextId() {
  idCounter += 1;
  return idCounter;
}

function createGame() {
  return {
    tick: 0,
    selected: { kind: 'structure', type: 'hall', id: 1 },
    resources: { gold: 100, lumber: 100, oil: 0 },
    // One unified list of timed jobs: kind ∈ train|construct|upgrade. All share
    // { uid, icon, label, duration, remaining, cost, complete }; train jobs add
    // { producer, supply }, construct jobs add { workerId, returnTo }, upgrade
    // jobs add { tag }.
    jobs: [],
    buildMenu: false,
    workers: [],
    nodes: NODE_DEFS.map(d => ({ ...d, remaining: d.capacity })),
    // One pool per standing order; each holds counts per ARMY type plus a
    // shared wounds pool for raid damage.
    army: Object.fromEntries(ORDERS.map(o =>
      [o, { ...Object.fromEntries(Object.keys(ARMY).map(k => [k, 0])), wounds: 0 }])),
    structures: Object.fromEntries(Object.keys(BUILDINGS).map(k => [k, k === 'hall' ? 1 : 0])),
    enemy: { strength: 20, known: false },
    exploreProgress: 0,
    raid: { nextIn: RAID_INTERVAL_BASE, interval: RAID_INTERVAL_BASE },
    raids: [],            // active raiding parties (see spawnRaid)
    workerWounds: 0,      // damage accumulated toward the next worker death
    log: ['Town hall ready.', 'Workers await orders.'],
    cheats: { fastTrain: false, fastHarvest: false }
  };
}

function createWorker(job = 'idle', nodeId = null, cooldown = 0) {
  return { id: nextId(), job, nodeId, cooldown };
}

installZoomGuards();

let lastTickAt = performance.now();

function tickFraction(step) {
  return step * Math.min(1, (performance.now() - lastTickAt) / TICK_MS);
}

const dom = {
  stores: document.querySelector('#stores'),
  world: document.querySelector('#world'),
  orders: document.querySelector('#orders'),
  log: document.querySelector('#log'),
  day: document.querySelector('#day'),
  error: document.querySelector('#error')
};

const game = createGame();

// ── Small shared helpers ───────────────────────────────────────────────────

function cap(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function canAfford(state, cost) {
  return Object.keys(cost).every(key => state.resources[key] >= cost[key]);
}

function spend(state, cost) {
  Object.keys(cost).forEach(key => { state.resources[key] -= cost[key]; });
}

function refund(state, cost) {
  Object.keys(cost).forEach(key => { state.resources[key] += cost[key]; });
}

// All build/train/upgrade durations pass through this — TIME_SCALE compresses
// the real WC2 seconds kept in the tables.
function scaledTime(seconds) {
  return Math.max(1, Math.round(seconds * TIME_SCALE));
}

function costIcons(cost) {
  return Object.entries(cost).map(([icon, n]) => ({ icon, n }));
}

function writeLog(state, line) {
  state.log.unshift(line);
  state.log = state.log.slice(0, MAX_LOG_LINES);
}

// Derive a command's fade/toast fields from an ordered checklist of
// [test(state), 'reason'] pairs — the single source for available() and
// reason(), so predicates can't drift apart.
function gated(checks) {
  return {
    available: s => checks.every(([test]) => test(s)),
    reason: s => (checks.find(([test]) => !test(s)) || [null, ''])[1]
  };
}

// ── Workers & resource nodes ───────────────────────────────────────────────
// The whole worker lifecycle lives here. A worker is pinned to a specific node
// (worker.nodeId) and harvests it until it depletes, then goes idle;
// autoAssignWorkers re-places idle workers (gold first, then lumber) every
// tick, on unit completion, and on spawn. Builders remember their node and
// return to it via releaseBuilder.

function workerCount(state, job) {
  return state.workers.filter(w => w.job === job).length;
}

function nodeById(state, id) {
  return state.nodes.find(n => n.id === id);
}

// Harvest cycle length: gather time at the node plus round-trip travel that
// scales with how far the node sits from the town hall.
function nodeCooldown(node) {
  return HARVEST_GATHER[node.type] + node.distance * TRAVEL_PER_DISTANCE;
}

function workersAtNode(state, node) {
  return state.workers.filter(w => w.nodeId === node.id);
}

// First live node of a resource type (array order), used for auto-assignment.
function firstNodeOfType(state, type) {
  return state.nodes.find(n => n.type === type && n.remaining > 0) || null;
}

// A worker to spare when assigning to `node`: an idle one first, then one from
// another node of the SAME resource, then one from a different resource.
function spareWorker(state, node) {
  return state.workers.find(w => w.job === 'idle')
      || state.workers.find(w => w.job === node.type && w.nodeId !== node.id)
      || state.workers.find(w => (w.job === 'gold' || w.job === 'lumber') && w.job !== node.type);
}

function assignWorker(worker, node) {
  worker.job = node.type;
  worker.nodeId = node.id;
  worker.cooldown = nodeCooldown(node);
}

function idleWorker(worker) {
  worker.job = 'idle';
  worker.nodeId = null;
  worker.cooldown = 0;
}

function sendWorkerToNode(state, node) {
  if (node.remaining <= 0) return;
  const worker = spareWorker(state, node);
  if (!worker) return;
  assignWorker(worker, node);
  flashTile(`node:${node.type}:${node.id}`, 'spawn');
  writeLog(state, `Worker → ${node.label}.`);
}

// Long-press variant: pull every spare worker to this node. spareWorker stops
// matching once everyone is already here, which terminates the loop.
function sendAllWorkersToNode(state, node) {
  if (node.remaining <= 0) return;
  let moved = 0;
  let worker;
  while (moved < 200 && (worker = spareWorker(state, node))) {
    assignWorker(worker, node);
    moved += 1;
  }
  if (moved > 0) {
    flashTile(`node:${node.type}:${node.id}`, 'spawn');
    writeLog(state, `${moved} workers → ${node.label}.`);
  }
}

// Idle workers don't sit around: they mine gold, or cut wood if no gold is
// left. Keeps the economy running without manual assignment.
function autoAssignWorkers(state) {
  state.workers.forEach(w => {
    if (w.job !== 'idle') return;
    const node = firstNodeOfType(state, 'gold') || firstNodeOfType(state, 'lumber');
    if (node) assignWorker(w, node);
  });
}

// Builder to dispatch for a construction: an idle worker first, otherwise one
// pulled off the most plentiful live node (the crew we can most afford to
// shrink). Null when nobody can be spared.
function builderWorker(state) {
  const idle = state.workers.find(w => w.job === 'idle');
  if (idle) return idle;
  const richest = state.nodes
    .filter(n => n.remaining > 0 && workersAtNode(state, n).length > 0)
    .sort((a, b) => b.remaining - a.remaining)[0];
  return richest ? workersAtNode(state, richest)[0] : null;
}

// Builder released from a finished/cancelled construction: back to its node if
// it still has resources, otherwise idle (auto-assign re-routes it next tick).
function releaseBuilder(state, workerId, returnTo) {
  const worker = state.workers.find(w => w.id === workerId);
  if (!worker) return;
  const node = returnTo ? nodeById(state, returnTo) : null;
  if (node && node.remaining > 0) assignWorker(worker, node);
  else idleWorker(worker);
}

function harvestTick(state) {
  const step = state.cheats.fastHarvest ? CHEAT_SPEED : 1;
  state.workers.forEach(worker => {
    if (worker.job !== 'gold' && worker.job !== 'lumber') return;
    const node = nodeById(state, worker.nodeId);
    if (!node || node.remaining <= 0) {
      idleWorker(worker);
      return;
    }
    worker.cooldown -= step;
    if (worker.cooldown > 0) return;
    const gained = Math.min(HARVEST_YIELD, node.remaining);
    node.remaining -= gained;
    state.resources[worker.job] += gained;
    worker.cooldown = nodeCooldown(node);
    if (node.remaining <= 0) writeLog(state, `${node.label} depleted.`);
  });
}

// ── Timed jobs (train / construct / upgrade) ───────────────────────────────
// One subsystem for everything with a duration, a cost, and a cancel+refund.

function trainJobs(state, producer) {
  return state.jobs.filter(j => j.kind === 'train' && j.producer === producer);
}

function queueLength(state, producer) {
  return trainJobs(state, producer).length;
}

// Concurrency and queue depth both scale with building count: N barracks train
// N units at once and hold QUEUE_MAX × N in queue.
function producerCapacity(state, producer) {
  return state.structures[producer] || 1;
}

function queueMax(state, producer) {
  return QUEUE_MAX * producerCapacity(state, producer);
}

function supplyReserved(state) {
  return state.jobs.filter(j => j.kind === 'train' && j.supply).length;
}

function pendingUpgrades(state, tag) {
  return state.jobs.filter(j => j.kind === 'upgrade' && j.tag === tag).length;
}

function trainUnit(state, key) {
  const u = UNITS[key];
  if (queueLength(state, u.producer) >= queueMax(state, u.producer) || !canAfford(state, u.cost)) return;
  spend(state, u.cost);
  const time = scaledTime(u.time);
  state.jobs.push({
    uid: nextId(), kind: 'train', producer: u.producer, supply: 1,
    icon: u.icon, label: u.label, duration: time, remaining: time,
    cost: u.cost, complete: u.done
  });
  const depth = queueLength(state, u.producer);
  writeLog(state, depth > 1 ? `${u.label}: queued (${depth}).` : `${u.label}: started.`);
}

function startConstruction(state, key) {
  const b = BUILDINGS[key];
  if (!canAfford(state, b.build.cost)) return;
  const worker = builderWorker(state);
  if (!worker) return;
  spend(state, b.build.cost);
  const returnTo = worker.nodeId;
  worker.job = 'building';
  worker.nodeId = null;
  worker.cooldown = 0;
  const time = scaledTime(b.build.time);
  state.jobs.push({
    uid: nextId(), kind: 'construct', workerId: worker.id, returnTo,
    icon: b.icon, label: b.label, duration: time, remaining: time,
    cost: b.build.cost,
    complete: s => {
      s.structures[key] += 1;
      flashTile(`structure:${key}:1`, 'spawn');
      writeLog(s, `${cap(b.label)} complete.`);
      if (b.onBuilt) b.onBuilt(s);
    }
  });
  state.buildMenu = false;
  writeLog(state, `${b.label}: worker dispatched.`);
}

function startUpgrade(state, spec) {
  if (!canAfford(state, spec.cost)) return;
  spend(state, spec.cost);
  const time = scaledTime(spec.time);
  state.jobs.push({
    uid: nextId(), kind: 'upgrade', tag: spec.tag,
    icon: spec.icon, label: spec.label, duration: time, remaining: time,
    cost: spec.cost, complete: spec.complete
  });
  writeLog(state, `${spec.label}: upgrading.`);
}

function cancelJob(state, uid) {
  const job = state.jobs.find(j => j.uid === uid);
  if (!job) return;
  state.jobs = state.jobs.filter(j => j !== job);
  refund(state, job.cost);
  if (job.kind === 'construct') releaseBuilder(state, job.workerId, job.returnTo);
  writeLog(state, `${job.label}: cancelled, refunded.`);
}

// Progress 0..1 for any job. Train jobs beyond the producer's concurrency cap
// are still queued and report 0.
function jobProgress(state, job) {
  if (job.kind === 'train'
      && !trainJobs(state, job.producer).slice(0, producerCapacity(state, job.producer)).includes(job)) {
    return 0;
  }
  const step = state.cheats.fastTrain ? CHEAT_SPEED : 1;
  return Math.min(1, ((job.duration - job.remaining) + tickFraction(step)) / job.duration);
}

function advanceJobs(state) {
  const step = state.cheats.fastTrain ? CHEAT_SPEED : 1;
  const advancedPerProducer = {};
  state.jobs.forEach(job => {
    if (job.kind === 'train') {
      const advanced = advancedPerProducer[job.producer] || 0;
      if (advanced >= producerCapacity(state, job.producer)) return;
      advancedPerProducer[job.producer] = advanced + 1;
    }
    job.remaining -= step;
  });
  const done = state.jobs.filter(j => j.remaining <= 0);
  state.jobs = state.jobs.filter(j => j.remaining > 0);
  done.forEach(job => {
    if (job.kind === 'construct') releaseBuilder(state, job.workerId, job.returnTo);
    job.complete(state);
  });
}

// ── Stats ──────────────────────────────────────────────────────────────────

function supplyUsed(state) {
  return state.workers.length
       + ORDERS.reduce((sum, o) => sum + poolCount(state.army[o]), 0);
}

function supplyCap(state) {
  return SUPPLY_BASE + Object.keys(BUILDINGS)
    .reduce((sum, k) => sum + (BUILDINGS[k].supply || 0) * state.structures[k], 0);
}

function supplyFree(state) {
  return supplyUsed(state) + supplyReserved(state) < supplyCap(state);
}

function clampGame(state) {
  for (const key of Object.keys(state.resources)) {
    state.resources[key] = Math.max(0, Math.floor(state.resources[key]));
  }
  state.enemy.strength = Math.max(0, state.enemy.strength);
}

// ── Army ───────────────────────────────────────────────────────────────────

function poolCount(pool) {
  return Object.keys(ARMY).reduce((n, k) => n + pool[k], 0);
}

function unitsOnOrder(state, order) {
  return poolCount(state.army[order]);
}

// Segmented-hp payloads for entityButton: one segment per unit, the last one
// drained by accumulated wounds; `total` drives the collapsed horde bar.
function poolHp(pool) {
  const count = poolCount(pool);
  if (count === 0 || pool.wounds === 0) return null;   // bar only while damaged
  const type = Object.keys(ARMY).find(k => pool[k] > 0);
  const maxHp = Object.keys(ARMY).reduce((sum, k) => sum + pool[k] * ARMY[k].hp, 0);
  return {
    segments: count,
    partial: 1 - pool.wounds / ARMY[type].hp,
    total: (maxHp - pool.wounds) / maxHp
  };
}

function raidHp(raid) {
  if (raid.size === 0 || raid.hpPool >= raid.size * raid.grunt.hp) return null;   // bar only while damaged
  return {
    segments: raid.size,
    partial: (raid.hpPool - (raid.size - 1) * raid.grunt.hp) / raid.grunt.hp,
    total: raid.hpPool / (raid.size * raid.grunt.hp)
  };
}

function attackDamage(state) {
  return Object.keys(ARMY).reduce((dmg, k) => dmg + state.army.attack[k] * ARMY[k].attack, 0);
}

// Move one unit between order pools (footmen before archers, mirroring the
// one-worker-per-tap convention). Long-press moves the whole pool.
function moveUnit(state, from, to) {
  const pool = state.army[from];
  const type = Object.keys(ARMY).find(k => pool[k] > 0);
  if (!type) return;
  pool[type] -= 1;
  state.army[to][type] += 1;
  if (poolCount(pool) === 0) pool.wounds = 0;
  writeLog(state, `${cap(ARMY[type].singular)} → ${to}.`);
}

function moveAllUnits(state, from, to) {
  const pool = state.army[from];
  let moved = 0;
  Object.keys(ARMY).forEach(k => {
    moved += pool[k];
    state.army[to][k] += pool[k];
    pool[k] = 0;
  });
  pool.wounds = 0;
  if (moved > 0) writeLog(state, `${moved} units → ${to}.`);
}

// ── Raid combat ────────────────────────────────────────────────────────────
// Raiding parties are real: grunts with hp/damage arrive, exchange volleys
// every VOLLEY_EVERY ticks, and target defenders first, then workers, then
// buildings. Units on attack/explore are away from the base and neither fight
// raiders nor get targeted.

// Damage my side deals per volley. Only defend and patrol pools fight raids —
// scouts and the attack force are away from the base. During a raid's approach
// only patrol intercepts; once it arrives, defend + patrol + towers all fight.
function poolDamage(pool) {
  return Object.keys(ARMY).reduce((sum, k) => sum + pool[k] * ARMY[k].dmg, 0);
}

function defenseDamage(state, arrived) {
  const unitDmg = poolDamage(state.army.patrol) + (arrived ? poolDamage(state.army.defend) : 0);
  const towerDmg = arrived
    ? Object.keys(BUILDINGS).reduce((sum, k) => sum + (BUILDINGS[k].dmg || 0) * state.structures[k], 0)
    : 0;
  return unitDmg + towerDmg;
}

// Damage flows into the pool's wounds; every full hp's worth kills one unit
// (footmen soak before archers).
function damagePool(state, order, dmg) {
  const pool = state.army[order];
  flashTile(`army:${order}:1`, 'damage');
  pool.wounds += dmg;
  let type = Object.keys(ARMY).find(k => pool[k] > 0);
  while (type && pool.wounds >= ARMY[type].hp) {
    pool.wounds -= ARMY[type].hp;
    pool[type] -= 1;
    writeLog(state, `A ${ARMY[type].singular} has fallen.`);
    type = Object.keys(ARMY).find(k => pool[k] > 0);
  }
  if (!type) pool.wounds = 0;
}

function damageWorkers(state, dmg) {
  state.workerWounds += dmg;
  while (state.workerWounds >= WORKER_HP && state.workers.length > 0) {
    state.workerWounds -= WORKER_HP;
    // Builders die last; a dead builder takes its construction down with it.
    const victim = state.workers.filter(w => w.job !== 'building').pop()
                || state.workers[state.workers.length - 1];
    if (victim.job === 'building') {
      state.jobs = state.jobs.filter(j => !(j.kind === 'construct' && j.workerId === victim.id));
      writeLog(state, 'A builder was slain — construction abandoned.');
    } else {
      if (victim.nodeId) flashTile(`node:${victim.job}:${victim.nodeId}`, 'damage');
      writeLog(state, 'A worker has been slain.');
    }
    state.workers = state.workers.filter(w => w !== victim);
  }
  if (state.workers.length === 0) state.workerWounds = 0;
}

// Raiders razing buildings: chew through the current target's hp, then destroy
// it and pick the next from the given priority list.
function damageBuildings(state, raid, dmg, order) {
  if (!raid.targetType || !order.includes(raid.targetType) || state.structures[raid.targetType] <= 0) {
    raid.targetType = order.find(k => state.structures[k] > 0) || null;
    raid.targetHp = raid.targetType ? BUILDINGS[raid.targetType].hp : 0;
  }
  if (!raid.targetType) return;   // nothing left standing
  flashTile(`structure:${raid.targetType}:1`, 'damage');
  raid.targetHp -= dmg;
  if (raid.targetHp <= 0) {
    state.structures[raid.targetType] -= 1;
    writeLog(state, `${cap(BUILDINGS[raid.targetType].label)} destroyed by raiders!`);
    if (raid.targetType === 'hall') flashError('The town hall has fallen!');
    raid.targetType = null;
  }
}

function spawnRaid(state) {
  const day = currentDay(state);
  const size = RAID_BASE_SIZE + day * RAID_SIZE_PER_DAY;
  const grunt = { hp: RAIDER.hp + day * RAIDER_HP_PER_DAY, dmg: RAIDER.dmg + day * RAIDER_DMG_PER_DAY };
  state.raids.push({
    id: nextId(), size, grunt, hpPool: size * grunt.hp,
    arriveIn: RAID_ARRIVE_TICKS, strikeIn: VOLLEY_EVERY,
    targetType: null, targetHp: 0
  });
  writeLog(state, `Day ${day + 1}: ${size} raiders approaching!`);
  flashError('Enemies approach our base!');
}

function raidTick(state) {
  state.raids.forEach(raid => {
    const arrived = raid.arriveIn <= 0;
    if (!arrived) {
      raid.arriveIn -= 1;
      if (raid.arriveIn <= 0) flashError('Our town is under attack!');
    }
    raid.strikeIn -= 1;
    if (raid.strikeIn > 0) return;
    raid.strikeIn = VOLLEY_EVERY;

    // My volley (patrol only while they approach).
    const dealt = defenseDamage(state, arrived);
    if (dealt > 0) flashTile(`enemy:raid:${raid.id}`, 'damage');
    raid.hpPool -= dealt;
    raid.size = Math.max(0, Math.ceil(raid.hpPool / raid.grunt.hp));
    if (raid.size <= 0) {
      writeLog(state, 'Raid repelled!');
      return;
    }

    // Their volley: patrol first, then defenders; scouts and the attack force
    // are away and untouchable. Out of warriors -> towers, workers, buildings.
    if (!arrived) return;
    const dmg = raid.size * raid.grunt.dmg;
    const towersStanding = RAID_TOWER_TARGETS.some(k => state.structures[k] > 0);
    if (unitsOnOrder(state, 'patrol') > 0) damagePool(state, 'patrol', dmg);
    else if (unitsOnOrder(state, 'defend') > 0) damagePool(state, 'defend', dmg);
    else {
      if (!raid.razing) {
        raid.razing = true;
        flashError('Our town is being razed!');
      }
      if (towersStanding) damageBuildings(state, raid, dmg, RAID_TOWER_TARGETS);
      else if (state.workers.length > 0) damageWorkers(state, dmg);
      else damageBuildings(state, raid, dmg, RAID_TARGET_ORDER);
    }
  });
  state.raids = state.raids.filter(r => r.size > 0);
}

// ── Tick ───────────────────────────────────────────────────────────────────

function currentDay(state) {
  return Math.floor(state.tick / DAY_TICKS);
}

function gameTick() {
  game.tick += 1;
  lastTickAt = performance.now();

  autoAssignWorkers(game);
  harvestTick(game);

  // Exploration — accumulate per exploring unit; discover when threshold reached
  if (!game.enemy.known) {
    const explorers = unitsOnOrder(game, 'explore');
    if (explorers > 0) {
      game.exploreProgress += explorers;
      if (game.exploreProgress >= EXPLORE_THRESHOLD) {
        game.enemy.known = true;
        writeLog(game, 'Enemy base located! Attack order unlocked.');
      }
    }
  }

  // Auto-attack — chips away at enemy strength
  if (game.enemy.known) {
    game.enemy.strength = Math.max(0, game.enemy.strength - attackDamage(game));
    if (game.enemy.strength === 0) {
      writeLog(game, 'Enemy base destroyed! Victory!');
    }
  }

  // Enemy slowly rebuilds
  game.enemy.strength += ENEMY_REBUILD;

  // Raids — spawn on a shrinking interval, then fight tick by tick.
  game.raid.nextIn -= 1;
  if (game.raid.nextIn <= 0) {
    spawnRaid(game);
    game.raid.interval = Math.max(RAID_INTERVAL_MIN, RAID_INTERVAL_BASE - currentDay(game) * RAID_INTERVAL_SCALE);
    game.raid.nextIn = game.raid.interval;
  }
  raidTick(game);

  advanceJobs(game);
  clampGame(game);
  render();
}

// ── Commands ───────────────────────────────────────────────────────────────

function trainCommand(key) {
  const u = UNITS[key];
  const checks = [
    [s => s.structures[u.producer] > 0, `Need a ${BUILDINGS[u.producer].label}`],
    ...(u.requires || []).map(req => [s => s.structures[req] > 0, `Need a ${BUILDINGS[req].label}`]),
    [s => supplyFree(s), 'Supply capped — build a farm'],
    [s => queueLength(s, u.producer) < queueMax(s, u.producer), 'Queue full']
  ];
  const { available, reason } = gated(checks);
  return {
    id: `train-${key}`, icon: u.icon, label: `train ${u.label}`,
    cost: [...costIcons(u.cost), { icon: 'supply', n: 1 }],
    available, reason,
    enabled: s => available(s) && canAfford(s, u.cost),
    run: s => trainUnit(s, key)
  };
}

function guardTowerCommand() {
  const { available, reason } = gated([
    [s => s.structures.lumbermill > 0, 'Need a lumber mill'],
    [s => s.structures.tower > pendingUpgrades(s, 'guardtower'), 'No tower free to upgrade']
  ]);
  return {
    id: 'upgrade-guardtower', icon: 'guardtower', label: 'upgrade to guard tower',
    cost: costIcons(GUARD_TOWER.cost),
    available, reason,
    enabled: s => available(s) && canAfford(s, GUARD_TOWER.cost),
    run: s => startUpgrade(s, {
      tag: 'guardtower', icon: 'guardtower', label: 'guard tower',
      time: GUARD_TOWER.time, cost: GUARD_TOWER.cost,
      complete: st => {
        st.structures.tower -= 1;
        st.structures.guardtower += 1;
        flashTile('structure:guardtower:1', 'spawn');
        writeLog(st, 'Guard tower ready.');
      }
    })
  };
}

// Commands for a selected order group: one button per other order, each tap
// moves one unit there (mirrors the worker rebalance taps).
function armyGroupCommands(order) {
  return ORDERS.filter(o => o !== order).map(o => ({
    id: `move-${order}-${o}`, icon: orderIcon(o), label: `send to ${o}`, cost: '',
    enabled: s => unitsOnOrder(s, order) > 0 && (o !== 'attack' || s.enemy.known),
    reason: s => unitsOnOrder(s, order) === 0 ? 'No units in this group'
               : (o === 'attack' && !s.enemy.known) ? 'Enemy not found — explore first' : '',
    run: s => moveUnit(s, order, o),
    runAll: s => moveAllUnits(s, order, o)
  }));
}

// Static command sets, derived from the data tables. Train commands attach to
// their producer automatically; extra per-structure commands (the hall's build
// menu, tower upgrades) are appended after.
const COMMANDS = {
  structure: (() => {
    const byStructure = {};
    Object.keys(UNITS).forEach(key => {
      const producer = UNITS[key].producer;
      (byStructure[producer] = byStructure[producer] || []).push(trainCommand(key));
    });
    (byStructure.hall = byStructure.hall || []).push({
      id: 'open-build', icon: 'build', label: 'construct building', cost: '',
      enabled: s => builderWorker(s) != null,
      reason: () => 'No worker available',
      run: s => { s.buildMenu = true; }
    });
    (byStructure.tower = byStructure.tower || []).push(guardTowerCommand());
    return byStructure;
  })(),
  workerGroup: [],
  army: Object.fromEntries(ORDERS.map(o => [o, armyGroupCommands(o)]))
};

function buildMenuCommands() {
  return [
    ...Object.keys(BUILDINGS).filter(key => BUILDINGS[key].build).map(key => {
      const b = BUILDINGS[key];
      return {
        id: `build-${key}`, icon: b.icon, label: `build ${b.label}`, cost: costIcons(b.build.cost),
        available: s => builderWorker(s) != null,
        reason: s => builderWorker(s) == null ? 'No worker available' : '',
        enabled: s => builderWorker(s) != null && canAfford(s, b.build.cost),
        run: s => startConstruction(s, key)
      };
    }),
    { id: 'build-menu-stop', icon: 'stop', label: 'stop', cost: '',
      enabled: () => true,
      run: s => { s.buildMenu = false; } }
  ];
}

function nodeCommands(state, node) {
  return [
    { id: 'node-assign', icon: 'harvest', overlay: node.type, label: `harvest ${node.type}`, cost: '',
      enabled: s => node.remaining > 0 && spareWorker(s, node) != null,
      reason: s => node.remaining <= 0 ? `${node.label} depleted` : 'No spare workers',
      run: s => sendWorkerToNode(s, node),
      runAll: s => sendAllWorkersToNode(s, node) }
  ];
}

function selectedCommands(state) {
  // Build menu is modal over whatever is selected; the builder is chosen at
  // dispatch time by builderWorker (idle first, then richest node's crew).
  if (state.buildMenu) return buildMenuCommands();
  if (state.selected.kind === 'structure') return COMMANDS.structure[state.selected.type] || [];
  if (state.selected.kind === 'workerGroup') return COMMANDS.workerGroup;
  if (state.selected.kind === 'node') {
    const node = nodeById(state, state.selected.id);
    return node ? nodeCommands(state, node) : [];
  }
  if (state.selected.kind === 'army') return COMMANDS.army[state.selected.type] || [];
  return [];
}

function runCommand(id, all = false) {
  const command = selectedCommands(game).find(item => item.id === id);
  if (!command) return;
  if (!command.enabled(game)) {
    flashError(commandError(game, command));
    return;
  }
  if (all && command.runAll) command.runAll(game);
  else command.run(game);
  clampGame(game);
  render();
}

const RESOURCE_KEYS = ['gold', 'lumber', 'oil'];

// Why a tapped command couldn't run: resource shortfalls come straight from its
// cost, everything else from the command's reason().
function commandError(state, command) {
  if (Array.isArray(command.cost)) {
    for (const { icon, n } of command.cost) {
      if (RESOURCE_KEYS.includes(icon) && state.resources[icon] < n) {
        return `Not enough ${icon}`;
      }
    }
  }
  const r = command.reason ? command.reason(state) : '';
  return r || 'Can’t do that right now';
}

// Fade a command only when it's unavailable for a NON-resource reason. A
// command with an available() reports its non-resource prerequisites; commands
// without one (no resource cost) fade whenever they're disabled.
function commandFaded(state, command) {
  return command.available ? !command.available(state) : !command.enabled(state);
}

// Transient tile flashes (red = taking damage, white = spawn/assignment).
// Keyed by tile identity so they survive the full-rebuild render; entityButton
// applies the class while the entry is fresh, then it expires.
const FLASH_MS = 600;
const tileFlashes = new Map();

function flashTile(key, kind) {
  tileFlashes.set(key, { kind, until: performance.now() + FLASH_MS });
}

function tileFlashClass(key) {
  const f = tileFlashes.get(key);
  if (!f) return null;
  if (f.until <= performance.now()) {
    tileFlashes.delete(key);
    return null;
  }
  return f.kind === 'damage' ? 'flash-damage' : 'flash-spawn';
}

let errorTimer = null;
function flashError(message) {
  if (!message) return;
  dom.error.textContent = message;
  dom.error.classList.add('show');
  if (errorTimer) clearTimeout(errorTimer);
  errorTimer = setTimeout(() => dom.error.classList.remove('show'), 2200);
}

// ── Selection ──────────────────────────────────────────────────────────────

function selectEntity(kind, type, id) {
  game.selected = { kind, type, id };
  game.buildMenu = false;
  render();
}

// Selection must always point at something that still renders; anything that
// disappeared (depleted node, structure consumed by an upgrade, emptied army
// group) falls back to the town hall.
const SELECTION_VALID = {
  structure: (s, sel) => sel.type === 'hall' || s.structures[sel.type] > 0,
  node: (s, sel) => { const n = nodeById(s, sel.id); return !!n && n.remaining > 0; },
  army: (s, sel) => ORDERS.includes(sel.type),
  workerGroup: () => true,
  enemy: () => true
};

function validateSelection(state) {
  const valid = SELECTION_VALID[state.selected.kind];
  if (!valid || !valid(state, state.selected)) {
    state.selected = { kind: 'structure', type: 'hall', id: 1 };
  }
}

// ── Render helpers ─────────────────────────────────────────────────────────

function makeIcon(src, label) {
  const icon = document.createElement('img');
  icon.className = 'icon';
  icon.alt = '';
  icon.decoding = 'async';
  icon.draggable = false;
  icon.src = `${src}?v=${ICON_VERSION}`;
  icon.setAttribute('aria-hidden', 'true');
  if (label) icon.title = label;
  return icon;
}

const RADIAL_SIZE = 44;
const RADIAL_R = 17;
const RADIAL_HIGH_ALPHA = 0.95;
const RADIAL_MIN_ALPHA = 0.45;
const RADIAL_START_ANGLE = -Math.PI / 2; // 12 o'clock

// Canvas-drawn ring: a true conic gradient sweeping from transparent at the
// trailing edge to a bright circular head at the current-progress point,
// instead of many discrete SVG segments approximating a fade.
function radialProgressCanvas(p, siblingCount = 1) {
  const clamped = Math.max(0, Math.min(1, p));
  const peakAlpha = Math.max(RADIAL_MIN_ALPHA, RADIAL_HIGH_ALPHA / siblingCount);
  const dpr = window.devicePixelRatio || 1;

  const canvas = document.createElement('canvas');
  canvas.className = 'radial-progress';
  canvas.width = RADIAL_SIZE * dpr;
  canvas.height = RADIAL_SIZE * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  if (clamped > 0.001) {
    const cx = RADIAL_SIZE / 2;
    const cy = RADIAL_SIZE / 2;
    const endAngle = RADIAL_START_ANGLE + clamped * Math.PI * 2;

    const gradient = ctx.createConicGradient(RADIAL_START_ANGLE, cx, cy);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
    gradient.addColorStop(clamped, `rgba(255, 255, 255, ${peakAlpha})`);

    ctx.beginPath();
    ctx.arc(cx, cy, RADIAL_R, RADIAL_START_ANGLE, endAngle, false);
    ctx.lineWidth = 8;
    ctx.lineCap = 'butt';
    ctx.strokeStyle = gradient;
    ctx.stroke();

    // Clear the head's footprint before filling it, so the translucent fill
    // replaces those pixels instead of blending on top of the gradient tail
    // already painted there — avoids the tip reading dimmer than the back.
    const headR = 4;
    const hx = cx + RADIAL_R * Math.cos(endAngle);
    const hy = cy + RADIAL_R * Math.sin(endAngle);
    ctx.save();
    ctx.beginPath();
    ctx.arc(hx, hy, headR, 0, Math.PI * 2);
    ctx.clip();
    ctx.clearRect(hx - headR - 1, hy - headR - 1, headR * 2 + 2, headR * 2 + 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, peakAlpha * 1.15)})`;
    ctx.fill();
    ctx.restore();
  }
  return canvas;
}

function fmtQty(n) {
  if (n >= 1000) {
    const k = n / 1000;
    return (k >= 10 ? Math.round(k) : k.toFixed(1)) + 'k';
  }
  return String(n);
}

// Per-worker harvest progress for a node — shared by the initial render and
// the ring animator so the math can't drift between them.
function nodeProgressBars(state, node) {
  const cd = nodeCooldown(node);
  const step = state.cheats.fastHarvest ? CHEAT_SPEED : 1;
  return workersAtNode(state, node)
    .map(w => Math.min(1, ((cd - w.cooldown) + tickFraction(step)) / cd));
}

function entityButton({ kind, type, id, icon, label, count, meta, danger, compact, jobIcon, progressBars, nodeId, countLabel, countIcon, hp, dimmed }) {
  const button = document.createElement('button');
  const classes = ['entity'];
  if (danger)  classes.push('danger');
  if (compact) classes.push('compact');
  if (dimmed)  classes.push('dimmed');
  const flash = tileFlashClass(`${kind}:${type}:${id}`);
  if (flash) classes.push(flash);
  button.className = classes.join(' ');
  if (game.selected.kind === kind && game.selected.type === type && String(game.selected.id) === String(id)) {
    button.classList.add('selected');
  }
  button.dataset.kind = kind;
  button.dataset.type = type;
  button.dataset.id = id;
  button.title = label;
  button.setAttribute('aria-label', label);

  button.appendChild(makeIcon(ICONS[icon], label));

  const hasProgress = progressBars && progressBars.length > 0;
  if (jobIcon || hasProgress) {
    const badge = document.createElement('span');
    badge.className = 'job-badge';
    if (nodeId) badge.dataset.nodeId = nodeId;
    if (jobIcon) badge.appendChild(makeIcon(ICONS[jobIcon], meta || jobIcon));
    if (hasProgress) {
      progressBars.forEach(p => badge.appendChild(radialProgressCanvas(p, progressBars.length)));
    }
    button.appendChild(badge);
  }

  // Segmented hp bar: one segment per unit, the last partially drained by the
  // pool's accumulated wounds. Collapses to a single continuous bar for hordes.
  if (hp && hp.segments > 0) {
    const bar = document.createElement('span');
    bar.className = 'hp-bar';
    const segs = hp.segments <= 20 ? hp.segments : 1;
    for (let i = 0; i < segs; i += 1) {
      const seg = document.createElement('span');
      seg.className = 'hp-seg';
      const fill = document.createElement('i');
      const isLast = i === segs - 1;
      const pct = segs === 1 ? hp.total : (isLast ? hp.partial : 1);
      fill.style.width = `${Math.round(Math.max(0, Math.min(1, pct)) * 100)}%`;
      seg.appendChild(fill);
      bar.appendChild(seg);
    }
    button.appendChild(bar);
  }

  if (countLabel != null) {
    const cnt = document.createElement('span');
    cnt.className = 'count-badge';
    if (countIcon) cnt.appendChild(makeIcon(ICONS[countIcon], countIcon));
    const text = document.createElement('span');
    text.textContent = countLabel;
    cnt.appendChild(text);
    button.appendChild(cnt);
  }

  if (!compact) {
    const body = document.createElement('span');
    body.className = 'entity-body';

    const name = document.createElement('strong');
    name.textContent = count != null ? `${label} ${count}` : label;

    const sub = document.createElement('small');
    sub.textContent = meta || '';

    body.append(name, sub);
    button.appendChild(body);
  }
  return button;
}

function orderIcon(order) {
  return { defend: 'defend', patrol: 'patrol', explore: 'explore', attack: 'attack', idle: 'stop' }[order] || 'stop';
}

// ── Render ─────────────────────────────────────────────────────────────────

function render() {
  validateSelection(game);
  dom.day.textContent = `DAY ${currentDay(game) + 1}`;
  renderResources();
  renderWorld();
  renderOrders();
  renderLog();
}

function renderResources() {
  dom.stores.replaceChildren();
  const rows = [
    ['gold',   ICONS.gold,   game.resources.gold],
    ['lumber', ICONS.lumber, game.resources.lumber],
    ['oil',    ICONS.oil,    game.resources.oil],
    ['supply', ICONS.supply, `${supplyUsed(game)}/${supplyCap(game)}`]
  ];

  rows.forEach(([label, icon, value]) => {
    const item = document.createElement('div');
    item.className = 'resource';
    item.title = label;
    item.append(makeIcon(icon, label));
    const amount = document.createElement('strong');
    amount.textContent = value;
    item.appendChild(amount);
    dom.stores.appendChild(item);
  });
}

// One chip per in-flight job (training unit, construction, or upgrade) — each
// shows its own progress ring and cancels (with refund) when tapped.
function jobChip(job) {
  const chip = document.createElement('button');
  chip.className = 'construction-chip';
  chip.dataset.jobUid = job.uid;
  chip.title = `${job.label} — tap to cancel, refund resources`;
  chip.setAttribute('aria-label', `cancel ${job.label}`);
  chip.appendChild(makeIcon(ICONS[job.icon], job.label));
  chip.appendChild(radialProgressCanvas(jobProgress(game, job)));
  chip.addEventListener('click', () => {
    cancelJob(game, job.uid);
    render();
  });
  return chip;
}

function renderJobQueue() {
  if (!game.jobs.length) return null;
  const list = document.createElement('div');
  list.className = 'construction-queue';
  game.jobs.forEach(job => list.appendChild(jobChip(job)));
  return list;
}

function renderWorld() {
  dom.world.replaceChildren();

  const structures = document.createElement('section');
  structures.className = 'world-group structures';
  structures.appendChild(entityButton({
    kind: 'structure', type: 'hall', id: 1, compact: true,
    icon: 'hall', label: 'town hall'
  }));

  // One tile per built structure type (with a count badge), from the table.
  Object.keys(BUILDINGS).forEach(key => {
    if (key === 'hall' || game.structures[key] <= 0) return;
    structures.appendChild(entityButton({
      kind: 'structure', type: key, id: 1, compact: true,
      icon: BUILDINGS[key].icon, label: BUILDINGS[key].label,
      countLabel: game.structures[key]
    }));
  });

  const jobQueue = renderJobQueue();
  if (jobQueue) structures.appendChild(jobQueue);

  // A horizontally scrollable row (see .world-group.workers) of the live
  // resource nodes — each shows its worker count and a harvest ring per worker;
  // the amount remaining is in the command card. Depleted nodes are hidden. The
  // idle-workers tile only appears when there's nothing left to harvest.
  const workers = document.createElement('section');
  workers.className = 'world-group workers';

  const liveNodes = game.nodes.filter(n => n.remaining > 0);

  if (liveNodes.length === 0) {
    const idleCount = workerCount(game, 'idle');
    workers.appendChild(entityButton({
      kind: 'workerGroup', type: 'idle', id: 1,
      icon: 'worker', label: 'idle workers', compact: true,
      countLabel: idleCount, dimmed: idleCount === 0
    }));
  }

  liveNodes.forEach(node => {
    workers.appendChild(entityButton({
      kind: 'node', type: node.type, id: node.id,
      icon: node.icon, label: `${node.label} (dist ${node.distance})`, compact: true,
      progressBars: nodeProgressBars(game, node), nodeId: node.id,
      countLabel: workersAtNode(game, node).length, countIcon: 'worker'
    }));
  });

  // My army: one tile per standing order, workers-row style — tap to select,
  // then move units between orders one per tap.
  const army = document.createElement('section');
  army.className = 'world-group army';
  ORDERS.forEach(order => {
    const n = unitsOnOrder(game, order);
    army.appendChild(entityButton({
      kind: 'army', type: order, id: 1, compact: true,
      icon: orderIcon(order), label: order,
      countLabel: n, countIcon: 'footman', dimmed: n === 0,
      hp: poolHp(game.army[order])
    }));
  });

  // Enemies get their own row below: the enemy base plus active raiding parties.
  const enemies = document.createElement('section');
  enemies.className = 'world-group enemies';

  const enemyCount = game.enemy.known ? Math.ceil(game.enemy.strength) : '??';
  const enemyMeta  = game.enemy.known ? 'enemy base' : 'uncharted';
  enemies.appendChild(entityButton({
    kind: 'enemy', type: 'enemy', id: 1,
    icon: 'enemyBase', label: 'enemy', count: enemyCount, meta: enemyMeta, danger: true,
    // Debug: ring fills as the next raid approaches (updates once per tick).
    progressBars: [Math.max(0, Math.min(1, (game.raid.interval - game.raid.nextIn) / game.raid.interval))]
  }));

  // Active raiding parties, one danger tile each: grunt count + what they're up to.
  game.raids.forEach(raid => {
    const meta = raid.arriveIn > 0 ? 'approaching'
               : raid.targetType ? `razing ${BUILDINGS[raid.targetType].label}`
               : 'attacking';
    enemies.appendChild(entityButton({
      kind: 'enemy', type: 'raid', id: raid.id,
      icon: 'enemy', label: 'raiders', count: raid.size, meta, danger: true,
      hp: raidHp(raid)
    }));
  });

  dom.world.append(structures, workers, army, enemies);
}

function productionMeta(state, producer) {
  const jobs = trainJobs(state, producer);
  if (!jobs.length) return '';
  const queued = jobs.length - 1;
  return queued > 0 ? `${jobs[0].label} ${jobs[0].remaining}s +${queued}` : `${jobs[0].label} ${jobs[0].remaining}s`;
}

function entityInfo(state) {
  const { kind, type } = state.selected;
  if (state.buildMenu) return 'Choose a building';
  if (kind === 'structure') {
    const b = BUILDINGS[type];
    if (!b) return type;
    return typeof b.blurb === 'function' ? b.blurb(state) : (b.blurb || cap(b.label));
  }
  if (kind === 'workerGroup') {
    return `idle workers ×${workerCount(state, 'idle')}`;
  }
  if (kind === 'node') {
    const node = nodeById(state, state.selected.id);
    if (!node) return type;
    const n = workersAtNode(state, node).length;
    const status = node.remaining <= 0 ? 'depleted' : `${fmtQty(node.remaining)} left`;
    return `${node.label} · ${status} · dist ${node.distance} · ${n} working`;
  }
  if (kind === 'army') {
    const pool = state.army[type];
    if (!pool) return type;
    const parts = Object.keys(ARMY).filter(k => pool[k] > 0).map(k => `${pool[k]} ${ARMY[k].label}`);
    return `${type} · ${parts.length ? parts.join(', ') : 'no units'}`;
  }
  return '';
}

function renderOrders() {
  dom.orders.replaceChildren();

  const info = document.createElement('div');
  info.className = 'command-info';
  info.textContent = entityInfo(game);
  dom.orders.appendChild(info);

  selectedCommands(game).forEach((command, index) => {
    const button = document.createElement('button');
    button.className = 'command';
    button.dataset.command = command.id;
    if (commandFaded(game, command)) button.classList.add('unavailable');
    if (command.isActive && command.isActive(game)) button.classList.add('active-order');
    button.title = command.runAll ? `${command.label} — hold to move all` : command.label;
    button.setAttribute('aria-label', command.label);

    button.appendChild(makeIcon(ICONS[command.icon], command.label));

    if (command.overlay) {
      const overlay = document.createElement('img');
      overlay.className = 'command-overlay';
      overlay.src = `${ICONS[command.overlay]}?v=${ICON_VERSION}`;
      overlay.alt = '';
      overlay.draggable = false;
      overlay.setAttribute('aria-hidden', 'true');
      button.appendChild(overlay);
    }

    if (index < 9) {
      const hotkey = document.createElement('span');
      hotkey.className = 'command-hotkey';
      hotkey.textContent = index + 1;
      button.appendChild(hotkey);
    }

    if (Array.isArray(command.cost)) {
      const costEl = document.createElement('span');
      costEl.className = 'command-cost-icons';
      command.cost.forEach(({ icon, n }) => {
        const img = document.createElement('img');
        img.className = 'cost-icon';
        img.src = `${ICONS[icon]}?v=${ICON_VERSION}`;
        img.alt = icon;
        img.draggable = false;
        costEl.appendChild(img);
        const amt = document.createElement('span');
        amt.className = 'cost-amt';
        amt.textContent = n;
        costEl.appendChild(amt);
      });
      button.appendChild(costEl);
    }

    dom.orders.appendChild(button);
  });
}

function renderLog() {
  dom.log.replaceChildren();
  game.log.forEach(line => {
    const item = document.createElement('p');
    item.textContent = line;
    dom.log.appendChild(item);
  });
}

// Smooth ring animation between ticks. Two uniform cases cover everything:
// job chips (any kind) and node harvest badges — new jobs or nodes never need
// changes here.
function updateProgressRings() {
  document.querySelectorAll('.construction-chip[data-job-uid]').forEach(chip => {
    const job = game.jobs.find(j => j.uid === Number(chip.dataset.jobUid));
    if (!job) return;
    chip.querySelectorAll('.radial-progress').forEach(el => el.remove());
    chip.appendChild(radialProgressCanvas(jobProgress(game, job)));
  });

  document.querySelectorAll('.job-badge[data-node-id]').forEach(badge => {
    const node = nodeById(game, badge.dataset.nodeId);
    const values = node ? nodeProgressBars(game, node) : [];
    badge.querySelectorAll('.radial-progress').forEach(el => el.remove());
    values.forEach(p => badge.appendChild(radialProgressCanvas(p, values.length)));
  });
}

// ── Input ──────────────────────────────────────────────────────────────────

function installZoomGuards() {
  let lastTouchEnd = 0;
  document.addEventListener('gesturestart',  e => e.preventDefault(), { passive: false });
  document.addEventListener('gesturechange', e => e.preventDefault(), { passive: false });
  document.addEventListener('gestureend',    e => e.preventDefault(), { passive: false });
  document.addEventListener('touchend', e => {
    // Suppress double-tap-to-zoom on empty chrome, but never on interactive
    // controls — preventing default there cancels the follow-up click, which
    // is what made rapid taps (e.g. queuing several units) feel dropped.
    if (e.target.closest('button, summary, a, [data-command], .entity, .construction-chip')) return;
    const now = Date.now();
    if (now - lastTouchEnd <= 320) e.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });
}

const menu = document.querySelector('.menu');
document.addEventListener('click', event => {
  if (menu.open && !menu.contains(event.target)) menu.open = false;
});

// Select on pointerup rather than click so selection lands immediately on
// finger-lift (no synthetic-click latency). A movement threshold distinguishes
// a tap from a horizontal scroll of the node/worker row, so dragging to scroll
// doesn't change selection.
let worldTap = null;
dom.world.addEventListener('pointerdown', event => {
  const button = event.target.closest('.entity');
  worldTap = button ? { id: event.pointerId, x: event.clientX, y: event.clientY, button } : null;
}, { passive: true });
dom.world.addEventListener('pointerup', event => {
  const tap = worldTap;
  worldTap = null;
  if (!tap || event.pointerId !== tap.id) return;
  if (Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 10) return;
  if (tap.button.dataset.kind === 'enemy') return;
  selectEntity(tap.button.dataset.kind, tap.button.dataset.type, tap.button.dataset.id);
}, { passive: true });
dom.world.addEventListener('pointercancel', () => { worldTap = null; });

// Press-and-hold on a command with a runAll (harvest, army moves) transfers
// everything at once; a quick tap still moves one. The hold timer fires the
// bulk action and suppresses the click that follows pointerup.
const HOLD_MS = 500;
let orderHold = null;
dom.orders.addEventListener('pointerdown', event => {
  const button = event.target.closest('button[data-command]');
  if (!button) return;
  const id = button.dataset.command;
  orderHold = {
    id, fired: false,
    timer: setTimeout(() => {
      if (!orderHold || orderHold.id !== id) return;
      orderHold.fired = true;
      runCommand(id, true);
    }, HOLD_MS)
  };
}, { passive: true });
['pointerup', 'pointercancel', 'pointerleave'].forEach(type => {
  dom.orders.addEventListener(type, () => {
    if (orderHold) clearTimeout(orderHold.timer);
  }, { passive: true });
});
dom.orders.addEventListener('contextmenu', event => event.preventDefault());
dom.orders.addEventListener('click', event => {
  const button = event.target.closest('button[data-command]');
  if (!button) return;
  if (orderHold && orderHold.fired && orderHold.id === button.dataset.command) {
    orderHold = null;   // the hold already ran the bulk action
    return;
  }
  orderHold = null;
  runCommand(button.dataset.command);
});

document.addEventListener('keydown', event => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const n = Number(event.key);
  if (!Number.isInteger(n) || n < 1 || n > 9) return;
  const button = dom.orders.querySelectorAll('button[data-command]')[n - 1];
  if (!button) return;
  button.click();
});

document.getElementById('cheat-btn').addEventListener('click', () => {
  game.resources.gold   += 10000;
  game.resources.lumber += 10000;
  game.resources.oil    += 10000;
  render();
});

function bindCheatToggle(buttonId, key) {
  const button = document.getElementById(buttonId);
  button.classList.toggle('active', game.cheats[key]);
  button.addEventListener('click', () => {
    game.cheats[key] = !game.cheats[key];
    button.classList.toggle('active', game.cheats[key]);
  });
}
bindCheatToggle('cheat-train', 'fastTrain');
bindCheatToggle('cheat-harvest', 'fastHarvest');

document.getElementById('version').textContent = `v${VERSION} · ${VERSION_TAG}`;

document.getElementById('cheat-raid').addEventListener('click', () => {
  spawnRaid(game);
  render();
});
document.getElementById('cheat-footman').addEventListener('click', () => {
  game.army.defend.footmen += 1;
  render();
});

// ── Boot ───────────────────────────────────────────────────────────────────

function spawnStartingWorkers(remaining) {
  if (remaining <= 0) return;
  game.workers.push(createWorker());
  autoAssignWorkers(game);   // heads to gold immediately
  render();
  if (remaining > 1) setTimeout(() => spawnStartingWorkers(remaining - 1), 1000);
}

render();
spawnStartingWorkers(4);

setInterval(gameTick, TICK_MS);
setInterval(updateProgressRings, 100);
