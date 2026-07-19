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
  day: document.querySelector('#day')
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
  enemy: 'assets/icons/o_unit_grunt.png',
  attack: 'assets/icons/c_sword1.png',
  stop: 'assets/icons/c_stop.png',
  defend: 'assets/icons/c_hshield1.png',
  patrol: 'assets/icons/c_hpatrol.png',
  explore: 'assets/icons/c_hmove.png',
  build: 'assets/icons/c_build.png',
  harvest: 'assets/icons/c_harvest.png',
  return: 'assets/icons/c_hreturn.png'
};

let idCounter = 0;
const game = createGame();

function createGame() {
  return {
    tick: 0,
    selected: { kind: 'structure', type: 'hall', id: 1 },
    resources: { gold: 1200, lumber: 800, oil: 0 },
    production: [],
    constructions: [],
    buildMenu: false,
    workers: [],
    nodes: NODE_DEFS.map(d => ({ ...d, remaining: d.capacity })),
    units: {
      soldiers: { count: 0, order: 'defend' },
      archers:  { count: 0, order: 'defend' }
    },
    structures: {
      hall: 1,
      farms: 0,
      barracks: 0
    },
    enemy: { strength: 20, known: false },
    exploreProgress: 0,
    raid: { nextIn: RAID_INTERVAL_BASE },
    log: ['Town hall ready.', 'Workers await orders.'],
    cheats: { fastTrain: false, fastHarvest: false }
  };
}

function createWorker(job = 'idle', cooldown = 0) {
  return { id: nextId(), job, cooldown };
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
      isActive: s => s.units[unitType].order === 'attack',
      run: s => setOrder(s, unitType, 'attack')
    }
  ];
}

function setOrder(state, unitType, order) {
  state.units[unitType].order = order;
  writeLog(state, `${unitType === 'soldiers' ? 'Soldiers' : 'Archers'}: ${order}.`);
}

const BUILDABLE_STRUCTURES = [
  {
    type: 'farm', icon: 'farm', label: 'build farm', duration: 10,
    cost: { gold: 500, lumber: 250 },
    complete: state => { state.structures.farms += 1; writeLog(state, 'Farm complete.'); }
  },
  {
    type: 'barracks', icon: 'barracks', label: 'build barracks', duration: 20,
    cost: { gold: 700, lumber: 450 },
    complete: state => { state.structures.barracks += 1; selectEntity('structure', 'barracks', 1); writeLog(state, 'Barracks complete.'); }
  }
];

function costIcons(cost) {
  return Object.entries(cost).map(([icon, n]) => ({ icon, n }));
}

