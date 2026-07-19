const MAX_LOG_LINES = 9;
const ICON_VERSION = '20260719-design1';
const HARVEST_YIELD = 100;
const HARVEST_GATHER = { gold: 6, lumber: 12 };   // ticks spent gathering at the node itself
const TRAVEL_PER_DISTANCE = 2;                     // extra ticks per distance unit (round trip to town hall)
const NODE_DEFS = [
  { id: 'gold-1',   type: 'gold',   label: 'gold mine',  icon: 'goldSite',   distance: 1, capacity: 20000 },
  { id: 'forest-1', type: 'lumber', label: 'forest',     icon: 'lumberSite', distance: 1, capacity: 25000 },
  { id: 'forest-2', type: 'lumber', label: 'far forest', icon: 'lumberSite', distance: 5, capacity: 25000 }
];
const TICK_MS = 1000;
const DAY_TICKS = 60;
const QUEUE_MAX = 5;
const EXPLORE_THRESHOLD = 90;   // explore-unit-ticks to find enemy base
const RAID_INTERVAL_BASE = 90;  // ticks between raids on day 0
const RAID_INTERVAL_SCALE = 8;  // reduce interval by this per day
const RAID_INTERVAL_MIN = 25;
const SOLDIER_POWER = 3;
const ARCHER_POWER = 2;
const SOLDIER_ATTACK = 0.10;    // enemy strength reduced per soldier per tick on attack
const ARCHER_ATTACK = 0.06;
const ENEMY_REBUILD = 0.05;     // enemy strength rebuilt per tick
const RAID_BASE_STRENGTH = 3;   // raid strength = this + day * 2
const TOWER_POWER = 2;          // base-defense contribution per tower
const GUARD_TOWER_POWER = 4;    // per guard tower
const CHEAT_SPEED = 5;          // multiplier applied by fast-train / fast-harvest toggles

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

const ICONS = {
  gold: 'assets/icons/r_gold.png',
  lumber: 'assets/icons/r_lumber.png',
  oil: 'assets/icons/r_oil.png',
  supply: 'assets/icons/r_food.png',
  worker: 'assets/icons/h_unit_peasant.png',
  goldSite: 'assets/icons/n_bld_goldmine.png',
  lumberSite: 'assets/icons/n_bld_forest.png',
  soldier: 'assets/icons/h_unit_footman.png',
  archer: 'assets/icons/h_unit_archer.png',
  hall: 'assets/icons/h_bld_townhall.png',
  farm: 'assets/icons/h_bld_farm.png',
  barracks: 'assets/icons/h_bld_barracks.png',
  lumbermill: 'assets/icons/h_bld_lumbermill.png',
  blacksmith: 'assets/icons/h_bld_blacksmith.png',
  tower: 'assets/icons/h_bld_tower.png',
  guardtower: 'assets/icons/h_bld_watchtower.png',
  enemy: 'assets/icons/o_unit_grunt.png',
  attack: 'assets/icons/c_sword1.png',
  stop: 'assets/icons/c_stop.png',
  defend: 'assets/icons/c_hshield1.png',
  patrol: 'assets/icons/c_hpatrol.png',
  explore: 'assets/icons/c_hmove.png',
  build: 'assets/icons/c_build.png',
  harvest: 'assets/icons/c_harvest.png'
};

let idCounter = 0;
const game = createGame();

function createGame() {
  return {
    tick: 0,
    selected: { kind: 'structure', type: 'hall', id: 1 },
    resources: { gold: 100, lumber: 100, oil: 0 },
    production: [],
    constructions: [],
    buildMenu: false,
    buildSource: null,
    workers: [],
    nodes: NODE_DEFS.map(d => ({ ...d, remaining: d.capacity })),
    units: {
      soldiers: { count: 0, order: 'defend' },
      archers:  { count: 0, order: 'defend' }
    },
    structures: {
      hall: 1,
      farms: 0,
      barracks: 0,
      lumbermill: 0,
      blacksmith: 0,
      towers: 0,
      guardtowers: 0
    },
    upgrades: [],
    enemy: { strength: 20, known: false },
    exploreProgress: 0,
    raid: { nextIn: RAID_INTERVAL_BASE },
    log: ['Town hall ready.', 'Workers await orders.'],
    cheats: { fastTrain: false, fastHarvest: false }
  };
}

function createWorker(job = 'idle', nodeId = null, cooldown = 0) {
  return { id: nextId(), job, nodeId, cooldown };
}

function nextId() {
  idCounter += 1;
  return idCounter;
}

// ── Army order commands ────────────────────────────────────────────────────

function makeOrderCommands(unitType) {
  return [
    {
      id: `${unitType}-defend`,
      icon: 'defend', label: 'defend', cost: 'hold base',
      enabled: s => s.units[unitType].count > 0,
      isActive: s => s.units[unitType].order === 'defend',
      run: s => setOrder(s, unitType, 'defend')
    },
    {
      id: `${unitType}-patrol`,
      icon: 'patrol', label: 'patrol', cost: 'perimeter',
      enabled: s => s.units[unitType].count > 0,
      isActive: s => s.units[unitType].order === 'patrol',
      run: s => setOrder(s, unitType, 'patrol')
    },
    {
      id: `${unitType}-explore`,
      icon: 'explore', label: 'explore', cost: 'scout map',
      enabled: s => s.units[unitType].count > 0,
      isActive: s => s.units[unitType].order === 'explore',
      run: s => setOrder(s, unitType, 'explore')
    },
    {
      id: `${unitType}-attack`,
      icon: 'attack', label: 'attack', cost: 'vs enemy',
      enabled: s => s.units[unitType].count > 0 && s.enemy.known,
      reason: s => !s.enemy.known ? 'Enemy not found — explore first' : '',
      isActive: s => s.units[unitType].order === 'attack',
      run: s => setOrder(s, unitType, 'attack')
    }
  ];
}

function setOrder(state, unitType, order) {
  state.units[unitType].order = order;
  writeLog(state, `${unitType === 'soldiers' ? 'Footmen' : 'Archers'}: ${order}.`);
}

// Build times are the real Warcraft II values (in seconds).
const BUILDABLE_STRUCTURES = [
  {
    type: 'farm', icon: 'farm', label: 'build farm', duration: 100,
    cost: { gold: 500, lumber: 250 },
    complete: state => { state.structures.farms += 1; writeLog(state, 'Farm complete.'); }
  },
  {
    type: 'barracks', icon: 'barracks', label: 'build barracks', duration: 200,
    cost: { gold: 700, lumber: 450 },
    complete: state => { state.structures.barracks += 1; selectEntity('structure', 'barracks', 1); writeLog(state, 'Barracks complete.'); }
  },
  {
    type: 'lumbermill', icon: 'lumbermill', label: 'build lumber mill', duration: 150,
    cost: { gold: 600, lumber: 450 },
    complete: state => { state.structures.lumbermill += 1; writeLog(state, 'Lumber mill complete.'); }
  },
  {
    type: 'blacksmith', icon: 'blacksmith', label: 'build blacksmith', duration: 200,
    cost: { gold: 800, lumber: 450 },
    complete: state => { state.structures.blacksmith += 1; writeLog(state, 'Blacksmith complete.'); }
  },
  {
    type: 'tower', icon: 'tower', label: 'build tower', duration: 60,
    cost: { gold: 550, lumber: 200 },
    complete: state => { state.structures.towers += 1; writeLog(state, 'Tower complete.'); }
  }
];

const GUARD_TOWER_COST = { gold: 500, lumber: 150 };
const GUARD_TOWER_TIME = 140;

function costIcons(cost) {
  return Object.entries(cost).map(([icon, n]) => ({ icon, n }));
}