const COMMANDS = {
  structure: {
    hall: [
      {
        id: 'train-worker',
        icon: 'worker', label: 'train worker', cost: [{ icon: 'gold', n: 400 }, { icon: 'supply', n: 1 }], duration: 5, producer: 'hall',
        enabled: s => s.resources.gold >= 400 && supplyUsed(s) + supplyReserved(s) < supplyCap(s) && queueLength(s, 'hall') < queueMax(s, 'hall'),
        run: s => startProduction(s, {
          id: 'train-worker', producer: 'hall', icon: 'worker', label: 'worker', duration: 5,
          cost: { gold: 400 },
          complete: state => { state.workers.push(createWorker('idle')); writeLog(state, 'Worker ready.'); }
        })
      }
    ],
    barracks: [
      {
        id: 'train-soldier',
        icon: 'soldier', label: 'train soldier', cost: [{ icon: 'gold', n: 600 }, { icon: 'supply', n: 1 }], duration: 6, producer: 'barracks',
        enabled: s => s.structures.barracks > 0 && s.resources.gold >= 600 && supplyUsed(s) + supplyReserved(s) < supplyCap(s) && queueLength(s, 'barracks') < queueMax(s, 'barracks'),
        run: s => startProduction(s, {
          id: 'train-soldier', producer: 'barracks', icon: 'soldier', label: 'soldier', duration: 6,
          cost: { gold: 600 },
          complete: state => { state.units.soldiers.count += 1; writeLog(state, 'Soldier ready.'); }
        })
      },
      {
        id: 'train-archer',
        icon: 'archer', label: 'train archer', cost: [{ icon: 'gold', n: 500 }, { icon: 'lumber', n: 50 }, { icon: 'supply', n: 1 }], duration: 7, producer: 'barracks',
        enabled: s => s.structures.barracks > 0 && s.resources.gold >= 500 && s.resources.lumber >= 50 && supplyUsed(s) + supplyReserved(s) < supplyCap(s) && queueLength(s, 'barracks') < queueMax(s, 'barracks'),
        run: s => startProduction(s, {
          id: 'train-archer', producer: 'barracks', icon: 'archer', label: 'archer', duration: 7,
          cost: { gold: 500, lumber: 50 },
          complete: state => { state.units.archers.count += 1; writeLog(state, 'Archer ready.'); }
        })
      },
    ]
  },
  workerGroup: [
    { id: 'wg-construct', icon: 'build', label: 'construct', cost: 'idle worker',
      enabled: s => jobCount(s, 'idle') > 0,
      run: s => { s.buildMenu = true; } }
  ],
  node: [
    { id: 'node-assign', icon: 'harvest', label: 'send worker', cost: 'from idle',
      enabled: (s, type) => jobCount(s, 'idle') > 0 && activeNode(s, type) != null,
      run: (s, type) => sendWorkerToType(s, type) },
    { id: 'node-recall', icon: 'return', label: 'recall worker', cost: 'to idle',
      enabled: (s, type) => jobCount(s, type) > 0,
      run: (s, type) => recallWorkerFromType(s, type) }
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

// The node a given resource type is currently worked at: nearest (lowest
// distance) node of that type that still has resources. Workers are assigned to
// a resource type, not a specific node, and always target this one.
function activeNode(state, type) {
  return state.nodes
    .filter(n => n.type === type && n.remaining > 0)
    .sort((a, b) => a.distance - b.distance)[0] || null;
}

// Workers shown as "at" a node: those harvesting its resource type, but only on
// the node that's currently active for that type (nearest with resources).
function workersAtNode(state, node) {
  return activeNode(state, node.type) === node
    ? state.workers.filter(w => w.job === node.type)
    : [];
}

function sendWorkerToType(state, type) {
  const node = activeNode(state, type);
  if (!node) return;
  const worker = state.workers.find(w => w.job === 'idle');
  if (!worker) return;
  worker.job = type;
  worker.cooldown = nodeCooldown(node);
  writeLog(state, `Worker → ${type}.`);
}

function recallWorkerFromType(state, type) {
  const worker = state.workers.find(w => w.job === type);
  if (!worker) return;
  worker.job = 'idle';
  worker.cooldown = 0;
  writeLog(state, `Worker recalled to idle.`);
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

function startConstruction(state, workerType, building) {
  if (!canAfford(state, building.cost)) return;
  const worker = state.workers.find(w => w.job === workerType);
  if (!worker) return;
  spend(state, building.cost);
  worker.job = 'building';
  worker.cooldown = 0;
  state.constructions.push({
    id: nextId(), workerId: worker.id, type: building.type,
    icon: building.icon, label: building.label,
    duration: building.duration, remaining: building.duration,
    cost: building.cost, complete: building.complete
  });
  state.buildMenu = false;
  writeLog(state, `${building.label}: worker dispatched.`);
}

function releaseBuilder(state, workerId) {
  const worker = state.workers.find(w => w.id === workerId);
  if (!worker) return;
  worker.job = 'idle';
  worker.cooldown = 0;
}

function cancelConstruction(state, id) {
  const c = state.constructions.find(x => x.id === id);
  if (!c) return;
  state.constructions = state.constructions.filter(x => x.id !== id);
  Object.keys(c.cost).forEach(k => { state.resources[k] += c.cost[k]; });
  releaseBuilder(state, c.workerId);
  writeLog(state, `${c.label}: cancelled, refunded.`);
}

function advanceConstructions(state) {
  const step = state.cheats.fastTrain ? CHEAT_SPEED : 1;
  state.constructions.forEach(c => { c.remaining -= step; });
  const done = state.constructions.filter(c => c.remaining <= 0);
  state.constructions = state.constructions.filter(c => c.remaining > 0);
  done.forEach(c => {
    releaseBuilder(state, c.workerId);
    c.complete(state);
  });
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

  const defendPower = orderPower(state, 'defend');
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

  // Harvest — each worker draws from the specific node it's assigned to, which
  // depletes; when a node runs dry its workers fall back to idle.
  const harvestStep = game.cheats.fastHarvest ? CHEAT_SPEED : 1;
  game.workers.forEach(worker => {
    if (worker.job !== 'gold' && worker.job !== 'lumber') return;
    const node = activeNode(game, worker.job);
    if (!node) {
      worker.job = 'idle'; worker.cooldown = 0;   // every node of this type is dry
      return;
    }
    worker.cooldown -= harvestStep;
    if (worker.cooldown > 0) return;
    const gained = Math.min(HARVEST_YIELD, node.remaining);
    node.remaining -= gained;
    if (worker.job === 'gold')   game.resources.gold   += gained;
    if (worker.job === 'lumber') game.resources.lumber += gained;
    if (node.remaining <= 0) {
      node.remaining = 0;
      writeLog(game, `${node.label} depleted.`);
    }
    // Next cycle targets whatever node is nearest-available now (may have just
    // shifted to a farther one), so travel time updates accordingly.
    const next = activeNode(game, worker.job);
    worker.cooldown = nodeCooldown(next || node);
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
  clampGame(game);
  render();
}

// ── Selection ──────────────────────────────────────────────────────────────

function selectedCommands(state) {
  if (state.selected.kind === 'structure') return COMMANDS.structure[state.selected.type] || [];
  if (state.selected.kind === 'workerGroup') {
    if (state.buildMenu) {
      return [
        ...BUILDABLE_STRUCTURES.map(b => ({
          id: `build-${b.type}`, icon: b.icon, label: b.label, cost: costIcons(b.cost),
          enabled: s => canAfford(s, b.cost) && jobCount(s, 'idle') > 0,
          run: s => startConstruction(s, 'idle', b)
        })),
        { id: 'build-menu-stop', icon: 'stop', label: 'stop', cost: '',
          enabled: () => true,
          run: s => { s.buildMenu = false; } }
      ];
    }
    return COMMANDS.workerGroup;
  }
  if (state.selected.kind === 'node') {
    const node = nodeById(state, state.selected.id);
    const type = node ? node.type : state.selected.type;
    return COMMANDS.node.map(cmd => ({
      ...cmd,
      overlay: cmd.id === 'node-assign' ? type : cmd.overlay,
      enabled: s => cmd.enabled(s, type),
      run: s => cmd.run(s, type)
    }));
  }
  if (state.selected.kind === 'army') return COMMANDS.army[state.selected.type] || [];
  return [];
}

function runCommand(id) {
  const command = selectedCommands(game).find(item => item.id === id);
  if (!command || !command.enabled(game)) return;
  command.run(game);
  clampGame(game);
  render();
}

function selectEntity(kind, type, id) {
  game.selected = { kind, type, id };
  game.buildMenu = false;
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

function renderWorld() {
  dom.world.replaceChildren();

  const structures = document.createElement('section');
  structures.className = 'world-group structures';
  structures.appendChild(entityButton({
    kind: 'structure', type: 'hall', id: 1, compact: true,
    icon: 'hall', label: 'town hall'
  }));

  if (game.structures.farms > 0) {
    structures.appendChild(entityButton({
      kind: 'structure', type: 'farm', id: 1, compact: true,
      icon: 'farm', label: 'farms',
      countLabel: game.structures.farms
    }));
  }

  if (game.structures.barracks > 0) {
    structures.appendChild(entityButton({
      kind: 'structure', type: 'barracks', id: 1, compact: true,
      icon: 'barracks', label: 'barracks',
      countLabel: game.structures.barracks
    }));
  }

  const constructionQueue = renderConstructionQueue();
  if (constructionQueue) structures.appendChild(constructionQueue);

  const trainingQueue = renderTrainingQueue();
  if (trainingQueue) structures.appendChild(trainingQueue);

  // Idle workers, then one tile per resource node — a horizontally scrollable
  // row (see .world-group.workers). Node tiles show the number of workers on
  // them and a harvest ring per worker; the amount remaining is in the command
  // card. Workers assigned to a resource type appear on its nearest live node.
  const workers = document.createElement('section');
  workers.className = 'world-group workers';

  const idleCount = jobCount(game, 'idle');
  workers.appendChild(entityButton({
    kind: 'workerGroup', type: 'idle', id: 1,
    icon: 'worker', label: 'idle workers', compact: true,
    countLabel: idleCount, dimmed: idleCount === 0
  }));

  const harvestStep = game.cheats.fastHarvest ? CHEAT_SPEED : 1;
  game.nodes.forEach(node => {
    const nodeWorkers = workersAtNode(game, node);
    const cd = nodeCooldown(node);
    const progressBars = nodeWorkers.map(w =>
      Math.min(1, ((cd - w.cooldown) + tickFraction(harvestStep)) / cd));
    workers.appendChild(entityButton({
      kind: 'node', type: node.type, id: node.id,
      icon: node.icon, label: `${node.label} (dist ${node.distance})`, compact: true,
      progressBars, progressKey: `node:${node.id}`,
      countLabel: nodeWorkers.length, countIcon: 'worker',
      dimmed: node.remaining <= 0
    }));
  });

  const army = document.createElement('section');
  army.className = 'world-group army';

  if (game.units.soldiers.count > 0) {
    army.appendChild(entityButton({
      kind: 'army', type: 'soldiers', id: 1,
      icon: 'soldier', label: 'soldiers',
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
  if (kind === 'structure') {
    if (type === 'hall')     return `Town Hall · ${productionMeta(state, 'hall') || 'ready'}`;
    if (type === 'barracks') return `Barracks · ${productionMeta(state, 'barracks') || 'ready'}`;
    if (type === 'farm')     return `Farm · +4 supply`;
  }
  if (kind === 'workerGroup') {
    const base = `idle workers ×${jobCount(state, 'idle')}`;
    return state.buildMenu ? `${base} · choose building` : base;
  }
  if (kind === 'node') {
    const node = nodeById(state, state.selected.id);
    if (!node) return type;
    const n = jobCount(state, node.type);
    const status = node.remaining <= 0 ? 'depleted' : `${fmtQty(node.remaining)} left`;
    return `${node.label} · ${status} · dist ${node.distance} · ${n} on ${node.type}`;
  }
  if (kind === 'army') {
    const u = state.units[type];
    return u ? `${type} ×${u.count} · ${u.order}` : type;
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
    button.disabled = !command.enabled(game);
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

function spawnStartingWorkers(rounds) {
  if (rounds.length === 0) return;
  const [[goldCd, lumberCd], ...rest] = rounds;
  game.workers.push(createWorker('gold', goldCd));
  game.workers.push(createWorker('lumber', lumberCd));
  render();
  if (rest.length > 0) setTimeout(() => spawnStartingWorkers(rest), 300);
}

render();
spawnStartingWorkers([[6, 10], [2, 4]]);
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
}

setInterval(gameTick, TICK_MS);
setInterval(updateProgressRings, 100);