const COMMANDS = {
  structure: {
    hall: [
      {
        id: 'train-worker',
        icon: 'worker', label: 'train worker', cost: [{ icon: 'gold', n: 400 }, { icon: 'supply', n: 1 }], duration: 45, producer: 'hall',
        available: s => supplyUsed(s) + supplyReserved(s) < supplyCap(s) && queueLength(s, 'hall') < queueMax(s, 'hall'),
        enabled: s => s.resources.gold >= 400 && supplyUsed(s) + supplyReserved(s) < supplyCap(s) && queueLength(s, 'hall') < queueMax(s, 'hall'),
        reason: s => supplyUsed(s) + supplyReserved(s) >= supplyCap(s) ? 'Supply capped — build a farm'
                   : queueLength(s, 'hall') >= queueMax(s, 'hall') ? 'Queue full' : '',
        run: s => startProduction(s, {
          id: 'train-worker', producer: 'hall', icon: 'worker', label: 'worker', duration: 45,
          cost: { gold: 400 },
          complete: state => { state.workers.push(createWorker('idle')); autoAssignWorkers(state); writeLog(state, 'Worker ready.'); }
        })
      }
    ],
    barracks: [
      {
        id: 'train-soldier',
        icon: 'soldier', label: 'train footman', cost: [{ icon: 'gold', n: 600 }, { icon: 'supply', n: 1 }], duration: 60, producer: 'barracks',
        available: s => s.structures.barracks > 0 && supplyUsed(s) + supplyReserved(s) < supplyCap(s) && queueLength(s, 'barracks') < queueMax(s, 'barracks'),
        enabled: s => s.structures.barracks > 0 && s.resources.gold >= 600 && supplyUsed(s) + supplyReserved(s) < supplyCap(s) && queueLength(s, 'barracks') < queueMax(s, 'barracks'),
        reason: s => supplyUsed(s) + supplyReserved(s) >= supplyCap(s) ? 'Supply capped — build a farm'
                   : queueLength(s, 'barracks') >= queueMax(s, 'barracks') ? 'Queue full' : '',
        run: s => startProduction(s, {
          id: 'train-soldier', producer: 'barracks', icon: 'soldier', label: 'footman', duration: 60,
          cost: { gold: 600 },
          complete: state => { state.units.soldiers.count += 1; writeLog(state, 'Footman ready.'); }
        })
      },
      {
        id: 'train-archer',
        icon: 'archer', label: 'train archer', cost: [{ icon: 'gold', n: 500 }, { icon: 'lumber', n: 50 }, { icon: 'supply', n: 1 }], duration: 70, producer: 'barracks',
        available: s => s.structures.barracks > 0 && s.structures.lumbermill > 0 && supplyUsed(s) + supplyReserved(s) < supplyCap(s) && queueLength(s, 'barracks') < queueMax(s, 'barracks'),
        enabled: s => s.structures.barracks > 0 && s.structures.lumbermill > 0 && s.resources.gold >= 500 && s.resources.lumber >= 50 && supplyUsed(s) + supplyReserved(s) < supplyCap(s) && queueLength(s, 'barracks') < queueMax(s, 'barracks'),
        reason: s => s.structures.lumbermill === 0 ? 'Need a lumber mill'
                   : supplyUsed(s) + supplyReserved(s) >= supplyCap(s) ? 'Supply capped — build a farm'
                   : queueLength(s, 'barracks') >= queueMax(s, 'barracks') ? 'Queue full' : '',
        run: s => startProduction(s, {
          id: 'train-archer', producer: 'barracks', icon: 'archer', label: 'archer', duration: 70,
          cost: { gold: 500, lumber: 50 },
          complete: state => { state.units.archers.count += 1; writeLog(state, 'Archer ready.'); }
        })
      },
    ],
    tower: [
      {
        id: 'upgrade-guardtower', icon: 'guardtower', label: 'upgrade to guard tower', cost: costIcons(GUARD_TOWER_COST),
        available: s => s.structures.towers > pendingGuardTowers(s) && s.structures.lumbermill > 0,
        enabled: s => s.structures.towers > pendingGuardTowers(s) && s.structures.lumbermill > 0 && canAfford(s, GUARD_TOWER_COST),
        reason: s => s.structures.lumbermill === 0 ? 'Need a lumber mill'
                   : s.structures.towers <= pendingGuardTowers(s) ? 'No tower free to upgrade' : '',
        run: s => startUpgrade(s, {
          kind: 'guardtower', icon: 'guardtower', label: 'guard tower', duration: GUARD_TOWER_TIME, cost: GUARD_TOWER_COST,
          complete: st => { st.structures.towers -= 1; st.structures.guardtowers += 1; writeLog(st, 'Guard tower ready.'); }
        })
      }
    ]
  },
  workerGroup: [
    { id: 'wg-construct', icon: 'build', label: 'construct', cost: 'idle worker',
      enabled: s => jobCount(s, 'idle') > 0,
      run: s => { s.buildMenu = true; s.buildSource = 'idle'; } }
  ],
  army: {
    soldiers: makeOrderCommands('soldiers'),
    archers: makeOrderCommands('archers')
  }
};

// ── Worker helpers ─────────────────────────────────────────────────────────

function jobCount(state, job) {
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

// Workers are pinned to a specific node (worker.nodeId); this lists the ones on
// a given node. No "nearest" routing — a worker stays on its node until it's
// depleted, then goes idle and auto-assign re-places it.
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

function sendWorkerToNode(state, node) {
  if (node.remaining <= 0) return;
  const worker = spareWorker(state, node);
  if (!worker) return;
  worker.job = node.type;
  worker.nodeId = node.id;
  worker.cooldown = nodeCooldown(node);
  writeLog(state, `Worker → ${node.label}.`);
}

// Idle workers don't sit around: they mine gold, or cut wood if no gold is
// left. Keeps the economy running without manual assignment.
function autoAssignWorkers(state) {
  state.workers.forEach(w => {
    if (w.job !== 'idle') return;
    const node = firstNodeOfType(state, 'gold') || firstNodeOfType(state, 'lumber');
    if (!node) return;
    w.job = node.type;
    w.nodeId = node.id;
    w.cooldown = nodeCooldown(node);
  });
}

// ── Production helpers ─────────────────────────────────────────────────────

function queueLength(state, producer) {
  return state.production.filter(job => job.producer === producer).length;
}

// Total queue depth allowed scales with building count: QUEUE_MAX per structure
// (5 barracks → up to 25 queued, with producerCapacity advancing at once).
function queueMax(state, producer) {
  return QUEUE_MAX * producerCapacity(state, producer);
}

function producerCapacity(state, producer) {
  return state.structures[producer] || 1;
}

function activeProductionJobs(state, producer) {
  return state.production
    .filter(job => job.producer === producer)
    .slice(0, producerCapacity(state, producer));
}

function canAfford(state, cost) {
  return Object.keys(cost).every(key => state.resources[key] >= cost[key]);
}

function spend(state, cost) {
  Object.keys(cost).forEach(key => { state.resources[key] -= cost[key]; });
}

function supplyReserved(state) {
  return state.production.filter(j => ['train-worker', 'train-soldier', 'train-archer'].includes(j.id)).length;
}

function startProduction(state, job) {
  if (queueLength(state, job.producer) >= queueMax(state, job.producer) || !canAfford(state, job.cost)) return;
  spend(state, job.cost);
  state.production.push({ ...job, uid: nextId(), remaining: job.duration });
  const depth = queueLength(state, job.producer);
  writeLog(state, depth > 1 ? `${job.label}: queued (${depth}).` : `${job.label}: started.`);
}

function cancelJobByUid(state, uid) {
  const job = state.production.find(j => j.uid === uid);
  if (!job) return;
  state.production = state.production.filter(j => j !== job);
  Object.keys(job.cost).forEach(k => { state.resources[k] += job.cost[k]; });
  writeLog(state, `${job.label}: cancelled, refunded.`);
}

// Progress for a single queued/training unit. Only the first `capacity` jobs
// per producer are actually advancing; jobs beyond that are still queued (0).
function jobProgress(state, job) {
  if (!activeProductionJobs(state, job.producer).includes(job)) return 0;
  const step = state.cheats.fastTrain ? CHEAT_SPEED : 1;
  return Math.min(1, ((job.duration - job.remaining) + tickFraction(step)) / job.duration);
}

function advanceProduction(state) {
  const step = state.cheats.fastTrain ? CHEAT_SPEED : 1;
  const advancedCounts = {};
  state.production.forEach(job => {
    const cap = producerCapacity(state, job.producer);
    const advanced = advancedCounts[job.producer] || 0;
    if (advanced < cap) {
      advancedCounts[job.producer] = advanced + 1;
      job.remaining -= step;
    }
  });
  const done = state.production.filter(job => job.remaining <= 0);
  state.production = state.production.filter(job => job.remaining > 0);
  done.forEach(job => job.complete(state));
}

// ── Construction (worker-built structures) ──────────────────────────────────

// source is 'idle' or a node id — which worker pool to pull the builder from.
function matchesSource(worker, source) {
  return source === 'idle' ? worker.job === 'idle' : worker.nodeId === source;
}

function startConstruction(state, source, building) {
  if (!canAfford(state, building.cost)) return;
  const worker = state.workers.find(w => matchesSource(w, source));
  if (!worker) return;
  spend(state, building.cost);
  // The builder remembers which node it came off, so it returns there when done
  // (or auto-reassigns if that node has been depleted meanwhile).
  const returnTo = worker.nodeId;
  worker.job = 'building';
  worker.nodeId = null;
  worker.cooldown = 0;
  state.constructions.push({
    id: nextId(), workerId: worker.id, type: building.type, returnTo,
    icon: building.icon, label: building.label,
    duration: building.duration, remaining: building.duration,
    cost: building.cost, complete: building.complete
  });
  state.buildMenu = false;
  writeLog(state, `${building.label}: worker dispatched.`);
}

function releaseBuilder(state, workerId, returnTo = null) {
  const worker = state.workers.find(w => w.id === workerId);
  if (!worker) return;
  const node = returnTo ? nodeById(state, returnTo) : null;
  if (node && node.remaining > 0) {
    worker.job = node.type;
    worker.nodeId = node.id;
    worker.cooldown = nodeCooldown(node);
  } else {
    worker.job = 'idle';        // original node is gone/depleted; auto-assign re-routes it
    worker.nodeId = null;
    worker.cooldown = 0;
  }
}

function cancelConstruction(state, id) {
  const c = state.constructions.find(x => x.id === id);
  if (!c) return;
  state.constructions = state.constructions.filter(x => x.id !== id);
  Object.keys(c.cost).forEach(k => { state.resources[k] += c.cost[k]; });
  releaseBuilder(state, c.workerId, c.returnTo);
  writeLog(state, `${c.label}: cancelled, refunded.`);
}

function advanceConstructions(state) {
  const step = state.cheats.fastTrain ? CHEAT_SPEED : 1;
  state.constructions.forEach(c => { c.remaining -= step; });
  const done = state.constructions.filter(c => c.remaining <= 0);
  state.constructions = state.constructions.filter(c => c.remaining > 0);
  done.forEach(c => {
    releaseBuilder(state, c.workerId, c.returnTo);
    c.complete(state);
  });
}

// ── Upgrades (timed building upgrades, no worker) ───────────────────────────

function pendingGuardTowers(state) {
  return state.upgrades.filter(u => u.kind === 'guardtower').length;
}

function startUpgrade(state, spec) {
  if (!canAfford(state, spec.cost)) return;
  spend(state, spec.cost);
  state.upgrades.push({ id: nextId(), remaining: spec.duration, ...spec });
  writeLog(state, `${spec.label}: upgrading.`);
}

function cancelUpgrade(state, id) {
  const u = state.upgrades.find(x => x.id === id);
  if (!u) return;
  state.upgrades = state.upgrades.filter(x => x.id !== id);
  Object.keys(u.cost).forEach(k => { state.resources[k] += u.cost[k]; });
  writeLog(state, `${u.label}: upgrade cancelled, refunded.`);
}

function advanceUpgrades(state) {
  const step = state.cheats.fastTrain ? CHEAT_SPEED : 1;
  state.upgrades.forEach(u => { u.remaining -= step; });
  const done = state.upgrades.filter(u => u.remaining <= 0);
  state.upgrades = state.upgrades.filter(u => u.remaining > 0);
  done.forEach(u => u.complete(state));
}

// ── Army helpers ───────────────────────────────────────────────────────────

function orderPower(state, order) {
  let power = 0;
  if (state.units.soldiers.order === order) power += state.units.soldiers.count * SOLDIER_POWER;
  if (state.units.archers.order  === order) power += state.units.archers.count  * ARCHER_POWER;
  return power;
}

function totalArmyPower(state) {
  return state.units.soldiers.count * SOLDIER_POWER + state.units.archers.count * ARCHER_POWER;
}

// ── Raid ───────────────────────────────────────────────────────────────────

function triggerRaid(state) {
  const day = currentDay(state);
  const strength = RAID_BASE_STRENGTH + day * 2;

  const patrolPower = orderPower(state, 'patrol');
  const afterPatrol = Math.max(0, strength - patrolPower);

  if (afterPatrol === 0) {
    writeLog(state, `Day ${day + 1}: Raid intercepted by patrol.`);
    return;
  }

  const towerPower = state.structures.towers * TOWER_POWER + state.structures.guardtowers * GUARD_TOWER_POWER;
  const defendPower = orderPower(state, 'defend') + towerPower;
  const afterDefend = Math.max(0, afterPatrol - defendPower);

  if (afterDefend === 0) {
    writeLog(state, `Day ${day + 1}: Raid repelled at base.`);
    return;
  }

  const goldLost = afterDefend * 40;
  state.resources.gold = Math.max(0, state.resources.gold - goldLost);
  writeLog(state, `Day ${day + 1}: Base raided! ${goldLost} gold lost.`);
}

// ── Tick ───────────────────────────────────────────────────────────────────

function currentDay(state) {
  return Math.floor(state.tick / DAY_TICKS);
}

function gameTick() {
  game.tick += 1;
  lastTickAt = performance.now();

  // Idle workers pick up gold (or wood) on their own before harvesting resolves.
  autoAssignWorkers(game);

  // Harvest — each worker draws from the specific node it's pinned to; when that
  // node runs dry the worker goes idle (auto-assign re-places it next tick).
  const harvestStep = game.cheats.fastHarvest ? CHEAT_SPEED : 1;
  game.workers.forEach(worker => {
    if (worker.job !== 'gold' && worker.job !== 'lumber') return;
    const node = nodeById(game, worker.nodeId);
    if (!node || node.remaining <= 0) {
      worker.job = 'idle'; worker.nodeId = null; worker.cooldown = 0;
      return;
    }
    worker.cooldown -= harvestStep;
    if (worker.cooldown > 0) return;
    const gained = Math.min(HARVEST_YIELD, node.remaining);
    node.remaining -= gained;
    if (worker.job === 'gold')   game.resources.gold   += gained;
    if (worker.job === 'lumber') game.resources.lumber += gained;
    worker.cooldown = nodeCooldown(node);
    if (node.remaining <= 0) {
      node.remaining = 0;
      writeLog(game, `${node.label} depleted.`);
    }
  });

  // Exploration — accumulate per exploring unit; discover when threshold reached
  if (!game.enemy.known) {
    const explorers = (game.units.soldiers.order === 'explore' ? game.units.soldiers.count : 0)
                    + (game.units.archers.order  === 'explore' ? game.units.archers.count  : 0);
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
    const soldierAttack = game.units.soldiers.order === 'attack' ? game.units.soldiers.count * SOLDIER_ATTACK : 0;
    const archerAttack  = game.units.archers.order  === 'attack' ? game.units.archers.count  * ARCHER_ATTACK  : 0;
    game.enemy.strength = Math.max(0, game.enemy.strength - soldierAttack - archerAttack);
    if (game.enemy.strength === 0) {
      writeLog(game, 'Enemy base destroyed! Victory!');
    }
  }

  // Enemy slowly rebuilds
  game.enemy.strength += ENEMY_REBUILD;

  // Raids
  game.raid.nextIn -= 1;
  if (game.raid.nextIn <= 0) {
    triggerRaid(game);
    const day = currentDay(game);
    game.raid.nextIn = Math.max(RAID_INTERVAL_MIN, RAID_INTERVAL_BASE - day * RAID_INTERVAL_SCALE);
  }

  advanceProduction(game);
  advanceConstructions(game);
  advanceUpgrades(game);
  clampGame(game);
  render();
}

// ── Selection ──────────────────────────────────────────────────────────────

function selectedCommands(state) {
  // Build menu is modal over whatever is selected; buildSource records which
  // worker pool to pull the builder from (idle, or a resource type from a node).
  if (state.buildMenu) {
    const source = state.buildSource || 'idle';
    return [
      ...BUILDABLE_STRUCTURES.map(b => ({
        id: `build-${b.type}`, icon: b.icon, label: b.label, cost: costIcons(b.cost),
        available: s => s.workers.some(w => matchesSource(w, source)),
        enabled: s => canAfford(s, b.cost) && s.workers.some(w => matchesSource(w, source)),
        reason: s => !s.workers.some(w => matchesSource(w, source)) ? 'No worker available' : '',
        run: s => startConstruction(s, source, b)
      })),
      { id: 'build-menu-stop', icon: 'stop', label: 'stop', cost: '',
        enabled: () => true,
        run: s => { s.buildMenu = false; } }
    ];
  }
  if (state.selected.kind === 'structure') return COMMANDS.structure[state.selected.type] || [];
  if (state.selected.kind === 'workerGroup') return COMMANDS.workerGroup;
  if (state.selected.kind === 'node') {
    const node = nodeById(state, state.selected.id);
    if (!node) return [];
    const type = node.type;
    return [
      { id: 'node-assign', icon: 'harvest', overlay: type, label: `harvest ${type}`, cost: '',
        enabled: s => node.remaining > 0 && spareWorker(s, node) != null,
        reason: s => node.remaining <= 0 ? `${node.label} depleted` : 'No spare workers',
        run: s => sendWorkerToNode(s, node) },
      { id: 'node-build', icon: 'build', label: 'build', cost: '',
        enabled: s => workersAtNode(s, node).length > 0,
        reason: () => 'No workers here to build',
        run: s => { s.buildMenu = true; s.buildSource = node.id; } }
    ];
  }
  if (state.selected.kind === 'army') return COMMANDS.army[state.selected.type] || [];
  return [];
}

function runCommand(id) {
  const command = selectedCommands(game).find(item => item.id === id);
  if (!command) return;
  if (!command.enabled(game)) {
    flashError(commandError(game, command));
    return;
  }
  command.run(game);
  clampGame(game);
  render();
}

const RESOURCE_KEYS = ['gold', 'lumber', 'oil'];

// Why a tapped command couldn't run: resource shortfalls come straight from its
// cost, everything else from an optional per-command reason().
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

// Fade a command only when it's unavailable for a NON-resource reason. A command
// with an available() reports its non-resource prerequisites; commands without
// one (no resource cost) fade whenever they're disabled.
function commandFaded(state, command) {
  return command.available ? !command.available(state) : !command.enabled(state);
}

let errorTimer = null;
function flashError(message) {
  if (!message) return;
  dom.error.textContent = message;
  dom.error.classList.add('show');
  if (errorTimer) clearTimeout(errorTimer);
  errorTimer = setTimeout(() => dom.error.classList.remove('show'), 2200);
}

function selectEntity(kind, type, id) {
  game.selected = { kind, type, id };
  game.buildMenu = false;
  game.buildSource = null;
  render();
}

// ── Stats ──────────────────────────────────────────────────────────────────

function supplyUsed(state) {
  return state.workers.length + state.units.soldiers.count + state.units.archers.count;
}

function supplyCap(state) {
  return 4 + state.structures.hall * 4 + state.structures.farms * 4;
}

function clampGame(state) {
  for (const key of Object.keys(state.resources)) {
    state.resources[key] = Math.max(0, Math.floor(state.resources[key]));
  }
  state.enemy.strength = Math.max(0, state.enemy.strength);
}

function writeLog(state, line) {
  state.log.unshift(line);
  state.log = state.log.slice(0, MAX_LOG_LINES);
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

function entityButton({ kind, type, id, icon, label, count, meta, danger, compact, jobIcon, progress, progressBars, progressKey, countLabel, countIcon, dimmed }) {
  const button = document.createElement('button');
  const classes = ['entity'];
  if (danger)  classes.push('danger');
  if (compact) classes.push('compact');
  if (dimmed)  classes.push('dimmed');
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

  const hasProgress = (progressBars && progressBars.length > 0) || (typeof progress === 'number' && progress > 0);
  if (jobIcon || hasProgress) {
    const badge = document.createElement('span');
    badge.className = 'job-badge';
    if (progressKey) badge.dataset.progressKey = progressKey;
    if (jobIcon) badge.appendChild(makeIcon(ICONS[jobIcon], meta || jobIcon));
    if (progressBars && progressBars.length > 0) {
      progressBars.forEach(p => badge.appendChild(radialProgressCanvas(p, progressBars.length)));
    } else if (typeof progress === 'number' && progress > 0) {
      badge.appendChild(radialProgressCanvas(progress));
    }
    button.appendChild(badge);
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
  // A selected node that's been depleted is hidden; fall back to the town hall.
  if (game.selected.kind === 'node') {
    const n = nodeById(game, game.selected.id);
    if (!n || n.remaining <= 0) game.selected = { kind: 'structure', type: 'hall', id: 1 };
  }
  const day = currentDay(game);
  dom.day.textContent = `DAY ${day + 1}`;
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

function renderConstructionQueue() {
  if (!game.constructions.length) return null;

  const step = game.cheats.fastTrain ? CHEAT_SPEED : 1;
  const list = document.createElement('div');
  list.className = 'construction-queue';
  game.constructions.forEach(c => {
    const chip = document.createElement('button');
    chip.className = 'construction-chip';
    chip.dataset.constructionId = c.id;
    chip.title = `${c.label} — tap to cancel, refund resources`;
    chip.setAttribute('aria-label', `cancel ${c.label}`);
    chip.appendChild(makeIcon(ICONS[c.icon], c.label));
    chip.appendChild(radialProgressCanvas(Math.min(1, ((c.duration - c.remaining) + tickFraction(step)) / c.duration)));
    chip.addEventListener('click', () => {
      cancelConstruction(game, c.id);
      render();
    });
    list.appendChild(chip);
  });
  return list;
}

function renderUpgradeQueue() {
  if (!game.upgrades.length) return null;
  const step = game.cheats.fastTrain ? CHEAT_SPEED : 1;
  const list = document.createElement('div');
  list.className = 'construction-queue';
  game.upgrades.forEach(u => {
    const chip = document.createElement('button');
    chip.className = 'construction-chip';
    chip.dataset.upgradeId = u.id;
    chip.title = `${u.label} — tap to cancel, refund resources`;
    chip.setAttribute('aria-label', `cancel ${u.label}`);
    chip.appendChild(makeIcon(ICONS[u.icon], u.label));
    chip.appendChild(radialProgressCanvas(Math.min(1, ((u.duration - u.remaining) + tickFraction(step)) / u.duration)));
    chip.addEventListener('click', () => {
      cancelUpgrade(game, u.id);
      render();
    });
    list.appendChild(chip);
  });
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

  // One tile per built structure type (with a count badge).
  const STRUCTURE_TILES = [
    { type: 'farm',       key: 'farms',       icon: 'farm',       label: 'farms' },
    { type: 'barracks',   key: 'barracks',    icon: 'barracks',   label: 'barracks' },
    { type: 'lumbermill', key: 'lumbermill',  icon: 'lumbermill', label: 'lumber mill' },
    { type: 'blacksmith', key: 'blacksmith',  icon: 'blacksmith', label: 'blacksmith' },
    { type: 'tower',      key: 'towers',      icon: 'tower',      label: 'tower' },
    { type: 'guardtower', key: 'guardtowers', icon: 'guardtower', label: 'guard tower' }
  ];
  STRUCTURE_TILES.forEach(({ type, key, icon, label }) => {
    if (game.structures[key] > 0) {
      structures.appendChild(entityButton({
        kind: 'structure', type, id: 1, compact: true,
        icon, label, countLabel: game.structures[key]
      }));
    }
  });

  const constructionQueue = renderConstructionQueue();
  if (constructionQueue) structures.appendChild(constructionQueue);

  const trainingQueue = renderTrainingQueue();
  if (trainingQueue) structures.appendChild(trainingQueue);

  const upgradeQueue = renderUpgradeQueue();
  if (upgradeQueue) structures.appendChild(upgradeQueue);

  // A horizontally scrollable row (see .world-group.workers) of the live
  // resource nodes — each shows its worker count and a harvest ring per worker;
  // the amount remaining is in the command card. Depleted nodes are hidden. The
  // idle-workers tile only appears when there's nothing left to harvest.
  const workers = document.createElement('section');
  workers.className = 'world-group workers';

  const liveNodes = game.nodes.filter(n => n.remaining > 0);

  if (liveNodes.length === 0) {
    const idleCount = jobCount(game, 'idle');
    workers.appendChild(entityButton({
      kind: 'workerGroup', type: 'idle', id: 1,
      icon: 'worker', label: 'idle workers', compact: true,
      countLabel: idleCount, dimmed: idleCount === 0
    }));
  }

  const harvestStep = game.cheats.fastHarvest ? CHEAT_SPEED : 1;
  liveNodes.forEach(node => {
    const nodeWorkers = workersAtNode(game, node);
    const cd = nodeCooldown(node);
    const progressBars = nodeWorkers.map(w =>
      Math.min(1, ((cd - w.cooldown) + tickFraction(harvestStep)) / cd));
    workers.appendChild(entityButton({
      kind: 'node', type: node.type, id: node.id,
      icon: node.icon, label: `${node.label} (dist ${node.distance})`, compact: true,
      progressBars, progressKey: `node:${node.id}`,
      countLabel: nodeWorkers.length, countIcon: 'worker'
    }));
  });

  const army = document.createElement('section');
  army.className = 'world-group army';

  if (game.units.soldiers.count > 0) {
    army.appendChild(entityButton({
      kind: 'army', type: 'soldiers', id: 1,
      icon: 'soldier', label: 'footmen',
      count: game.units.soldiers.count,
      meta: game.units.soldiers.order,
      jobIcon: orderIcon(game.units.soldiers.order)
    }));
  }

  if (game.units.archers.count > 0) {
    army.appendChild(entityButton({
      kind: 'army', type: 'archers', id: 1,
      icon: 'archer', label: 'archers',
      count: game.units.archers.count,
      meta: game.units.archers.order,
      jobIcon: orderIcon(game.units.archers.order)
    }));
  }

  const enemyCount = game.enemy.known ? Math.ceil(game.enemy.strength) : '??';
  const enemyMeta  = game.enemy.known ? 'enemy base' : 'uncharted';
  army.appendChild(entityButton({
    kind: 'enemy', type: 'enemy', id: 1,
    icon: 'enemy', label: 'enemy', count: enemyCount, meta: enemyMeta, danger: true
  }));

  dom.world.append(structures, workers, army);
}


function productionMeta(state, producer) {
  const jobs = state.production.filter(j => j.producer === producer);
  if (!jobs.length) return '';
  const queued = jobs.length - 1;
  return queued > 0 ? `${jobs[0].label} ${jobs[0].remaining}s +${queued}` : `${jobs[0].label} ${jobs[0].remaining}s`;
}

function entityInfo(state) {
  const { kind, type } = state.selected;
  if (state.buildMenu) return 'Choose a building';
  if (kind === 'structure') {
    if (type === 'hall')       return `Town Hall · ${productionMeta(state, 'hall') || 'ready'}`;
    if (type === 'barracks')   return `Barracks · ${productionMeta(state, 'barracks') || 'ready'}`;
    if (type === 'farm')       return `Farm · +4 supply`;
    if (type === 'lumbermill') return `Lumber Mill · unlocks archers`;
    if (type === 'blacksmith') return `Blacksmith`;
    if (type === 'tower')      return `Tower · upgradable to guard tower`;
    if (type === 'guardtower') return `Guard Tower · base defense`;
  }
  if (kind === 'workerGroup') {
    return `idle workers ×${jobCount(state, 'idle')}`;
  }
  if (kind === 'node') {
    const node = nodeById(state, state.selected.id);
    if (!node) return type;
    const n = workersAtNode(state, node).length;
    const status = node.remaining <= 0 ? 'depleted' : `${fmtQty(node.remaining)} left`;
    return `${node.label} · ${status} · dist ${node.distance} · ${n} working`;
  }
  if (kind === 'army') {
    const u = state.units[type];
    const name = type === 'soldiers' ? 'footmen' : type;
    return u ? `${name} ×${u.count} · ${u.order}` : name;
  }
  return '';
}

function renderTrainingQueue() {
  if (!game.production.length) return null;

  // One chip per unit in training/queue — each carries the unit icon, its own
  // progress ring, and cancels just that unit when tapped.
  const list = document.createElement('div');
  list.className = 'construction-queue';
  game.production.forEach(job => {
    const chip = document.createElement('button');
    chip.className = 'construction-chip';
    chip.dataset.uid = job.uid;
    chip.title = `${job.label} — tap to cancel, refund resources`;
    chip.setAttribute('aria-label', `cancel ${job.label}`);
    chip.appendChild(makeIcon(ICONS[job.icon], job.label));
    chip.appendChild(radialProgressCanvas(jobProgress(game, job)));
    chip.addEventListener('click', () => {
      cancelJobByUid(game, job.uid);
      render();
    });
    list.appendChild(chip);
  });
  return list;
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
    button.title = command.label;
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

dom.orders.addEventListener('click', event => {
  const button = event.target.closest('button[data-command]');
  if (!button) return;
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

function spawnStartingWorkers(remaining) {
  if (remaining <= 0) return;
  game.workers.push(createWorker('idle'));
  autoAssignWorkers(game);   // heads to gold immediately
  render();
  if (remaining > 1) setTimeout(() => spawnStartingWorkers(remaining - 1), 1000);
}

render();
spawnStartingWorkers(4);
function updateProgressRings() {
  document.querySelectorAll('.job-badge[data-progress-key]').forEach(badge => {
    const key = badge.dataset.progressKey;
    let values = [];
    if (key.startsWith('node:')) {
      const node = nodeById(game, key.slice('node:'.length));
      if (node) {
        const cd = nodeCooldown(node);
        const step = game.cheats.fastHarvest ? CHEAT_SPEED : 1;
        values = workersAtNode(game, node)
          .map(w => Math.min(1, ((cd - w.cooldown) + tickFraction(step)) / cd));
      }
    }
    badge.querySelectorAll('.radial-progress').forEach(el => el.remove());
    values.forEach(p => badge.appendChild(radialProgressCanvas(p, values.length)));
  });

  document.querySelectorAll('.construction-chip[data-uid]').forEach(chip => {
    const job = game.production.find(j => j.uid === Number(chip.dataset.uid));
    if (!job) return;
    chip.querySelectorAll('.radial-progress').forEach(el => el.remove());
    chip.appendChild(radialProgressCanvas(jobProgress(game, job)));
  });

  document.querySelectorAll('.construction-chip[data-construction-id]').forEach(chip => {
    const c = game.constructions.find(x => x.id === Number(chip.dataset.constructionId));
    if (!c) return;
    const step = game.cheats.fastTrain ? CHEAT_SPEED : 1;
    const p = Math.min(1, ((c.duration - c.remaining) + tickFraction(step)) / c.duration);
    chip.querySelectorAll('.radial-progress').forEach(el => el.remove());
    chip.appendChild(radialProgressCanvas(p));
  });

  document.querySelectorAll('.construction-chip[data-upgrade-id]').forEach(chip => {
    const u = game.upgrades.find(x => x.id === Number(chip.dataset.upgradeId));
    if (!u) return;
    const step = game.cheats.fastTrain ? CHEAT_SPEED : 1;
    const p = Math.min(1, ((u.duration - u.remaining) + tickFraction(step)) / u.duration);
    chip.querySelectorAll('.radial-progress').forEach(el => el.remove());
    chip.appendChild(radialProgressCanvas(p));
  });
}

setInterval(gameTick, TICK_MS);
setInterval(updateProgressRings, 100);
