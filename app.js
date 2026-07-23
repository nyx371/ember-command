// ── Tunables ───────────────────────────────────────────────────────────────

// Bump VERSION (+0.01) and rewrite VERSION_TAG with every pushed change —
// they render at the top of the menu so a stale cache is immediately visible.
const VERSION = '0.47';
const VERSION_TAG = 'move icon transfers one worker/unit at a time; tap a resource node to retask (gold→wood across zones)';

const MAX_LOG_LINES = 9;
const ICON_VERSION = '20260719-design1';
const TICK_MS = 1000;
const DAY_TICKS = 60;
const CHEAT_SPEED = 5;          // multiplier applied by fast-train / fast-harvest toggles
const TIME_SCALE = 0.3;         // global multiplier on ALL build/train/upgrade durations
                                // (tables keep real WC2 seconds; this scales them at job start)

const HARVEST_YIELD = 100;
const HARVEST_GATHER = { gold: 6, lumber: 12 };   // ticks spent gathering at the node itself
const TRAVEL_PER_DISTANCE = 2;                     // extra ticks per distance unit (local, within the zone)
// Extra harvest ticks per zone of distance to the nearest resource depot — a
// hall (for gold or lumber) or a lumber mill (for lumber). Harvesting far from
// any depot is slow, so building a forward hall/mill in a remote zone pays off.
const HARVEST_DEPOT_TRAVEL = 3;

const QUEUE_MAX = 5;            // queued units allowed per producing structure
const SUPPLY_BASE = 4;

// ── World zones ──
// The world is a linear stack of zones, index 0 = home. Exploring charts the
// next zone outward; a charted zone is empty (claimed as `owned` the moment
// scouts arrive) or `occupied` by a garrison that must be cleared before it is
// yours. Garrisons toughen with depth. The scripted stronghold sits at a fixed
// depth and ends the game when razed.
const STRONGHOLD_DEPTH = 8;      // zone index of the final orc stronghold
const ZONE_MARCH_PER_STEP = 6;   // march ticks between adjacent zones
// Odds a freshly-charted zone (past home) holds a garrison rather than being
// empty. The stronghold zone is always occupied regardless.
const ZONE_OCCUPY_CHANCE = 0.6;
const SITE_TOWER = { hp: 100, dmg: 6 };   // watch-tower stats a garrison uses
const GARRISON_REINFORCE = { every: 7, cap: 10 };  // occupied zones muster while attacked
const RAID_OUTPOST_RELIEF = 25; // raid-interval bonus per razed occupied zone
const RAID_INTERVAL_BASE = 90;  // ticks between raids on day 0
const RAID_FIRST_DELAY = 150;   // the very first wave holds off a while longer
const RAID_INTERVAL_SCALE = 5;  // reduce interval by this per day
const RAID_INTERVAL_MIN = 25;
const RAID_ARRIVE_TICKS = 10;   // approach window — patrol strikes and scouts it
const DEFENSE_VOLLEY_EVERY = 2; // my side strikes every 2 ticks...
const RAID_VOLLEY_EVERY = 3;    // ...raiders every 3 — offset cadences, not lockstep
// Enemy roster: each wave spawns one party per type whose fromWave has
// arrived. Stats and headcount scale per WAVE (not per day) so the ramp is
// deterministic — wave 1 is always a lone grunt — while the shrinking raid
// interval still accelerates pressure in real time.
// Wave scaling ramps gently: +1 raider and a little hp/dmg per wave.
// Axethrowers join from wave 6, ogres (heavies) from wave 9, and catapults
// from wave 12 — `siege: true` parties ignore units entirely and shell
// buildings from beyond tower range (towers can't shoot back; only warriors
// can stop them).
const RAIDER_TYPES = {
  grunt:      { icon: 'enemy',      label: 'grunts',      hp: 60,  dmg: 7,  hpPerWave: 4, dmgPerWave: 0.5, baseSize: 1, sizePerWave: 1,   fromWave: 0,  bounty: 30 },
  axethrower: { icon: 'axethrower', label: 'axethrowers', hp: 40,  dmg: 9,  hpPerWave: 3, dmgPerWave: 0.5, baseSize: 1, sizePerWave: 1,   fromWave: 5,  bounty: 40 },
  ogre:       { icon: 'ogre',       label: 'ogres',       hp: 110, dmg: 12, hpPerWave: 4, dmgPerWave: 0.5, baseSize: 1, sizePerWave: 0.5, fromWave: 9,  bounty: 60 },
  catapult:   { icon: 'catapult',   label: 'catapults',   hp: 110, dmg: 25, hpPerWave: 3, dmgPerWave: 1,   baseSize: 1, sizePerWave: 0.5, fromWave: 12, bounty: 80, siege: true }
};
const WORKER_HP = 30;
const REPAIR_HP_PER_TICK = 20;  // how fast one worker patches a building up
// Regen per tick — only defenders resting between fights heal (never while a
// raid is at the base, never on patrol or in the field), so pulling wounded
// units back to defend has a real benefit.
const HEAL_DEFEND_PER_TICK = 1;
const WORKER_HEAL_PER_TICK = 1;   // very slow, and only while not under attack
// Moving units between zones is a timed march: TRANSFER_BASE_TICKS plus one
// ZONE_MARCH_PER_STEP per zone of separation (see transferTicks).
const TRANSFER_BASE_TICKS = 2;
const HP_BAR_LINGER_MS = 3000;  // keep a combat hp bar visible across volleys
// Raider targeting: warriors first, then the towers shooting at them, then
// workers, then the remaining buildings — the town hall falls last.
const RAID_TOWER_TARGETS = ['cannontower', 'guardtower', 'tower'];
const RAID_TARGET_ORDER = ['farm', 'barracks', 'lumbermill', 'blacksmith', 'hall'];

// Home zone's fixed resource nodes. Nodes now belong to a zone (not a global
// list) and never move; `distance` is local travel within the zone (harvest
// travel also grows with the zone's index — see nodeCooldown).
const HOME_NODES = [
  { type: 'gold',   label: 'gold mine', icon: 'goldSite',   distance: 1, capacity: 48000 },
  { type: 'lumber', label: 'forest',    icon: 'lumberSite', distance: 1, capacity: 25000 },
  { type: 'lumber', label: 'far forest', icon: 'lumberSite', distance: 3, capacity: 25000 }
];

// Resource-node templates a charted (non-home) zone can roll. Each new zone
// gets one or two of these.
const ZONE_NODE_POOL = [
  { type: 'gold',   label: 'gold mine',   icon: 'goldSite',   distance: 2, capacity: 30000 },
  { type: 'gold',   label: 'hill mine',   icon: 'goldSite',   distance: 3, capacity: 26000 },
  { type: 'gold',   label: 'mountain mine', icon: 'goldSite', distance: 4, capacity: 40000 },
  { type: 'lumber', label: 'woods',       icon: 'lumberSite', distance: 2, capacity: 28000 },
  { type: 'lumber', label: 'deep woods',  icon: 'lumberSite', distance: 3, capacity: 30000 }
];

// Occupied-zone garrisons: the pool a charted zone draws from when it rolls
// occupied. `reward` pays out on clearing — { cache } gold/lumber instantly,
// { units } join the conquering force as the zone's new defenders, { workers }
// spawn into the zone's workforce. Base garrisons scale up with depth (see
// makeZone). `siteTerrain` art; `rewardIcon` badges what clearing pays.
const GARRISON_POOL = [
  { key: 'camp',   rewardIcon: 'gold',   label: 'raider camp',
    guards: { count: 3, hp: 60, dmg: 7 }, towers: 1,
    reward: { cache: { gold: 2500, lumber: 1500 } }, rewardText: 'war chest 2500g 1500w' },
  { key: 'warband', rewardIcon: 'gold',  label: 'orc warband',
    guards: { count: 4, hp: 70, dmg: 8 }, towers: 0,
    reward: { cache: { gold: 1500, lumber: 800 } }, rewardText: 'plunder 1500g 800w' },
  { key: 'stockade', rewardIcon: 'footman', label: 'prison camp',
    guards: { count: 6, hp: 72, dmg: 9 }, towers: 2,
    reward: { units: { footmen: 3 } }, rewardText: '3 freed footmen join you' },
  { key: 'loggers', rewardIcon: 'worker', label: 'logging camp',
    guards: { count: 5, hp: 80, dmg: 9 }, towers: 1,
    reward: { workers: 3 }, rewardText: '3 freed peasants' },
  { key: 'shrine', rewardIcon: 'gold',    label: 'orc shrine',
    guards: { count: 6, hp: 75, dmg: 9 }, towers: 1,
    reward: { cache: { gold: 3000 } }, rewardText: 'looted idol 3000g' },
  { key: 'hoard',  rewardIcon: 'gold',    label: 'orc hoard',
    guards: { count: 8, hp: 80, dmg: 10 }, towers: 2,
    reward: { cache: { gold: 4000, lumber: 2500 } }, rewardText: 'war hoard 4000g 2500w' },
  { key: 'armory', rewardIcon: 'knight',  label: 'slave pens',
    guards: { count: 8, hp: 85, dmg: 10 }, towers: 2,
    reward: { units: { knights: 2, archers: 2 } }, rewardText: 'freed knights & archers join you' }
];
// The scripted final zone at STRONGHOLD_DEPTH — always occupied, always the
// same, and razing it wins the game.
const STRONGHOLD = {
  key: 'stronghold', rewardIcon: 'attack', label: 'orc stronghold', final: true,
  guards: { count: 12, hp: 90, dmg: 8 }, towers: 2,
  reward: {}, rewardText: 'victory'
};

// Tech upgrades bought at their source building; level effects are read by
// harvestYield / unitDmg / unitHp.
const TECH = {
  lumber:  { source: 'lumbermill', label: 'lumber harvesting', max: 2,
             icons: ['axe2', 'axe3'],
             costs: [{ gold: 300, lumber: 150 }, { gold: 600, lumber: 300 }], times: [60, 90] },
  weapons: { source: 'blacksmith', label: 'weapons', max: 2,
             icons: ['sword2', 'sword3'],
             costs: [{ gold: 800 }, { gold: 2400 }], times: [200, 220] },
  armor:   { source: 'blacksmith', label: 'armor', max: 2,
             icons: ['shield2', 'shield3'],
             costs: [{ gold: 300, lumber: 300 }, { gold: 900, lumber: 500 }], times: [200, 250] },
  ballista: { source: 'blacksmith', label: 'ballista engineering', max: 2,
             icons: ['ballistaUp1', 'ballistaUp2'],
             costs: [{ gold: 500, lumber: 250 }, { gold: 1500, lumber: 600 }], times: [250, 275] }
};
const LUMBER_YIELD_PER_LEVEL = 0.25;  // +25% lumber per cycle per tier
const WEAPON_DMG_PER_LEVEL = 2;       // per unit, footmen and archers alike
const ARMOR_HP_PER_LEVEL = 10;
const BALLISTA_DMG_PER_LEVEL = 10;    // ballista engineering, ballistas only

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
    // Buildable in any owned zone to plant a forward base (trains workers there,
    // adds supply). Only home's hall (zone 0) is the loss condition, and only it
    // upgrades to keep/castle.
    build: { cost: { gold: 1000, lumber: 600 }, time: 255 },
    blurb: (s, z) => `${cap(z && z.index === 0 ? hallTierName(s) : 'town hall')} · ${productionMeta(s, 'hall', z ? z.id : 0) || 'ready'} · +${Math.round(incomePerTick(s, 'gold'))}g +${Math.round(incomePerTick(s, 'lumber'))}w /s`
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
    blurb: (s, z) => `Barracks · ${productionMeta(s, 'barracks', z.id) || 'ready'}`
  },
  lumbermill: {
    icon: 'lumbermill', label: 'lumber mill', hp: 600,
    build: { cost: { gold: 600, lumber: 450 }, time: 150 },
    blurb: s => `Lumber Mill · unlocks archers · yield +${s.tech.lumber * 25}%`
  },
  blacksmith: {
    icon: 'blacksmith', label: 'blacksmith', hp: 775,
    build: { cost: { gold: 800, lumber: 450 }, time: 200 },
    blurb: s => `Blacksmith · weapons ${s.tech.weapons}/2 · armor ${s.tech.armor}/2`
  },
  tower: {
    icon: 'tower', label: 'tower', hp: 100, dmg: 3,
    build: { cost: { gold: 550, lumber: 200 }, time: 60, requires: ['lumbermill'] },
    blurb: 'Tower · upgradable to guard tower'
  },
  guardtower: {
    icon: 'guardtower', label: 'guard tower',   // via tower upgrade, not the build menu
    hp: 130, dmg: 8,
    blurb: 'Guard Tower · base defense'
  },
  cannontower: {
    icon: 'cannontower', label: 'cannon tower',   // via tower upgrade, needs blacksmith
    hp: 160, dmg: 14,
    blurb: 'Cannon Tower · heavy base defense'
  },
  stables: {
    icon: 'stables', label: 'stables', hp: 500,
    build: { cost: { gold: 1000, lumber: 300 }, time: 150, requiresTier: 1 },
    blurb: 'Stables · trains knights'
  }
};

// Trainable units. `producer` is the structure that trains them; `requires`
// are extra tech prerequisites; `done(state, zone)` runs on completion in the
// zone whose producer trained it. Army units join that zone's defenders;
// workers join that zone's workforce.
const UNITS = {
  worker: {
    icon: 'worker', label: 'worker', producer: 'hall', time: 45, cost: { gold: 400 },
    done: (s, zone) => {
      const w = createWorker('idle', null, 0, zone.id);
      s.workers.push(w);
      autoAssignWorkers(s);
      if (w.nodeId) flashTile(`node:${w.job}:${w.nodeId}`, 'spawn');
      writeLog(s, 'Worker ready.');
    }
  },
  footman: {
    icon: 'footman', label: 'footman', producer: 'barracks', time: 60, cost: { gold: 600 },
    done: (s, zone) => { zone.army.footmen += 1; flashTile(`army:defend:${zone.id}`, 'spawn'); writeLog(s, 'Footman ready.'); }
  },
  archer: {
    icon: 'archer', label: 'archer', producer: 'barracks', time: 70, cost: { gold: 500, lumber: 50 },
    requires: ['lumbermill'],
    done: (s, zone) => { zone.army.archers += 1; flashTile(`army:defend:${zone.id}`, 'spawn'); writeLog(s, 'Archer ready.'); }
  },
  ballista: {
    icon: 'ballista', label: 'ballista', producer: 'barracks', time: 250, cost: { gold: 900, lumber: 300 },
    requires: ['blacksmith'],
    done: (s, zone) => { zone.army.ballistas += 1; flashTile(`army:defend:${zone.id}`, 'spawn'); writeLog(s, 'Ballista ready.'); }
  },
  knight: {
    icon: 'knight', label: 'knight', producer: 'stables', time: 90, cost: { gold: 800, lumber: 100 },
    done: (s, zone) => { zone.army.knights += 1; flashTile(`army:defend:${zone.id}`, 'spawn'); writeLog(s, 'Knight ready.'); }
  }
};

// Army unit types. `hp`/`dmg` drive combat (listed first = soaks damage first
// within a pool); `attack` is siege dps. Units live in a per-zone defend pool
// (zone.army) plus transient marching columns (see transfers/assaults).
const ARMY = {
  footmen:   { icon: 'footman',  label: 'footmen',   singular: 'footman',  hp: 60,  dmg: 7,  attack: 0.10 },
  knights:   { icon: 'knight',   label: 'knights',   singular: 'knight',   hp: 90,  dmg: 10, attack: 0.15 },
  archers:   { icon: 'archer',   label: 'archers',   singular: 'archer',   hp: 40,  dmg: 5,  attack: 0.06 },
  ballistas: { icon: 'ballista', label: 'ballistas', singular: 'ballista', hp: 110, dmg: 25, attack: 0.50 }
};

// Standing "orders" left in the model: a unit either holds a zone (defend) or
// is out charting the frontier (explore). Patrol is gone — in the world-zone
// model a stationed unit simply defends wherever it stands, and raids are
// intercepted by whichever zone they march through. Attacking a garrison is a
// site/zone assault, not an order.
const ORDERS = ['defend', 'explore'];

const GUARD_TOWER = { cost: { gold: 500, lumber: 150 }, time: 140 };
const CANNON_TOWER = { cost: { gold: 1000, lumber: 300 }, time: 190 };
// Hall tiers: Town Hall → Keep → Castle. The hall keeps its structure key —
// only game.hallTier changes — so the loss condition, targeting, and worker
// training are untouched. Each tier: tougher hall, a little more supply;
// the Keep gates the Stables, the Castle needs them (WC2 ladder).
const HALL_TIERS = [
  { key: 'keep',   label: 'keep',   icon: 'keep',
    cost: { gold: 2000, lumber: 1000 }, time: 200, hpBonus: 600, supply: 4,
    requires: s => totalStructures(s, 'barracks') > 0, reqLabel: 'Need a barracks' },
  { key: 'castle', label: 'castle', icon: 'castle',
    cost: { gold: 2500, lumber: 1200 }, time: 200, hpBonus: 600, supply: 4,
    requires: s => totalStructures(s, 'stables') > 0, reqLabel: 'Need stables' }
];

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
  attack: 'assets/icons/c_sword1.png',
  stop: 'assets/icons/c_stop.png',
  defend: 'assets/icons/c_hshield1.png',
  patrol: 'assets/icons/c_hpatrol.png',
  explore: 'assets/icons/c_cast_vision.png',
  move: 'assets/icons/c_hmove.png',
  build: 'assets/icons/c_build.png',
  harvest: 'assets/icons/c_harvest.png',
  axethrower: 'assets/icons/o_unit_axethrower.png',
  orctower: 'assets/icons/o_bld_watchtower.png',
  siteTerrain: 'assets/icons/n_site_terrain.png',
  vision: 'assets/icons/c_cast_vision.png',
  repair: 'assets/icons/c_repair.png',
  deathcoil: 'assets/icons/c_cast_deathcoil.png',
  ballista: 'assets/icons/h_unit_ballista.png',
  ballistaUp1: 'assets/icons/c_upgrade_ballista.png',
  ballistaUp2: 'assets/icons/c_upgrade_catapult2.png',
  cannontower: 'assets/icons/h_bld_cannontower.png',
  keep: 'assets/icons/h_bld_keep.png',
  castle: 'assets/icons/h_bld_castle2.png',
  stables: 'assets/icons/h_bld_stables.png',
  knight: 'assets/icons/h_unit_knight.png',
  ogre: 'assets/icons/o_unit_ogre.png',
  catapult: 'assets/icons/o_unit_catapult.png',
  outpost: 'assets/icons/o_bld_greathall.png',
  stronghold: 'assets/icons/o_bld_fortress.png',
  axe2: 'assets/icons/c_axe2.png',
  axe3: 'assets/icons/c_axe3.png',
  sword2: 'assets/icons/c_sword2.png',
  sword3: 'assets/icons/c_sword3.png',
  shield2: 'assets/icons/c_hshield2.png',
  shield3: 'assets/icons/c_hshield3.png'
};

// ── State ──────────────────────────────────────────────────────────────────

let idCounter = 0;

function nextId() {
  idCounter += 1;
  return idCounter;
}

function emptyStructures() {
  return Object.fromEntries(Object.keys(BUILDINGS).map(k => [k, 0]));
}

function emptyDamage() {
  return Object.fromEntries(Object.keys(BUILDINGS).map(k => [k, 0]));
}

// A per-zone defend pool: counts per ARMY type + a shared wounds pool.
function emptyArmy() {
  return { ...Object.fromEntries(Object.keys(ARMY).map(k => [k, 0])), wounds: 0, lastHitAt: 0 };
}

function makeNode(def, zoneId) {
  return { ...def, id: `n${nextId()}`, zoneId, remaining: def.capacity };
}

// Scale a garrison template up with the zone's depth — deeper zones are
// tougher, echoing how raid waves ramp.
// Garrisons toughen both with depth (index) and with how far into the game we
// are when they're generated (wave) — the deeper and later you push, the harder
// the ground you find.
function scaleGuards(def, index, wave) {
  return {
    count: def.guards.count + Math.floor(index * 0.6 + wave * 0.3),
    hp: def.guards.hp + index * 5 + wave * 3,
    dmg: def.guards.dmg + index * 0.4 + wave * 0.2
  };
}

function makeGarrison(def, index, wave) {
  const guards = scaleGuards(def, index, wave);
  return {
    key: def.key, label: def.label, rewardIcon: def.rewardIcon, rewardText: def.rewardText,
    reward: def.reward || {}, final: !!def.final,
    guards, guardsLeft: guards.count, guardPool: guards.count * guards.hp,
    towers: def.towers, towersLeft: def.towers, towerHp: SITE_TOWER.hp,
    veiled: true, reinforce: GARRISON_REINFORCE, reinforceIn: 0,
    myStrikeIn: DEFENSE_VOLLEY_EVERY, foeStrikeIn: RAID_VOLLEY_EVERY,
    lastHitAt: 0, strikeHitAt: 0
  };
}

// A gold and a lumber node, guaranteed — used for the first zone so the opening
// expansion always pays off in both resources.
function goldAndLumberNodes() {
  return [ZONE_NODE_POOL.find(n => n.type === 'gold'), ZONE_NODE_POOL.find(n => n.type === 'lumber')];
}

// Generate the zone at a given index: its resource nodes and (maybe) a garrison,
// scaled by depth and the current raid `wave`. The first zone (index 1) is
// always neutral with wood + gold; the stronghold is fixed at STRONGHOLD_DEPTH;
// other zones roll occupied at ZONE_OCCUPY_CHANCE. `discovered` stays false
// until scouts arrive (renderWorld reveals it then).
function makeZone(index, wave = 0) {
  const id = nextId();
  let nodeDefs;
  let garrison = null;
  if (index === 1) {
    nodeDefs = goldAndLumberNodes();   // first find: neutral, both resources
  } else {
    const pool = [...ZONE_NODE_POOL];
    const nodeCount = 1 + (Math.random() < 0.6 ? 1 : 0);
    nodeDefs = [];
    for (let i = 0; i < nodeCount && pool.length; i += 1) {
      nodeDefs.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    if (index === STRONGHOLD_DEPTH) garrison = makeGarrison(STRONGHOLD, index, wave);
    else if (Math.random() < ZONE_OCCUPY_CHANCE) {
      garrison = makeGarrison(GARRISON_POOL[Math.floor(Math.random() * GARRISON_POOL.length)], index, wave);
    }
  }
  return {
    id, index, discovered: false, status: garrison ? 'occupied' : 'owned',
    name: garrison ? garrison.label : `zone ${index}`,
    nodes: nodeDefs.map(d => makeNode(d, id)),
    structures: emptyStructures(), structureDamage: emptyDamage(),
    army: emptyArmy(),
    garrison, strike: null   // strike = our assault column fighting the garrison
  };
}

function createGame() {
  const home = {
    id: 0, index: 0, discovered: true, status: 'owned', name: 'home',
    nodes: [], structures: emptyStructures(), structureDamage: emptyDamage(),
    army: emptyArmy(), garrison: null, strike: null
  };
  home.nodes = HOME_NODES.map(d => makeNode(d, home.id));
  home.structures.hall = 1;
  home.structures.farm = 1;
  home.army.footmen = 1;   // one veteran footman guards home from the start
  return {
    tick: 0,
    selected: { kind: 'structure', type: 'hall', id: home.id, zoneId: home.id },
    resources: { gold: 400, lumber: 100, oil: 0 },
    // The world is a linear stack of zones, index 0 = home. Each zone owns its
    // nodes / structures / defenders; `frontierAt` is the deepest charted index.
    zones: [home],
    frontierAt: 0,
    jobs: [],
    buildMenu: false,
    // When set, the next zone tapped in the world is a move destination for the
    // armed group: { kind:'workers'|'army', fromZoneId, resource?, nodeId?, type? }.
    moveArm: null,
    workers: [],
    tech: Object.fromEntries(Object.keys(TECH).map(k => [k, 0])),
    over: null,   // { won, day } once the game ends
    hallTier: 0,   // 0 = town hall, 1 = keep (home's hall)
    raid: { nextIn: RAID_FIRST_DELAY, interval: RAID_INTERVAL_BASE, wave: 0 },
    raids: [],            // active raiding parties (see spawnRaid)
    workerWounds: 0,      // damage accumulated toward the next worker death
    log: ['Raiders are coming — one footman won\'t hold them forever.', 'Tap the town hall to build and train.', 'Welcome to Ember Command.'],
    cheats: { fastTrain: false, fastHarvest: false }
  };
}

function createWorker(job = 'idle', nodeId = null, cooldown = 0, zoneId = 0) {
  return { id: nextId(), job, nodeId, cooldown, zoneId };
}

installZoomGuards();

let lastTickAt = performance.now();

function tickFraction(step) {
  return step * Math.min(1, (performance.now() - lastTickAt) / TICK_MS);
}

const dom = {
  stores: document.querySelector('#stores'),
  queue: document.querySelector('#queue'),
  world: document.querySelector('#world'),
  orders: document.querySelector('#orders'),
  log: document.querySelector('#log'),
  day: document.querySelector('#day'),
  raidclock: document.querySelector('#raidclock'),
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

// ── Zones ──────────────────────────────────────────────────────────────────
// The world is a linear stack. Each zone owns its nodes, structures, and
// defenders. These accessors are the single way the rest of the code reaches
// zone contents; nothing else should walk `state.zones` directly.

function zoneById(state, id) {
  return state.zones.find(z => String(z.id) === String(id)) || null;
}

function zoneByIndex(state, index) {
  return state.zones.find(z => z.index === index) || null;
}

function homeZone(state) {
  return state.zones[0];
}

function ownedZones(state) {
  return state.zones.filter(z => z.discovered && z.status === 'owned');
}

// Deepest charted (discovered) zone.
function frontierZone(state) {
  return state.zones.filter(z => z.discovered).reduce((a, b) => (b.index > a.index ? b : a), state.zones[0]);
}

// Deepest zone we actually own — the springboard we explore and assault from.
function deepestOwned(state) {
  return ownedZones(state).reduce((a, b) => (b.index > a.index ? b : a), state.zones[0]);
}

// The next, still-uncharted zone (if any). Exploration always aims here.
function chartingZone(state) {
  return state.zones.find(z => !z.discovered) || null;
}

// Keep exactly one uncharted zone sitting just past the deepest owned zone,
// ready to be scouted — unless an occupied zone already blocks the way, or we
// have reached the stronghold. Its contents (empty vs garrison) are decided now
// but stay hidden until scouts arrive.
function ensureFrontier(state) {
  const m = deepestOwned(state).index;
  if (m >= STRONGHOLD_DEPTH) return;
  if (!zoneByIndex(state, m + 1)) state.zones.push(makeZone(m + 1, state.raid.wave));
}

// Every resource node across every zone, and the zone a node lives in.
function allNodes(state) {
  return state.zones.flatMap(z => z.nodes);
}

function nodeZone(state, nodeId) {
  return state.zones.find(z => z.nodes.some(n => String(n.id) === String(nodeId))) || null;
}

// Count of a building across all zones (supply, tech prerequisites, etc.).
function totalStructures(state, key) {
  return state.zones.reduce((n, z) => n + (z.structures[key] || 0), 0);
}

// ── Workers & resource nodes ───────────────────────────────────────────────
// A worker belongs to a zone (worker.zoneId) and is pinned to a node in that
// zone (worker.nodeId) until it depletes, then goes idle; autoAssignWorkers
// re-places idle workers onto a live node IN THEIR OWN ZONE (gold first).
// Builders travel to the zone they're constructing in and settle there.

function workerCount(state, job) {
  return state.workers.filter(w => w.job === job).length;
}

function nodeById(state, id) {
  return allNodes(state).find(n => String(n.id) === String(id));
}

// A zone is a depot for a resource if it can receive it: any hall takes gold or
// lumber; a lumber mill also takes lumber.
function isDepot(zone, type) {
  return zone.structures.hall > 0 || (type === 'lumber' && zone.structures.lumbermill > 0);
}

// Zones of distance from `zone` to the nearest owned depot for `type` (0 if the
// zone has its own). Home always has a hall, so a depot always exists.
function depotDistance(state, zone, type) {
  if (isDepot(zone, type)) return 0;
  const depots = state.zones.filter(z => z.discovered && z.status === 'owned' && isDepot(z, type));
  if (!depots.length) return zone.index;
  return Math.min(...depots.map(z => Math.abs(z.index - zone.index)));
}

// Harvest cycle length: gather time at the node, plus local travel within the
// zone, plus a haul to the nearest depot (a hall, or a lumber mill for lumber).
function nodeCooldown(state, node) {
  const zone = nodeZone(state, node.id);
  const haul = zone ? depotDistance(state, zone, node.type) * HARVEST_DEPOT_TRAVEL : 0;
  return HARVEST_GATHER[node.type] + node.distance * TRAVEL_PER_DISTANCE + haul;
}

function workersAtNode(state, node) {
  return state.workers.filter(w => String(w.nodeId) === String(node.id));
}

// Live nodes in a zone (discovered/owned zones only carry harvestable nodes).
function liveNodesInZone(zone) {
  return zone.status === 'owned' ? zone.nodes.filter(n => n.remaining > 0) : [];
}

// First live node of a resource type in a zone (array order).
function firstNodeOfType(zone, type) {
  return liveNodesInZone(zone).find(n => n.type === type) || null;
}

// A worker in `zone` to spare for `node`: idle first, then one from another
// node of the SAME resource, then one from a different resource — all within
// the same zone (workers don't teleport between zones to harvest).
function spareWorker(state, zone, node) {
  const here = state.workers.filter(w => String(w.zoneId) === String(zone.id));
  return here.find(w => w.job === 'idle')
      || here.find(w => w.job === node.type && String(w.nodeId) !== String(node.id))
      || here.find(w => (w.job === 'gold' || w.job === 'lumber') && w.job !== node.type);
}

function assignWorker(state, worker, node) {
  worker.job = node.type;
  worker.nodeId = node.id;
  worker.cooldown = nodeCooldown(state, node);
}

function idleWorker(worker) {
  worker.job = 'idle';
  worker.nodeId = null;
  worker.cooldown = 0;
}

function workersInZone(state, zone) {
  return state.workers.filter(w => String(w.zoneId) === String(zone.id));
}

function idleInZone(state, zone) {
  return workersInZone(state, zone).filter(w => w.job === 'idle').length;
}

function sendWorkerToNode(state, node) {
  if (node.remaining <= 0) return;
  const zone = nodeZone(state, node.id);
  const worker = zone && spareWorker(state, zone, node);
  if (!worker) return;
  assignWorker(state, worker, node);
  flashTile(`node:${node.type}:${node.id}`, 'spawn');
  writeLog(state, `Worker → ${node.label}.`);
}

// Long-press variant: pull every spare worker in the zone to this node.
function sendAllWorkersToNode(state, node) {
  if (node.remaining <= 0) return;
  const zone = nodeZone(state, node.id);
  if (!zone) return;
  let moved = 0;
  let worker;
  while (moved < 200 && (worker = spareWorker(state, zone, node))) {
    assignWorker(state, worker, node);
    moved += 1;
  }
  if (moved > 0) {
    flashTile(`node:${node.type}:${node.id}`, 'spawn');
    writeLog(state, `${moved} workers → ${node.label}.`);
  }
}

// Idle workers don't sit around: each harvests in its own zone — its preferred
// resource first (what it hauled before being moved), then gold, then wood.
// Keeps every zone's economy running hands-free.
function autoAssignWorkers(state) {
  state.workers.forEach(w => {
    if (w.job !== 'idle') return;
    const zone = zoneById(state, w.zoneId);
    if (!zone) return;
    const node = (w.pref && firstNodeOfType(zone, w.pref))
      || firstNodeOfType(zone, 'gold') || firstNodeOfType(zone, 'lumber');
    if (node) assignWorker(state, w, node);
  });
}

// Resolve an armed move against a tapped destination — ONE worker/unit per tap.
// `destNode` (optional) targets a specific resource: a worker sent onto a node
// harvests THAT resource; sent to a zone with no node it keeps its own resource.
// Returns true if something moved (the move stays armed for more one-at-a-time
// taps), false if the source is empty.
function executeMoveOne(state, arm, destZone, destNode) {
  if (arm.kind === 'army') {
    const from = zoneById(state, arm.fromZoneId);
    if (!from || String(from.id) === String(destZone.id) || from.army[arm.type] <= 0) return false;
    startTransfer(state, from.id, destZone.id, arm.type, 1, 'move');
    return true;
  }
  // Workers: pick one from the source node's crew, or one idle in the zone.
  const worker = arm.nodeId != null
    ? state.workers.find(w => String(w.nodeId) === String(arm.nodeId))
    : state.workers.find(w => String(w.zoneId) === String(arm.fromZoneId) && w.job === 'idle');
  if (!worker) return false;
  if (String(destZone.id) === String(arm.fromZoneId) && !destNode) return false;   // no-op
  worker.zoneId = destZone.id; worker.nodeId = null; worker.cooldown = 0; worker.job = 'idle';
  if (destNode) {
    worker.pref = destNode.type;
    if (destNode.remaining > 0) assignWorker(state, worker, destNode);
  } else if (arm.resource) {
    worker.pref = arm.resource;   // keep hauling the same kind
  }
  autoAssignWorkers(state);
  writeLog(state, `Worker → ${destZone.name}${destNode ? ` (${destNode.type})` : ''}.`);
  flashTile(`army:defend:${destZone.id}`, 'spawn');
  return true;
}

// Builder to dispatch for a construction in `zone`: an idle worker already in
// the zone first, then any idle worker (they travel over), then one pulled off
// the most plentiful live node anywhere. Null when nobody can be spared.
function builderWorker(state, zone) {
  const inZone = zone && workersInZone(state, zone).find(w => w.job === 'idle');
  if (inZone) return inZone;
  const idle = state.workers.find(w => w.job === 'idle');
  if (idle) return idle;
  const richest = allNodes(state)
    .filter(n => n.remaining > 0 && workersAtNode(state, n).length > 0)
    .sort((a, b) => b.remaining - a.remaining)[0];
  return richest ? workersAtNode(state, richest)[0] : null;
}

// Builder released from a finished/cancelled construction: it settles in the
// zone it worked in and goes idle (auto-assign routes it to a local node).
function releaseBuilder(state, workerId, zoneId) {
  const worker = state.workers.find(w => w.id === workerId);
  if (!worker) return;
  if (zoneId != null) worker.zoneId = zoneId;
  idleWorker(worker);
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
    const gained = Math.min(harvestYield(state, worker.job), node.remaining);
    node.remaining -= gained;
    state.resources[worker.job] += gained;
    worker.cooldown = nodeCooldown(state, node);
    if (node.remaining <= 0) writeLog(state, `${node.label} depleted.`);
  });
}

// ── Timed jobs (train / construct / upgrade) ───────────────────────────────
// One subsystem for everything with a duration, a cost, and a cancel+refund.

// Training happens at a producing building IN A ZONE, so train jobs are keyed
// by producer + zoneId: N barracks in a zone train N units at once and hold
// QUEUE_MAX × N in queue there.
function trainJobs(state, producer, zoneId) {
  return state.jobs.filter(j => j.kind === 'train' && j.producer === producer && String(j.zoneId) === String(zoneId));
}

function queueLength(state, producer, zoneId) {
  return trainJobs(state, producer, zoneId).length;
}

function producerCapacity(state, producer, zoneId) {
  const zone = zoneById(state, zoneId);
  return (zone && zone.structures[producer]) || 1;
}

function queueMax(state, producer, zoneId) {
  return QUEUE_MAX * producerCapacity(state, producer, zoneId);
}

function supplyReserved(state) {
  return state.jobs.filter(j => j.kind === 'train' && j.supply).length;
}

function pendingUpgrades(state, tag) {
  return state.jobs.filter(j => j.kind === 'upgrade' && j.tag === tag).length;
}

function trainUnit(state, key, zoneId) {
  const u = UNITS[key];
  const zone = zoneById(state, zoneId);
  if (!zone) return;
  if (queueLength(state, u.producer, zoneId) >= queueMax(state, u.producer, zoneId) || !canAfford(state, u.cost)) return;
  spend(state, u.cost);
  const time = scaledTime(u.time);
  state.jobs.push({
    uid: nextId(), kind: 'train', producer: u.producer, zoneId: zone.id, supply: 1,
    icon: u.icon, label: u.label, duration: time, remaining: time,
    cost: u.cost, complete: s => u.done(s, zoneById(s, zone.id) || homeZone(s))
  });
  const depth = queueLength(state, u.producer, zoneId);
  writeLog(state, depth > 1 ? `${u.label}: queued (${depth}).` : `${u.label}: started.`);
}

function startConstruction(state, key, zoneId) {
  const b = BUILDINGS[key];
  const zone = zoneById(state, zoneId);
  if (!zone || !canAfford(state, b.build.cost)) return;
  const worker = builderWorker(state, zone);
  if (!worker) return;
  spend(state, b.build.cost);
  worker.job = 'building';
  worker.nodeId = null;
  worker.cooldown = 0;
  const time = scaledTime(b.build.time);
  state.jobs.push({
    uid: nextId(), kind: 'construct', workerId: worker.id, zoneId: zone.id,
    icon: b.icon, label: b.label, duration: time, remaining: time,
    cost: b.build.cost,
    complete: s => {
      const z = zoneById(s, zone.id) || homeZone(s);
      z.structures[key] += 1;
      flashTile(`structure:${key}:${z.id}`, 'spawn');
      writeLog(s, `${cap(b.label)} complete.`);
      if (b.onBuilt) b.onBuilt(s, z);
    }
  });
  state.buildMenu = false;
  writeLog(state, `${b.label}: worker dispatched.`);
}

// Repair rides the construct-job machinery: a worker is pulled the same way,
// walks over, patches the accumulated damage off a zone's building, and
// settles there.
function pendingRepair(state, key, zoneId) {
  return state.jobs.some(j => j.kind === 'construct' && j.repairKey === key && String(j.zoneId) === String(zoneId));
}

function startRepair(state, key, zoneId) {
  const zone = zoneById(state, zoneId);
  if (!zone) return;
  const worker = builderWorker(state, zone);
  if (!worker) return;
  worker.job = 'building';
  worker.nodeId = null;
  worker.cooldown = 0;
  const time = Math.max(1, Math.ceil(zone.structureDamage[key] / REPAIR_HP_PER_TICK));
  state.jobs.push({
    uid: nextId(), kind: 'construct', workerId: worker.id, zoneId: zone.id, repairKey: key,
    icon: 'repair', label: `repair ${BUILDINGS[key].label}`, duration: time, remaining: time,
    cost: {},
    complete: s => {
      const z = zoneById(s, zone.id) || homeZone(s);
      z.structureDamage[key] = 0;
      flashTile(`structure:${key}:${z.id}`, 'spawn');
      writeLog(s, `${cap(BUILDINGS[key].label)} repaired.`);
    }
  });
  writeLog(state, `Repairing the ${BUILDINGS[key].label}.`);
}

function startUpgrade(state, spec) {
  if (!canAfford(state, spec.cost)) return;
  spend(state, spec.cost);
  const time = scaledTime(spec.time);
  state.jobs.push({
    uid: nextId(), kind: 'upgrade', tag: spec.tag, source: spec.source,
    icon: spec.icon, label: spec.label, duration: time, remaining: time,
    cost: spec.cost, complete: spec.complete
  });
  writeLog(state, `${spec.label}: upgrading.`);
}

// One research at a time per source building (counted across all zones) — a
// second blacksmith (etc.) unlocks a second parallel upgrade slot.
function upgradeSlotFree(state, source) {
  return state.jobs.filter(j => j.kind === 'upgrade' && j.source === source).length
       < totalStructures(state, source);
}

// Deliver a marching column into a zone: an owned zone takes them as defenders
// (claiming a freshly-charted empty zone); an occupied zone takes them as the
// assault strike force. Reveals the zone if scouts are only now arriving.
function arriveColumn(state, zone, type, count, wounds = 0) {
  if (!zone.discovered) {
    zone.discovered = true;
    state.frontierAt = Math.max(state.frontierAt, zone.index);
    flashTile(`zone:head:${zone.id}`, 'spawn');
    writeLog(state, zone.garrison
      ? `Scouts reach ${zone.name} — and it's held by a garrison!`
      : `Scouts chart ${zone.name} — the ground is ours.`);
    if (zone.garrison) flashError('Enemy garrison discovered!');
  }
  if (zone.garrison && zone.status === 'occupied') {
    const strike = zone.strike || emptyArmy();
    strike[type] = (strike[type] || 0) + count;
    strike.wounds = (strike.wounds || 0) + wounds;
    zone.strike = strike;
    flashTile(`zone:head:${zone.id}`, 'spawn');
    writeLog(state, `${count} ${count === 1 ? ARMY[type].singular : ARMY[type].label} storm ${zone.name}!`);
  } else {
    zone.army[type] += count;
    zone.army.wounds += wounds;
    zone.status = 'owned';
    flashTile(`army:defend:${zone.id}`, 'spawn');
    writeLog(state, `${count} ${count === 1 ? ARMY[type].singular : ARMY[type].label} arrive at ${zone.name}.`);
  }
}

function cancelJob(state, uid) {
  const job = state.jobs.find(j => j.uid === uid);
  if (!job) return;
  state.jobs = state.jobs.filter(j => j !== job);
  refund(state, job.cost);
  if (job.kind === 'construct') releaseBuilder(state, job.workerId, job.zoneId);
  if (job.kind === 'transfer') {
    const from = zoneById(state, job.from);
    if (from) from.army[job.type] += job.count;   // recall to where they set out
    writeLog(state, `${job.label}: recalled.`);
    return;
  }
  writeLog(state, `${job.label}: cancelled, refunded.`);
}

// Progress 0..1 for any job. Train jobs beyond the producer's per-zone
// concurrency cap are still queued and report 0.
function jobProgress(state, job) {
  if (job.kind === 'train'
      && !trainJobs(state, job.producer, job.zoneId).slice(0, producerCapacity(state, job.producer, job.zoneId)).includes(job)) {
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
      const gkey = `${job.producer}:${job.zoneId}`;
      const advanced = advancedPerProducer[gkey] || 0;
      if (advanced >= producerCapacity(state, job.producer, job.zoneId)) return;
      advancedPerProducer[gkey] = advanced + 1;
    }
    job.remaining -= step;
  });
  const done = state.jobs.filter(j => j.remaining <= 0);
  state.jobs = state.jobs.filter(j => j.remaining > 0);
  done.forEach(job => {
    if (job.kind === 'construct') releaseBuilder(state, job.workerId, job.zoneId);
    if (job.kind === 'transfer') {
      const to = zoneById(state, job.to);
      if (to) arriveColumn(state, to, job.type, job.count);
      return;
    }
    job.complete(state);
  });
}

// ── Stats ──────────────────────────────────────────────────────────────────

function supplyUsed(state) {
  const stationed = state.zones.reduce((sum, z) => sum + poolCount(z.army) + strikeCount(z.strike), 0);
  const marching = state.jobs.filter(j => j.kind === 'transfer').reduce((sum, j) => sum + j.count, 0);
  return state.workers.length + stationed + marching;
}

function hallTierBonus(state, field) {
  return HALL_TIERS.slice(0, state.hallTier).reduce((sum, t) => sum + t[field], 0);
}

function supplyCap(state) {
  return SUPPLY_BASE + Object.keys(BUILDINGS)
    .reduce((sum, k) => sum + (BUILDINGS[k].supply || 0) * totalStructures(state, k), 0)
    + hallTierBonus(state, 'supply');
}

// The hall's max hp grows with its tier; every other building reads straight
// from the table.
function buildingMaxHp(state, key) {
  return BUILDINGS[key].hp + (key === 'hall' ? hallTierBonus(state, 'hpBonus') : 0);
}

function hallTierName(state) {
  return state.hallTier > 0 ? HALL_TIERS[state.hallTier - 1].label : 'town hall';
}

function hallTierIcon(state) {
  return state.hallTier > 0 ? HALL_TIERS[state.hallTier - 1].icon : 'hall';
}

function supplyFree(state) {
  return supplyUsed(state) + supplyReserved(state) < supplyCap(state);
}

function clampGame(state) {
  for (const key of Object.keys(state.resources)) {
    state.resources[key] = Math.max(0, Math.floor(state.resources[key]));
  }
}

// ── Army ───────────────────────────────────────────────────────────────────

function poolCount(pool) {
  return Object.keys(ARMY).reduce((n, k) => n + pool[k], 0);
}

// Tech-adjusted combat stats and harvest yield.
function unitDmg(state, type) {
  return ARMY[type].dmg + state.tech.weapons * WEAPON_DMG_PER_LEVEL
       + (type === 'ballistas' ? state.tech.ballista * BALLISTA_DMG_PER_LEVEL : 0);
}

function unitHp(state, type) {
  return ARMY[type].hp + state.tech.armor * ARMOR_HP_PER_LEVEL;
}

// Rough income estimate per tick for the hall's info line (all zones).
function incomePerTick(state, resource) {
  return state.workers.reduce((sum, w) => {
    if (w.job !== resource) return sum;
    const node = nodeById(state, w.nodeId);
    return node ? sum + harvestYield(state, resource) / nodeCooldown(state, node) : sum;
  }, 0);
}

function harvestYield(state, resource) {
  return resource === 'lumber'
    ? Math.round(HARVEST_YIELD * (1 + state.tech.lumber * LUMBER_YIELD_PER_LEVEL))
    : HARVEST_YIELD;
}

// Total stationed defenders across every zone.
function totalDefenders(state) {
  return state.zones.reduce((sum, z) => sum + poolCount(z.army), 0);
}

// Units currently marching out to chart the next (undiscovered) zone.
function exploringCount(state) {
  const z = chartingZone(state);
  if (!z) return 0;
  return state.jobs.filter(j => j.kind === 'transfer' && String(j.to) === String(z.id))
    .reduce((s, j) => s + j.count, 0);
}

// Segmented-hp payloads for entityButton: one segment per unit, the last one
// drained by accumulated wounds; `total` drives the collapsed horde bar.
function recentlyHit(at) {
  return !!at && performance.now() - at < HP_BAR_LINGER_MS;
}

function poolHp(pool) {
  const count = poolCount(pool);
  if (count === 0) return null;
  if (pool.wounds === 0 && !recentlyHit(pool.lastHitAt)) return null;
  const type = Object.keys(ARMY).find(k => pool[k] > 0);
  const maxHp = Object.keys(ARMY).reduce((sum, k) => sum + pool[k] * ARMY[k].hp, 0);
  return {
    segments: count,
    partial: 1 - pool.wounds / ARMY[type].hp,
    total: (maxHp - pool.wounds) / maxHp
  };
}

// Node crews: one segment per worker, shown only while the crew is damaged.
// Worker wounds are a global pool but the next victim is deterministic (the
// last non-builder), so the bar belongs on that worker's node.
function nodeHp(state, node) {
  const count = workersAtNode(state, node).length;
  if (count === 0) return null;
  if (state.workerWounds === 0 && !recentlyHit(state.workerLastHitAt)) return null;
  const victim = state.workers.filter(w => w.job !== 'building').pop();
  if (!victim || String(victim.nodeId) !== String(node.id)) return null;
  return {
    segments: count,
    partial: 1 - state.workerWounds / WORKER_HP,
    total: (count * WORKER_HP - state.workerWounds) / (count * WORKER_HP)
  };
}

// Structure tiles: bar whenever a zone's building carries unrepaired damage.
function buildingHp(state, zone, key) {
  const dmg = zone.structureDamage[key];
  if (!dmg || dmg <= 0) return null;
  const full = buildingMaxHp(state, key);
  const segments = zone.structures[key];
  if (segments <= 0) return null;
  return {
    segments,
    partial: (full - dmg) / full,
    total: ((segments - 1) * full + (full - dmg)) / (segments * full)
  };
}

function raidHp(raid) {
  if (raid.size === 0) return null;
  if (raid.hpPool >= raid.size * raid.grunt.hp && !recentlyHit(raid.lastHitAt)) return null;
  return {
    segments: raid.size,
    partial: (raid.hpPool - (raid.size - 1) * raid.grunt.hp) / raid.grunt.hp,
    total: raid.hpPool / (raid.size * raid.grunt.hp)
  };
}

// Garrison bar for an occupied zone: one segment per remaining guard or tower,
// only while damaged (or just hit). Guards soak before towers.
function garrisonHp(g) {
  const full = g.guards.count * g.guards.hp + g.towers * SITE_TOWER.hp;
  const left = g.guardPool
    + (g.towersLeft > 0 ? (g.towersLeft - 1) * SITE_TOWER.hp + g.towerHp : 0);
  if (left >= full && !recentlyHit(g.lastHitAt)) return null;
  const segments = g.guardsLeft + g.towersLeft;
  if (segments === 0) return null;
  const partial = g.guardsLeft > 0
    ? (g.guardPool - (g.guardsLeft - 1) * g.guards.hp) / g.guards.hp
    : g.towerHp / SITE_TOWER.hp;
  return { segments, partial, total: left / full };
}

// A zone's assault column bar — only the fighting strike force takes damage.
function strikeHp(zone) {
  const col = zone.strike;
  if (!col) return null;
  const count = strikeCount(col);
  if (count === 0) return null;
  const hitAt = zone.garrison ? zone.garrison.strikeHitAt : 0;
  if (!col.wounds && !recentlyHit(hitAt)) return null;
  const type = Object.keys(ARMY).find(k => col[k] > 0);
  const maxHp = Object.keys(ARMY).reduce((sum, k) => sum + (col[k] || 0) * ARMY[k].hp, 0);
  return {
    segments: count,
    partial: 1 - col.wounds / ARMY[type].hp,
    total: (maxHp - col.wounds) / maxHp
  };
}

// Marching between zones is a timed 'transfer' job: units leave the source
// zone's defenders immediately, spend the march in transit (untargetable), and
// are delivered by arriveColumn on arrival. Tapping the chip recalls them.
// Consecutive moves on the same route join the same column. Cost grows with the
// number of zones crossed.
function transferTicks(state, fromId, toId) {
  const a = zoneById(state, fromId), b = zoneById(state, toId);
  const steps = (a && b) ? Math.abs(a.index - b.index) : 1;
  return TRANSFER_BASE_TICKS + Math.max(1, steps) * ZONE_MARCH_PER_STEP;
}

function startTransfer(state, fromId, toId, type, count, mode = 'move') {
  const from = zoneById(state, fromId);
  const to = zoneById(state, toId);
  if (!from || !to) return;
  const moved = Math.min(count, from.army[type]);
  if (moved <= 0) return;
  from.army[type] -= moved;
  if (poolCount(from.army) === 0) from.army.wounds = 0;
  const marching = state.jobs.find(j => j.kind === 'transfer'
    && String(j.from) === String(fromId) && String(j.to) === String(toId) && j.type === type);
  if (marching) {
    marching.count += moved;   // join the column already under way
  } else {
    const time = transferTicks(state, fromId, toId);
    const verb = mode === 'assault' ? 'assault' : mode === 'explore' ? 'explore' : 'move';
    state.jobs.push({
      uid: nextId(), kind: 'transfer', from: fromId, to: toId, type, count: moved, mode,
      icon: ARMY[type].icon, overlay: mode === 'assault' ? 'attack' : mode === 'explore' ? 'explore' : 'defend',
      label: `${ARMY[type].label} → ${to.name}`,
      duration: time, remaining: time, cost: {}
    });
  }
  const dest = mode === 'explore' ? 'to chart new ground' : `to ${to.name}`;
  writeLog(state, `${moved} ${moved === 1 ? ARMY[type].singular : ARMY[type].label} marching ${dest}.`);
}

function moveUnit(state, fromId, toId, type, mode) {
  startTransfer(state, fromId, toId, type, 1, mode);
}

function moveAllUnits(state, fromId, toId, type, mode) {
  const from = zoneById(state, fromId);
  startTransfer(state, fromId, toId, type, from ? from.army[type] : 0, mode);
}

// Send units out from `fromId` to chart the next zone (fromId's index + 1).
// Creates the zone if needed (content hidden until arrival) and marches there.
function exploreFrom(state, fromId, type, count) {
  const from = zoneById(state, fromId);
  if (!from) return;
  let target = zoneByIndex(state, from.index + 1);
  if (!target) { target = makeZone(from.index + 1, state.raid.wave); state.zones.push(target); }
  if (target.discovered) return;   // already charted
  startTransfer(state, fromId, target.id, type, count, 'explore');
}

// ── Raid combat ────────────────────────────────────────────────────────────
// Raiding parties are real: grunts with hp/damage arrive, exchange volleys
// every VOLLEY_EVERY ticks, and target defenders first, then workers, then
// buildings. Units on attack/explore are away from the base and neither fight
// raiders nor get targeted.

// Damage a pool of ARMY units deals per volley.
function poolDamage(state, pool) {
  return Object.keys(ARMY).reduce((sum, k) => sum + pool[k] * unitDmg(state, k), 0);
}

// My side's fire at a raid standing in `zone`: that zone's defenders plus its
// towers. Siege parties sit beyond tower range (towers deal 0 vs them).
function defenseDamage(state, zone, raid) {
  if (!raid.atZone) return 0;
  const towerDmg = raid.siege ? 0
    : Object.keys(BUILDINGS).reduce((sum, k) => sum + (BUILDINGS[k].dmg || 0) * zone.structures[k], 0);
  return poolDamage(state, zone.army) + towerDmg;
}

// Damage flows into a zone's defenders' wounds; every full hp's worth kills one
// unit (footmen soak before archers).
function damagePool(state, zone, dmg) {
  const pool = zone.army;
  flashTile(`army:defend:${zone.id}`, 'damage');
  pool.lastHitAt = performance.now();
  pool.wounds += dmg;
  let type = Object.keys(ARMY).find(k => pool[k] > 0);
  while (type && pool.wounds >= unitHp(state, type)) {
    pool.wounds -= unitHp(state, type);
    pool[type] -= 1;
    writeLog(state, `A ${ARMY[type].singular} has fallen at ${zone.name}.`);
    type = Object.keys(ARMY).find(k => pool[k] > 0);
  }
  if (!type) pool.wounds = 0;
}

function workersInZoneLive(state, zone) {
  return state.workers.filter(w => String(w.zoneId) === String(zone.id));
}

function damageWorkers(state, zone, dmg) {
  state.workerLastHitAt = performance.now();
  state.workerWounds += dmg;
  const here = () => workersInZoneLive(state, zone).filter(w => w.job !== 'building');
  const target = here().pop();
  if (target && target.nodeId) flashTile(`node:${target.job}:${target.nodeId}`, 'damage');
  while (state.workerWounds >= WORKER_HP && workersInZoneLive(state, zone).length > 0) {
    state.workerWounds -= WORKER_HP;
    // Builders die last; a dead builder takes its construction down with it.
    const victim = here().pop() || workersInZoneLive(state, zone).pop();
    if (!victim) break;
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

// Raiders razing a zone's buildings: damage accumulates on the building type
// (persisting until repaired), destroying one instance when it exceeds its hp.
function damageBuildings(state, zone, raid, dmg, order) {
  if (!raid.targetType || !order.includes(raid.targetType) || zone.structures[raid.targetType] <= 0) {
    raid.targetType = order.find(k => zone.structures[k] > 0) || null;
  }
  if (!raid.targetType) return;   // nothing left standing here
  const key = raid.targetType;
  flashTile(`structure:${key}:${zone.id}`, 'damage');
  zone.structureDamage[key] += dmg;
  if (zone.structureDamage[key] >= buildingMaxHp(state, key)) {
    zone.structures[key] -= 1;
    zone.structureDamage[key] = 0;
    writeLog(state, `${cap(BUILDINGS[key].label)} at ${zone.name} destroyed by raiders!`);
    if (key === 'hall' && zone.index === 0) {
      flashError('The town hall has fallen!');
      state.over = { won: false, day: currentDay(state) + 1 };
    }
    raid.targetType = null;
  }
}

// Raiders enter beyond the deepest owned zone and march inward toward home.
function spawnRaid(state) {
  const wave = state.raid.wave;
  state.raid.wave += 1;
  const startIndex = Math.max(...ownedZones(state).map(z => z.index), 0);
  let total = 0;
  let party = 0;
  Object.keys(RAIDER_TYPES).forEach(key => {
    const t = RAIDER_TYPES[key];
    if (wave < t.fromWave) return;
    const size = Math.floor(t.baseSize + (wave - t.fromWave) * t.sizePerWave);
    if (size <= 0) return;
    const grunt = { hp: t.hp + wave * t.hpPerWave, dmg: t.dmg + wave * t.dmgPerWave };
    const foeDelay = RAID_VOLLEY_EVERY + party;
    state.raids.push({
      id: nextId(), kind: key, icon: t.icon, label: t.label, siege: !!t.siege,
      size, grunt, hpPool: size * grunt.hp, discovered: true,
      index: startIndex, arriveIn: RAID_ARRIVE_TICKS, atZone: false,
      myStrikeIn: DEFENSE_VOLLEY_EVERY, foeStrikeIn: foeDelay, foeDelay,
      targetType: null
    });
    total += size;
    party += 1;
  });
  if (total > 0) {
    writeLog(state, `${total} raiders are marching in from the frontier!`);
    flashError('Raiders approaching the frontier!');
  }
}

// A zone is subdued once it has no defenders, no workers, and no buildings —
// the raid then marches on to the next zone inward.
function zoneSubdued(state, zone) {
  return poolCount(zone.army) === 0
    && workersInZoneLive(state, zone).length === 0
    && Object.keys(BUILDINGS).every(k => zone.structures[k] === 0);
}

// Snap a raid's target to the next owned, charted zone at or inward of its
// current index (raiders skip empty wilderness and enemy-held zones).
function raidTargetZone(state, raid) {
  while (raid.index >= 0) {
    const z = zoneByIndex(state, raid.index);
    if (z && z.discovered && z.status === 'owned') return z;
    raid.index -= 1;
    raid.atZone = false;
    raid.arriveIn = ZONE_MARCH_PER_STEP;
  }
  return homeZone(state);
}

function raidTick(state) {
  state.raids.forEach(raid => {
    const zone = raidTargetZone(state, raid);
    if (raid.arriveIn > 0) {
      raid.arriveIn -= 1;
      if (raid.arriveIn <= 0) {
        raid.atZone = true;
        raid.razing = false;
        writeLog(state, `${raid.size} ${raid.label} reach ${zone.name}!`);
        flashError(zone.index === 0 ? 'Our town is under attack!' : `${cap(zone.name)} is under attack!`);
      }
    }
    // My volley: this zone's defenders + towers fire once the raid arrives.
    raid.myStrikeIn -= 1;
    if (raid.myStrikeIn <= 0) {
      raid.myStrikeIn = DEFENSE_VOLLEY_EVERY;
      const peers = state.raids.filter(r => r.index === raid.index && !!r.atZone === !!raid.atZone).length || 1;
      const dealt = defenseDamage(state, zone, raid) / peers;
      if (dealt > 0) {
        flashTile(`enemy:raid:${raid.id}`, 'damage');
        flashTile(`army:defend:${zone.id}`, 'attack');
        RAID_TOWER_TARGETS.forEach(k => {
          if (zone.structures[k] > 0) flashTile(`structure:${k}:${zone.id}`, 'attack');
        });
        raid.lastHitAt = performance.now();
      }
      const sizeBefore = raid.size;
      raid.hpPool -= dealt;
      raid.size = Math.max(0, Math.ceil(raid.hpPool / raid.grunt.hp));
      const kills = sizeBefore - raid.size;
      if (kills > 0) {
        const loot = kills * RAIDER_TYPES[raid.kind].bounty;
        raid.plunder = (raid.plunder || 0) + loot;
        state.resources.gold += loot;
      }
      if (raid.size <= 0) {
        writeLog(state, `Raid repelled at ${zone.name}! Plundered ${raid.plunder || 0} gold.`);
        return;
      }
    }
    if (raid.arriveIn > 0) {   // still marching to this zone
      raid.foeStrikeIn = raid.foeDelay || RAID_VOLLEY_EVERY;
      return;
    }
    // Arrived: if the zone is already subdued, march on inward.
    if (zoneSubdued(state, zone) && zone.index > 0) {
      raid.index -= 1;
      raid.atZone = false;
      raid.arriveIn = ZONE_MARCH_PER_STEP;
      return;
    }
    // Raiders strike back on their offset cadence.
    raid.foeStrikeIn -= 1;
    if (raid.foeStrikeIn > 0) return;
    raid.foeStrikeIn = RAID_VOLLEY_EVERY;
    const dmg = raid.size * raid.grunt.dmg;
    flashTile(`enemy:raid:${raid.id}`, 'attack');
    const towersStanding = RAID_TOWER_TARGETS.some(k => zone.structures[k] > 0);
    if (raid.siege) {
      damageBuildings(state, zone, raid, dmg, towersStanding ? RAID_TOWER_TARGETS : RAID_TARGET_ORDER);
      return;
    }
    if (poolCount(zone.army) > 0) damagePool(state, zone, dmg);
    else if (towersStanding) damageBuildings(state, zone, raid, dmg, RAID_TOWER_TARGETS);
    else if (workersInZoneLive(state, zone).length > 0) damageWorkers(state, zone, dmg);
    else damageBuildings(state, zone, raid, dmg, RAID_TARGET_ORDER);
  });
  state.raids = state.raids.filter(r => r.size > 0);
}

// ── Garrison combat (occupied zones) ───────────────────────────────────────
// An occupied zone holds a garrison (guards + watch towers). Units marched in
// become the zone's `strike` column and exchange volleys with the garrison on
// the raid cadences — guards soak first, then towers fall. Clearing it flips
// the zone to `owned`: the surviving strike force settles as its defenders and
// the reward pays out. A wiped strike leaves the garrison's damage standing,
// so a second column finishes the job. The garrison musters reinforcements
// while under attack.

function strikeCount(col) {
  return col ? Object.keys(ARMY).reduce((n, k) => n + (col[k] || 0), 0) : 0;
}

// Damage the garrison deals back into our strike column.
function damageStrike(state, zone, dmg) {
  const g = zone.garrison;
  const strike = zone.strike;
  strike.wounds = (strike.wounds || 0) + dmg;
  g.strikeHitAt = performance.now();
  flashTile(`zone:head:${zone.id}`, 'damage');
  let type = Object.keys(ARMY).find(k => strike[k] > 0);
  while (type && strike.wounds >= unitHp(state, type)) {
    strike.wounds -= unitHp(state, type);
    strike[type] -= 1;
    writeLog(state, `A ${ARMY[type].singular} has fallen at ${zone.name}.`);
    type = Object.keys(ARMY).find(k => strike[k] > 0);
  }
  if (!type) {
    zone.strike = null;
    writeLog(state, `Our assault on ${zone.name} was wiped out!`);
    flashError(`Our warriors fell at ${zone.name}!`);
  }
}

// The garrison falls: the zone becomes ours. Survivors settle as defenders,
// the reward pays out, and the stronghold's fall wins the game.
function conquerZone(state, zone) {
  const g = zone.garrison;
  const survivors = zone.strike || emptyArmy();
  writeLog(state, `${cap(zone.name)} cleared!`);
  flashError(`${cap(zone.name)} taken — ${g.rewardText}!`);
  if (g.final) {
    writeLog(state, 'The orc stronghold lies in ruins! Victory!');
    state.over = { won: true, day: currentDay(state) + 1 };
  }
  const r = g.reward || {};
  if (r.cache) {
    refund(state, r.cache);
    writeLog(state, `Plundered: ${Object.keys(r.cache).map(k => `${r.cache[k]} ${k}`).join(', ')}.`);
  }
  const freed = r.units || {};
  if (r.workers) {
    for (let i = 0; i < r.workers; i += 1) state.workers.push(createWorker('idle', null, 0, zone.id));
    autoAssignWorkers(state);
    writeLog(state, `${r.workers} freed peasants join ${zone.name}.`);
  }
  // Survivors + freed units become the zone's garrison-in-reverse: its
  // defenders. The zone flips to owned.
  const army = zone.army;
  Object.keys(ARMY).forEach(k => { army[k] += (survivors[k] || 0) + (freed[k] || 0); });
  army.wounds += survivors.wounds || 0;
  zone.strike = null;
  zone.garrison = null;
  zone.status = 'owned';
  zone.wasOccupied = true;   // razed strongholds thin future raids
  zone.name = `zone ${zone.index}`;
  flashTile(`army:defend:${zone.id}`, 'spawn');
}

function garrisonTick(state) {
  state.zones.forEach(zone => {
    const g = zone.garrison;
    if (!g || zone.status !== 'occupied') return;
    // Muster reinforcements while our strike force is fighting.
    if (zone.strike && g.reinforce) {
      g.reinforceIn -= 1;
      if (g.reinforceIn <= 0) {
        g.reinforceIn = g.reinforce.every;
        if (g.guardsLeft < g.reinforce.cap) {
          g.guardsLeft += 1;
          g.guardPool += g.guards.hp;
          flashTile(`zone:head:${zone.id}`, 'spawn');
          writeLog(state, `Reinforcements muster at ${zone.name}.`);
        }
      }
    }
    if (!zone.strike) return;
    // Our volley: guards soak first, then towers fall one by one.
    g.myStrikeIn -= 1;
    if (g.myStrikeIn <= 0) {
      g.myStrikeIn = DEFENSE_VOLLEY_EVERY;
      let dealt = Object.keys(ARMY).reduce((sum, k) => sum + (zone.strike[k] || 0) * unitDmg(state, k), 0);
      if (dealt > 0) {
        flashTile(`zone:head:${zone.id}`, 'damage');
        g.lastHitAt = performance.now();
      }
      if (g.guardsLeft > 0) {
        g.guardPool = Math.max(0, g.guardPool - dealt);
        g.guardsLeft = Math.ceil(g.guardPool / g.guards.hp);
      } else {
        while (dealt > 0 && g.towersLeft > 0) {
          const hit = Math.min(dealt, g.towerHp);
          g.towerHp -= hit;
          dealt -= hit;
          if (g.towerHp <= 0) {
            g.towersLeft -= 1;
            g.towerHp = SITE_TOWER.hp;
            writeLog(state, `Watch tower at ${zone.name} destroyed.`);
          }
        }
      }
      if (g.guardsLeft <= 0 && g.towersLeft <= 0) {
        conquerZone(state, zone);
        return;
      }
    }
    // The garrison strikes back on the raiders' cadence.
    g.foeStrikeIn -= 1;
    if (g.foeStrikeIn > 0) return;
    g.foeStrikeIn = RAID_VOLLEY_EVERY;
    const dmg = g.guardsLeft * g.guards.dmg + g.towersLeft * SITE_TOWER.dmg;
    if (dmg > 0) {
      flashTile(`zone:head:${zone.id}`, 'attack');
      damageStrike(state, zone, dmg);
    }
  });
}

// ── Tick ───────────────────────────────────────────────────────────────────

function currentDay(state) {
  return Math.floor(state.tick / DAY_TICKS);
}

function gameTick() {
  if (game.over) { render(); return; }
  game.tick += 1;
  lastTickAt = performance.now();

  autoAssignWorkers(game);
  harvestTick(game);

  // Survivors patch up between fights — a zone's defenders heal only while no
  // raid is fighting there. Workers mend very slowly, and not at all while any
  // raid has reached a zone.
  const underAttack = game.raids.some(r => r.atZone);
  game.zones.forEach(z => {
    const raidHere = game.raids.some(r => r.atZone && r.index === z.index);
    if (!raidHere) z.army.wounds = Math.max(0, z.army.wounds - HEAL_DEFEND_PER_TICK);
  });
  if (!underAttack) game.workerWounds = Math.max(0, game.workerWounds - WORKER_HEAL_PER_TICK);

  // Raids — spawn on a shrinking interval, then fight tick by tick. Every
  // occupied zone we've razed permanently stretches the interval back out.
  game.raid.nextIn -= 1;
  if (game.raid.nextIn <= 0) {
    spawnRaid(game);
    const relief = game.zones.filter(z => z.index > 0 && z.discovered && z.status === 'owned'
      && !z.garrison && z.wasOccupied).length * RAID_OUTPOST_RELIEF;
    game.raid.interval = Math.max(RAID_INTERVAL_MIN, RAID_INTERVAL_BASE - currentDay(game) * RAID_INTERVAL_SCALE) + relief;
    game.raid.nextIn = game.raid.interval;
  }
  raidTick(game);
  garrisonTick(game);

  advanceJobs(game);
  clampGame(game);
  render();
}

// ── Commands ───────────────────────────────────────────────────────────────
// Commands resolve against the currently selected zone (structures, training,
// building, and army moves all act in a zone).

function selectedZone(state) {
  return zoneById(state, state.selected.zoneId) || homeZone(state);
}

function trainCommand(key) {
  const u = UNITS[key];
  const zn = s => selectedZone(s);
  const checks = [
    [s => zn(s).structures[u.producer] > 0, `Need a ${BUILDINGS[u.producer].label}`],
    ...(u.requires || []).map(req => [s => totalStructures(s, req) > 0, `Need a ${BUILDINGS[req].label}`]),
    [s => supplyFree(s), 'Supply capped — build a farm'],
    [s => queueLength(s, u.producer, zn(s).id) < queueMax(s, u.producer, zn(s).id), 'Queue full']
  ];
  const { available, reason } = gated(checks);
  return {
    id: `train-${key}`, icon: u.icon, label: `train ${u.label}`,
    cost: [...costIcons(u.cost), { icon: 'supply', n: 1 }],
    available, reason,
    enabled: s => available(s) && canAfford(s, u.cost),
    run: s => trainUnit(s, key, selectedZone(s).id)
  };
}

// One command per tech track, attached to its source building. Tech is global
// (researched at any copy of the source, applies army-wide).
function techCommand(key) {
  const t = TECH[key];
  const level = s => s.tech[key];
  const busy = s => pendingUpgrades(s, key) > 0;
  const { available, reason } = gated([
    [s => !busy(s), 'Already researching'],
    [s => upgradeSlotFree(s, t.source), `${cap(BUILDINGS[t.source].label)} busy — build another`]
  ]);
  return {
    id: `tech-${key}`,
    hidden: s => level(s) >= t.max,
    get icon() { return t.icons[Math.min(game.tech[key], t.max - 1)]; },
    label: `upgrade ${t.label}`,
    get cost() { return costIcons(t.costs[Math.min(game.tech[key], t.max - 1)]); },
    available, reason,
    enabled: s => available(s) && canAfford(s, t.costs[Math.min(level(s), t.max - 1)]),
    run: s => {
      const tier = level(s);
      const zid = selectedZone(s).id;
      startUpgrade(s, {
        tag: key, source: t.source, icon: t.icons[tier], label: `${t.label} ${tier + 1}`,
        time: t.times[tier], cost: t.costs[tier],
        complete: st => {
          st.tech[key] += 1;
          flashTile(`structure:${t.source}:${zid}`, 'spawn');
          writeLog(st, `${cap(t.label)} upgraded to tier ${st.tech[key]}.`);
        }
      });
    }
  };
}

// Both tower upgrades draw from the selected zone's plain towers, so each
// counts the other's in-flight upgrades when checking for a free one.
function towersFree(s) {
  const z = selectedZone(s);
  return z.structures.tower > pendingUpgrades(s, 'guardtower') + pendingUpgrades(s, 'cannontower');
}

function towerUpgradeCommand(key, spec, requires, reqLabel) {
  const b = BUILDINGS[key];
  const { available, reason } = gated([
    [s => totalStructures(s, requires) > 0, reqLabel],
    [towersFree, 'No tower free to upgrade']
  ]);
  return {
    id: `upgrade-${key}`, icon: key, label: `upgrade to ${b.label}`,
    cost: costIcons(spec.cost),
    available, reason,
    enabled: s => available(s) && canAfford(s, spec.cost),
    run: s => {
      const zid = selectedZone(s).id;
      startUpgrade(s, {
        tag: key, source: 'tower', icon: key, label: b.label,
        time: spec.time, cost: spec.cost,
        complete: st => {
          const z = zoneById(st, zid) || homeZone(st);
          z.structures.tower -= 1;
          z.structures[key] += 1;
          flashTile(`structure:${key}:${z.id}`, 'spawn');
          writeLog(st, `${cap(b.label)} ready.`);
        }
      });
    }
  };
}

function guardTowerCommand() {
  return towerUpgradeCommand('guardtower', GUARD_TOWER, 'lumbermill', 'Need a lumber mill');
}

// One command per hall tier — each shows only while it's the next step up.
// The hall is home's, so tiers upgrade home.
function hallTierCommand(tierIndex) {
  const t = HALL_TIERS[tierIndex];
  const { available, reason } = gated([
    [t.requires, t.reqLabel],
    [s => upgradeSlotFree(s, 'hall'), 'The hall is already being upgraded']
  ]);
  return {
    id: `upgrade-${t.key}`, icon: t.icon, label: `upgrade to ${t.label}`,
    cost: costIcons(t.cost),
    hidden: s => s.hallTier !== tierIndex,
    available, reason,
    enabled: s => s.hallTier === tierIndex && available(s) && canAfford(s, t.cost),
    run: s => startUpgrade(s, {
      tag: t.key, source: 'hall', icon: t.icon, label: t.label,
      time: t.time, cost: t.cost,
      complete: st => {
        st.hallTier = tierIndex + 1;
        flashTile(`structure:hall:${homeZone(st).id}`, 'spawn');
        writeLog(st, `Our hall now stands as a ${t.label}.`);
      }
    })
  };
}

function cannonTowerCommand() {
  return towerUpgradeCommand('cannontower', CANNON_TOWER, 'blacksmith', 'Need a blacksmith');
}

// One command per unit type present in `src` that sends units of that type from
// src into `zone` with the given mode/overlay. Tap sends one, hold sends all.
// Used for both exploring the uncharted zone ahead and assaulting a garrison —
// in both cases the units come from the previous (inner) owned zone.
function sendFromCommands(state, zone, src, mode, overlay, verb, send) {
  return Object.keys(ARMY).filter(type => src.army[type] > 0).map(type => ({
    id: `${mode}-${zone.id}-${type}`,
    icon: ARMY[type].icon, overlay,
    label: `${verb} — ${ARMY[type].singular} from ${src.name}`, cost: '',
    enabled: s => (zoneById(s, src.id) || src).army[type] > 0,
    reason: () => `No ${ARMY[type].label} in ${src.name}`,
    run: s => send(s, src.id, zone.id, type, 1),
    runAll: s => send(s, src.id, zone.id, type, (zoneById(s, src.id) || src).army[type])
  }));
}

// Commands for a selected zone:
//  • uncharted (undiscovered) → explore buttons, pulling from the zone behind it;
//  • occupied → assault buttons, pulling from the zone behind it;
//  • owned → just Build (for now).
function zoneCommands(state, zone) {
  const src = zoneByIndex(state, zone.index - 1);
  if (!zone.discovered) {
    if (!src || src.status !== 'owned') return [];
    return sendFromCommands(state, zone, src, 'explore', 'explore', 'explore',
      (s, fromId, _toId, type, n) => exploreFrom(s, fromId, type, n));
  }
  if (zone.status === 'occupied') {
    if (!src || src.status !== 'owned') return [];
    return sendFromCommands(state, zone, src, 'assault', 'attack', 'assault',
      (s, fromId, toId, type, n) => startTransfer(s, fromId, toId, type, n, 'assault'));
  }
  // Owned zone: just Build. Moving defenders is done by selecting a defender
  // group (a unit tile) and using its Move command.
  return [{
    id: 'zone-build', icon: 'build', label: `build in ${zone.name}`, cost: '',
    enabled: s => builderWorker(s, zoneById(s, zone.id)) != null,
    reason: () => 'No worker available',
    run: s => { s.buildMenu = true; }
  }];
}

// Static per-structure command sets. Train commands attach to their producer;
// tower upgrades, hall tiers, tech, build-menu opener, and repair are appended.
const COMMANDS = {
  structure: (() => {
    const byStructure = {};
    Object.keys(UNITS).forEach(key => {
      const producer = UNITS[key].producer;
      (byStructure[producer] = byStructure[producer] || []).push(trainCommand(key));
    });
    // Building is done by selecting a zone and tapping Build, so the hall only
    // trains workers and raises its own tier.
    (byStructure.hall = byStructure.hall || []).push(...HALL_TIERS.map((t, i) => hallTierCommand(i)));
    (byStructure.tower = byStructure.tower || []).push(guardTowerCommand(), cannonTowerCommand());
    Object.keys(TECH).forEach(key => {
      const source = TECH[key].source;
      (byStructure[source] = byStructure[source] || []).push(techCommand(key));
    });
    // Every building gets a repair command, hidden until it carries damage.
    Object.keys(BUILDINGS).forEach(key => {
      const b = BUILDINGS[key];
      (byStructure[key] = byStructure[key] || []).push({
        id: `repair-${key}`, icon: 'repair', label: `repair ${b.label}`, cost: '',
        hidden: s => !(selectedZone(s).structureDamage[key] > 0) || pendingRepair(s, key, selectedZone(s).id),
        enabled: s => selectedZone(s).structureDamage[key] > 0 && !pendingRepair(s, key, selectedZone(s).id) && builderWorker(s, selectedZone(s)) != null,
        reason: () => 'No worker available',
        run: s => startRepair(s, key, selectedZone(s).id)
      });
    });
    return byStructure;
  })(),
  workerGroup: []
};

function buildMenuCommands(state) {
  const zone = selectedZone(state);
  return [
    // Back/cancel leads the list so it's always the first, findable button.
    { id: 'build-menu-stop', icon: 'stop', label: 'back', cost: '',
      enabled: () => true,
      run: s => { s.buildMenu = false; } },
    ...Object.keys(BUILDINGS).filter(key => BUILDINGS[key].build).map(key => {
      const b = BUILDINGS[key];
      // Only home may raise a hall tier chain / stables gating uses home tier;
      // buildings otherwise go up in whatever zone is selected.
      const { available, reason } = gated([
        ...(b.build.requires || []).map(req => [s => totalStructures(s, req) > 0, `Need a ${BUILDINGS[req].label}`]),
        ...(b.build.requiresTier
          ? [[s => s.hallTier >= b.build.requiresTier, `Need a ${HALL_TIERS[b.build.requiresTier - 1].label}`]]
          : []),
        [s => builderWorker(s, selectedZone(s)) != null, 'No worker available']
      ]);
      return {
        id: `build-${key}`, icon: b.icon, label: `build ${b.label} in ${zone.name}`, cost: costIcons(b.build.cost),
        available, reason,
        enabled: s => available(s) && canAfford(s, b.build.cost),
        run: s => startConstruction(s, key, selectedZone(s).id)
      };
    }),
  ];
}

function nodeCommands(state, node) {
  const zone = nodeZone(state, node.id);
  return [
    { id: 'node-assign', icon: 'harvest', overlay: node.type, label: `harvest ${node.type}`, cost: '',
      enabled: s => node.remaining > 0 && zone && spareWorker(s, zone, node) != null,
      reason: s => node.remaining <= 0 ? `${node.label} depleted` : 'No spare workers here',
      run: s => sendWorkerToNode(s, node),
      runAll: s => sendAllWorkersToNode(s, node) },
    // Move one of this crew: tap Move, then tap a zone (or a specific resource
    // node in a zone to switch what they harvest). One worker per tap.
    { id: 'node-move', icon: 'move', overlay: node.icon, label: 'move a worker — then tap a zone or resource', cost: '',
      enabled: s => workersAtNode(s, node).length > 0,
      reason: () => 'No crew here',
      run: s => { s.moveArm = { kind: 'workers', fromZoneId: zone ? zone.id : node.zoneId, resource: node.type, nodeId: node.id }; } }
  ];
}

// A selected worker group (the idle-workers tile) can be sent to another zone.
function workerGroupCommands(state) {
  return [
    { id: 'idle-move', icon: 'move', overlay: 'worker', label: 'move an idle worker — then tap a zone or resource', cost: '',
      enabled: s => idleInZone(s, selectedZone(s)) > 0,
      reason: () => 'No idle workers here',
      run: s => { s.moveArm = { kind: 'workers', fromZoneId: selectedZone(s).id, resource: null }; } }
  ];
}

// A selected army group (a zone's defenders of one type) can march to another
// owned zone: tap Move, then tap the destination. One unit per tap.
function armyGroupCommands(state) {
  const type = state.selected.type;
  if (!ARMY[type]) return [];
  return [
    { id: 'army-move', icon: 'move', overlay: ARMY[type].icon, label: `move a ${ARMY[type].singular} — then tap a zone`, cost: '',
      enabled: s => { const z = zoneById(s, s.selected.id); return !!z && z.army[type] > 0; },
      reason: () => 'None here',
      run: s => { s.moveArm = { kind: 'army', fromZoneId: s.selected.id, type }; } }
  ];
}

function selectedCommands(state) {
  // Build menu is modal over whatever is selected; it builds into the selected
  // zone (the builder is chosen at dispatch by builderWorker).
  if (state.buildMenu) return buildMenuCommands(state);
  if (!selectionValid(state)) return [];   // stale selection -> empty card
  if (state.selected.kind === 'structure') return COMMANDS.structure[state.selected.type] || [];
  if (state.selected.kind === 'workerGroup') return workerGroupCommands(state);
  if (state.selected.kind === 'node') {
    const node = nodeById(state, state.selected.id);
    return node ? nodeCommands(state, node) : [];
  }
  if (state.selected.kind === 'army') return armyGroupCommands(state);
  if (state.selected.kind === 'zone') {
    const zone = zoneById(state, state.selected.id);
    return zone ? zoneCommands(state, zone) : [];
  }
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

// Transient tile flashes (red = taking damage, white = spawn/assignment,
// attack = a subtle shake on the attacker). Keyed by tile identity so they
// survive the full-rebuild render; entityButton applies the classes while the
// entries are fresh, then they expire. Two independent channels per tile —
// the overlay flash (damage/spawn, an ::after animation) and the attack shake
// (a transform animation) — so a tile can shake from its own volley while
// flashing red from the one it just took, in parallel.
const FLASH_MS = 600;
const tileFlashes = new Map();

function flashTile(key, kind) {
  // Combat flashes get a per-tile 50–100ms stagger (via CSS animation-delay)
  // so simultaneous volleys don't all strike in the same frame.
  const delay = kind === 'spawn' ? 0 : 50 + Math.round(Math.random() * 50);
  const entry = tileFlashes.get(key) || {};
  entry[kind === 'attack' ? 'attack' : 'overlay'] =
    { kind, delay, until: performance.now() + FLASH_MS + delay };
  tileFlashes.set(key, entry);
}

function tileFlash(key) {
  const entry = tileFlashes.get(key);
  if (!entry) return null;
  const now = performance.now();
  ['overlay', 'attack'].forEach(ch => {
    if (entry[ch] && entry[ch].until <= now) delete entry[ch];
  });
  if (!entry.overlay && !entry.attack) {
    tileFlashes.delete(key);
    return null;
  }
  return entry;
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

function selectEntity(kind, type, id, zoneId) {
  game.selected = { kind, type, id, zoneId: zoneId != null ? zoneId : game.selected.zoneId };
  game.buildMenu = false;
  render();
}

// Selection is left alone even when its target disappears (depleted node,
// structure consumed by an upgrade, emptied army group) — a stale selection
// simply shows an empty command bar until the player taps something else.
const SELECTION_VALID = {
  structure: (s, sel) => {
    const z = zoneById(s, sel.zoneId);
    return !!z && (sel.type === 'hall' ? z.structures.hall > 0 : z.structures[sel.type] > 0);
  },
  node: (s, sel) => { const n = nodeById(s, sel.id); return !!n && n.remaining > 0; },
  // Army tiles are one per unit type present in a zone (id = zoneId, type = ARMY key).
  army: (s, sel) => {
    const z = zoneById(s, sel.id);
    return !!z && !!ARMY[sel.type] && z.army[sel.type] > 0;
  },
  workerGroup: () => true,
  enemy: () => true,
  // Zones stay selectable while uncharted too (so you can send scouts ahead).
  zone: (s, sel) => !!zoneById(s, sel.id)
};

function selectionValid(state) {
  const valid = SELECTION_VALID[state.selected.kind];
  return !!valid && valid(state, state.selected);
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
const RADIAL_R = 10;   // ~60% of the original 17 — subtler ring
const RADIAL_HIGH_ALPHA = 0.95;
const RADIAL_MIN_ALPHA = 0.45;
const RADIAL_START_ANGLE = -Math.PI / 2; // 12 o'clock

// Canvas-drawn ring: a true conic gradient sweeping from transparent at the
// trailing edge to a bright circular head at the current-progress point,
// instead of many discrete SVG segments approximating a fade.
function radialProgressCanvas(p, siblingCount = 1, backdrop = true) {
  const clamped = Math.max(0, Math.min(1, p));
  const peakAlpha = Math.max(RADIAL_MIN_ALPHA, RADIAL_HIGH_ALPHA / siblingCount);
  const dpr = window.devicePixelRatio || 1;

  const canvas = document.createElement('canvas');
  canvas.className = 'radial-progress';
  canvas.width = RADIAL_SIZE * dpr;
  canvas.height = RADIAL_SIZE * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // Semi-transparent disc behind the ring so it reads on any sprite — only
  // the first canvas in a stack draws it, so siblings don't darken it.
  if (backdrop) {
    ctx.beginPath();
    ctx.arc(RADIAL_SIZE / 2, RADIAL_SIZE / 2, RADIAL_R + 5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fill();
  }

  if (clamped > 0.001) {
    const cx = RADIAL_SIZE / 2;
    const cy = RADIAL_SIZE / 2;
    const endAngle = RADIAL_START_ANGLE + clamped * Math.PI * 2;

    const gradient = ctx.createConicGradient(RADIAL_START_ANGLE, cx, cy);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
    gradient.addColorStop(clamped, `rgba(255, 255, 255, ${peakAlpha})`);

    ctx.beginPath();
    ctx.arc(cx, cy, RADIAL_R, RADIAL_START_ANGLE, endAngle, false);
    ctx.lineWidth = 5;
    ctx.lineCap = 'butt';
    ctx.strokeStyle = gradient;
    ctx.stroke();

    // Clear the head's footprint before filling it, so the translucent fill
    // replaces those pixels instead of blending on top of the gradient tail
    // already painted there — avoids the tip reading dimmer than the back.
    const headR = 3;
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
  const cd = nodeCooldown(state, node);
  const step = state.cheats.fastHarvest ? CHEAT_SPEED : 1;
  return workersAtNode(state, node)
    .map(w => Math.min(1, ((cd - w.cooldown) + tickFraction(step)) / cd));
}

// One continuous bar per group, showing the pool's combined hp — no
// per-unit segmentation.
function hpBarEl(hp, extraClass) {
  const bar = document.createElement('span');
  bar.className = extraClass ? `hp-bar ${extraClass}` : 'hp-bar';
  const seg = document.createElement('span');
  seg.className = 'hp-seg';
  const fill = document.createElement('i');
  fill.style.width = `${Math.round(Math.max(0, Math.min(1, hp.total)) * 100)}%`;
  seg.appendChild(fill);
  bar.appendChild(seg);
  return bar;
}

function entityButton({ kind, type, id, zoneId, icon, label, count, meta, danger, compact, jobIcon, badgeBlink, progressBars, nodeId, jobUid, exploreBadge, countLabel, countIcon, hp, dimmed }) {
  const button = document.createElement('button');
  const classes = ['entity'];
  if (danger)  classes.push('danger');
  if (compact) classes.push('compact');
  if (dimmed)  classes.push('dimmed');
  // Combat flashes for a zone's contents are keyed by zone id: structures as
  // structure:<key>:<zoneId>, all defender tiles share army:defend:<zoneId>.
  const flashKey = kind === 'army' && zoneId != null ? `army:defend:${zoneId}`
    : kind === 'structure' && zoneId != null ? `structure:${type}:${zoneId}`
    : `${kind}:${type}:${id}`;
  const flash = tileFlash(flashKey);
  if (flash && flash.overlay) {
    classes.push(flash.overlay.kind === 'damage' ? 'flash-damage' : 'flash-spawn');
  }
  if (flash && flash.attack) classes.push('flash-attack');
  button.className = classes.join(' ');
  if (flash && flash.overlay && flash.overlay.delay) {
    button.style.setProperty('--flash-delay', `${flash.overlay.delay}ms`);
  }
  if (flash && flash.attack && flash.attack.delay) {
    button.style.setProperty('--shake-delay', `${flash.attack.delay}ms`);
  }
  const zoneMatch = zoneId == null || String(game.selected.zoneId) === String(zoneId);
  if (game.selected.kind === kind && game.selected.type === type && String(game.selected.id) === String(id) && zoneMatch) {
    button.classList.add('selected');
  }
  button.dataset.kind = kind;
  button.dataset.type = type;
  button.dataset.id = id;
  if (zoneId != null) button.dataset.zone = zoneId;
  button.title = label;
  button.setAttribute('aria-label', label);

  const iconEl = makeIcon(ICONS[icon], label);
  button.appendChild(iconEl);

  const hasProgress = progressBars && progressBars.length > 0;
  if (jobIcon || hasProgress) {
    const badge = document.createElement('span');
    badge.className = badgeBlink ? 'job-badge badge-blink' : 'job-badge';
    if (nodeId) badge.dataset.nodeId = nodeId;
    if (jobUid) badge.dataset.jobUid = jobUid;
    if (exploreBadge) badge.dataset.exploreRing = '1';
    if (jobIcon) badge.appendChild(makeIcon(ICONS[jobIcon], meta || jobIcon));
    if (hasProgress) {
      progressBars.forEach((p, i) => badge.appendChild(radialProgressCanvas(p, progressBars.length, i === 0)));
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

  // Segmented hp bar: one segment per unit, the last partially drained by the
  // pool's accumulated wounds; collapses to one bar for hordes. Appended last
  // so it paints above the badges.
  if (hp && hp.segments > 0) button.appendChild(hpBarEl(hp));

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
  renderGameOver();
  dom.day.textContent = `DAY ${currentDay(game) + 1}`;
  const visibleRaids = game.raids.some(r => r.discovered);
  dom.raidclock.textContent = visibleRaids ? 'RAID!' : '';
  dom.raidclock.classList.toggle('alert', visibleRaids);
  renderResources();
  renderQueueStrip();
  // Full rebuild resets scroll on the horizontal strips and on the world canvas
  // itself (now vertically scrollable) — capture and restore so the view keeps
  // its place across repaints.
  const scrollPos = {};
  dom.world.querySelectorAll('[data-scroll]').forEach(el => {
    scrollPos[el.dataset.scroll] = el.scrollLeft;
  });
  const worldScrollTop = dom.world.scrollTop;
  renderWorld();
  dom.world.querySelectorAll('[data-scroll]').forEach(el => {
    if (scrollPos[el.dataset.scroll]) el.scrollLeft = scrollPos[el.dataset.scroll];
  });
  if (worldScrollTop) dom.world.scrollTop = worldScrollTop;
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
  if (job.kind === 'transfer' && job.count > 1) {
    const n = document.createElement('span');
    n.className = 'chip-count';
    n.textContent = job.count;
    chip.appendChild(n);
  }
  chip.appendChild(radialProgressCanvas(jobProgress(game, job)));
  chip.addEventListener('click', () => {
    cancelJob(game, job.uid);
    render();
  });
  return chip;
}

// The production queue lives in its own fixed-height strip at the very top,
// under the resource bar — it never grows or collapses, so the layout below
// stays put whether the queue is empty or full.
function renderQueueStrip() {
  const scrollLeft = dom.queue.scrollLeft;
  dom.queue.replaceChildren();
  game.jobs.filter(j => ['train', 'construct', 'upgrade'].includes(j.kind))
    .forEach(job => dom.queue.appendChild(jobChip(job)));
  if (scrollLeft) dom.queue.scrollLeft = scrollLeft;
}

// Small chip: an icon plus a count (garrison guards, our columns, etc.).
function tileChip(icon, n) {
  const chip = document.createElement('span');
  chip.className = 'site-chip';
  chip.appendChild(makeIcon(ICONS[icon], icon));
  const count = document.createElement('span');
  count.textContent = n;
  chip.appendChild(count);
  return chip;
}

// One chip per unit type present in a column, stacked bottom-left.
function armyChips(counts, blink) {
  const wrap = document.createElement('span');
  wrap.className = blink ? 'mine-chips badge-blink' : 'mine-chips';
  Object.keys(ARMY).forEach(k => {
    if (counts[k] > 0) wrap.appendChild(tileChip(ARMY[k].icon, counts[k]));
  });
  return wrap;
}

// A column mid-march to a zone: unit icon, destination badge with the march
// progress ring. Tapping it recalls the column to where it set out.
function marchTile(job) {
  const to = zoneById(game, job.to);
  return entityButton({
    kind: 'march', type: job.mode || 'move', id: job.uid, compact: true,
    icon: ARMY[job.type].icon, label: `${job.count} marching to ${to ? to.name : 'the frontier'} — tap to recall`,
    jobIcon: job.mode === 'assault' ? 'attack' : job.mode === 'explore' ? 'explore' : 'defend',
    jobUid: job.uid, progressBars: [jobProgress(game, job)], countLabel: job.count
  });
}

// The defenders of an owned zone: one tile per unit type present (each its own
// selection, id = zoneId, type = ARMY key). The shared wounds bar rides on the
// first type present.
function zoneArmyTiles(zone) {
  const pool = zone.army;
  const types = Object.keys(ARMY).filter(k => pool[k] > 0);
  return types.map((k, i) => entityButton({
    kind: 'army', type: k, id: zone.id, zoneId: zone.id, compact: true,
    icon: ARMY[k].icon, label: `${ARMY[k].label} at ${zone.name}`,
    jobIcon: 'defend', countLabel: pool[k],
    hp: i === 0 ? poolHp(pool) : null
  }));
}

// The garrison header tile of an occupied zone — the whole fight on one big
// tile: reward badge, garrison chips (guards then towers), our strike chips,
// and the two hp bars. Veiled until we engage.
function garrisonTile(zone) {
  const g = zone.garrison;
  const engaged = !!zone.strike;
  const known = !g.veiled || engaged;
  const btn = entityButton({
    kind: 'zone', type: 'head', id: zone.id, zoneId: zone.id, compact: true,
    icon: 'siteTerrain', label: zone.name, danger: true,
    hp: known ? garrisonHp(g) : null
  });
  btn.classList.add('site-big');
  const reward = document.createElement('span');
  reward.className = 'site-chip reward';
  reward.appendChild(makeIcon(ICONS[g.rewardIcon], g.rewardText));
  btn.appendChild(reward);
  if (known) {
    const foes = document.createElement('span');
    foes.className = 'site-chips';
    if (g.guardsLeft > 0) foes.appendChild(tileChip('enemy', g.guardsLeft));
    if (g.towersLeft > 0) foes.appendChild(tileChip('orctower', g.towersLeft));
    if (foes.children.length) btn.appendChild(foes);
  }
  if (zone.strike) {
    btn.appendChild(armyChips(zone.strike));
    const shp = strikeHp(zone);
    if (shp) btn.appendChild(hpBarEl(shp, 'mine'));
  }
  return btn;
}

function tileRow(scrollKey, tiles) {
  const section = document.createElement('section');
  section.className = 'world-group';
  const row = document.createElement('div');
  row.className = 'tile-row';
  row.dataset.scroll = scrollKey;
  tiles.forEach(t => t && row.appendChild(t));
  section.appendChild(row);
  return section;
}

// Raids currently at (or marching on) a given zone index.
function raidTilesAt(index) {
  return game.raids.filter(r => r.discovered && r.index === index).map(raid =>
    entityButton({
      kind: 'enemy', type: 'raid', id: raid.id, compact: true,
      icon: raid.icon, label: raid.label, danger: true,
      countLabel: raid.size, hp: raidHp(raid)
    }));
}

// Marching columns whose destination is this zone.
function marchTilesTo(zoneId) {
  return game.jobs.filter(j => j.kind === 'transfer' && String(j.to) === String(zoneId)).map(marchTile);
}

// Render one zone as a stacked, tappable band (tapping empty band area selects
// the whole zone; tapping a tile selects that tile).
function renderZoneBand(zone) {
  const cls = zone.status === 'occupied' ? 'occupied' : (zone.index === 0 ? 'home' : 'owned');
  const rows = [];
  const raids = raidTilesAt(zone.index);
  const marches = marchTilesTo(zone.id);

  if (zone.status === 'occupied') {
    rows.push(zoneCaption(zone));
    rows.push(tileRow(`z${zone.id}-head`, [garrisonTile(zone), ...marches]));
    if (raids.length) rows.push(tileRow(`z${zone.id}-raids`, raids));
    return zoneBand(cls, zone.id, rows);
  }

  // Owned zone: a caption naming it, then defenders (+ inbound columns),
  // workers/nodes and buildings. No header tile — tap the band to select it.
  rows.push(zoneCaption(zone));
  if (raids.length) rows.push(tileRow(`z${zone.id}-raids`, raids));
  rows.push(tileRow(`z${zone.id}-army`, [...zoneArmyTiles(zone), ...marches]));

  // Live resource nodes with their crews (idle-workers tile when none live).
  const liveNodes = zone.nodes.filter(n => n.remaining > 0);
  const nodeTiles = [];
  if (liveNodes.length === 0) {
    const idle = workersInZone(game, zone).filter(w => w.job === 'idle').length;
    nodeTiles.push(entityButton({
      kind: 'workerGroup', type: 'idle', id: zone.id, zoneId: zone.id,
      icon: 'worker', label: 'idle workers', compact: true,
      countLabel: idle > 0 ? idle : null, dimmed: idle === 0
    }));
  }
  liveNodes.forEach(node => {
    const crew = workersAtNode(game, node).length;
    nodeTiles.push(entityButton({
      kind: 'node', type: node.type, id: node.id, zoneId: zone.id,
      icon: node.icon, label: node.label, compact: true,
      progressBars: nodeProgressBars(game, node), nodeId: node.id,
      countLabel: crew > 0 ? crew : null, countIcon: crew > 0 ? 'worker' : null,
      hp: nodeHp(game, node)
    }));
  });
  rows.push(tileRow(`z${zone.id}-nodes`, nodeTiles));

  const structTiles = [];
  Object.keys(BUILDINGS).forEach(key => {
    if (zone.structures[key] <= 0) return;
    structTiles.push(entityButton({
      kind: 'structure', type: key, id: zone.id, zoneId: zone.id, compact: true,
      icon: key === 'hall' ? hallTierIcon(game) : BUILDINGS[key].icon,
      label: key === 'hall' ? hallTierName(game) : BUILDINGS[key].label,
      countLabel: zone.structures[key] > 1 ? zone.structures[key] : null,
      hp: buildingHp(game, zone, key)
    }));
  });
  rows.push(tileRow(`z${zone.id}-struct`, structTiles));

  return zoneBand(cls, zone.id, rows);
}

// A small caption naming a zone's band; highlights when the zone is selected so
// it's clear the whole band is the tap target.
function zoneCaption(zone) {
  const cap = document.createElement('div');
  cap.className = 'zone-caption';
  if (game.selected.kind === 'zone' && String(game.selected.id) === String(zone.id)) {
    cap.classList.add('selected');
  }
  const status = !zone.discovered ? 'uncharted'
    : zone.status === 'occupied' ? 'occupied'
    : zone.index === 0 ? 'home' : 'owned';
  cap.textContent = `${zone.name} · ${status}`;
  return cap;
}

// The uncharted frontier: a selectable wilderness band at the top of the stack,
// standing in for the next zone to chart. Tapping it (or its terrain tile)
// selects that zone so you can send scouts from the zone behind it.
function unchartedBand(charting) {
  const tiles = [];
  const terrain = entityButton({
    kind: 'zone', type: 'head', id: charting.id, zoneId: charting.id, compact: true,
    icon: 'siteTerrain', label: 'uncharted — send scouts to explore', dimmed: true
  });
  terrain.classList.add('site-big');
  tiles.push(terrain);
  marchTilesTo(charting.id).forEach(t => tiles.push(t));
  return zoneBand('field', charting.id, [zoneCaption(charting), tileRow(`z${charting.id}-wild`, tiles), forecastStrip()]);
}

// War-signs forecast — a vague read on the next raid wave, shown once we've
// pushed beyond home. Non-interactive.
function forecastStrip() {
  const forecast = document.createElement('div');
  forecast.className = 'forecast';
  if (game.frontierAt > 0 && !game.over) {
    forecast.appendChild(makeIcon(ICONS.explore, 'war signs'));
    const eta = game.raid.nextIn <= 15 ? 'imminent'
              : game.raid.nextIn <= 45 ? 'soon'
              : game.raid.nextIn <= 90 ? 'gathering' : 'distant';
    const group = document.createElement('span');
    group.className = 'forecast-group';
    const label = document.createElement('span');
    label.textContent = eta;
    group.appendChild(label);
    const wave = game.raid.wave;
    Object.keys(RAIDER_TYPES).forEach(key => {
      const t = RAIDER_TYPES[key];
      if (wave < t.fromWave) return;
      const size = Math.floor(t.baseSize + (wave - t.fromWave) * t.sizePerWave);
      if (size <= 0) return;
      group.appendChild(makeIcon(ICONS[t.icon], t.label));
      const n = document.createElement('span');
      n.textContent = size <= 2 ? 'few' : size <= 5 ? 'some' : size <= 9 ? 'many' : 'a horde';
      group.appendChild(n);
    });
    forecast.appendChild(group);
  }
  return forecast;
}

function renderWorld() {
  ensureFrontier(game);   // keep an uncharted zone ready to scout
  dom.world.replaceChildren();
  // Deepest zone at the top, home at the bottom (the world grows upward as you
  // explore). The uncharted frontier caps the stack while ground remains.
  const discovered = game.zones.filter(z => z.discovered).sort((a, b) => b.index - a.index);
  const charting = chartingZone(game);
  if (charting) dom.world.appendChild(unchartedBand(charting));
  discovered.forEach(zone => dom.world.appendChild(renderZoneBand(zone)));
}

// A band of the world; rows stack inside it. `cls` sets the tint.
function zoneBand(cls, id, rows) {
  const el = document.createElement('section');
  el.className = `world-zone zone-${cls}`;
  if (game.selected.kind === 'zone' && String(game.selected.id) === String(id)) {
    el.classList.add('zone-selected');
  }
  el.dataset.zoneBand = id;
  rows.forEach(row => el.appendChild(row));
  return el;
}

function productionMeta(state, producer, zoneId) {
  const jobs = trainJobs(state, producer, zoneId);
  if (!jobs.length) return '';
  const queued = jobs.length - 1;
  return queued > 0 ? `${jobs[0].label} ${jobs[0].remaining}s +${queued}` : `${jobs[0].label} ${jobs[0].remaining}s`;
}

function entityInfo(state) {
  const { kind, type } = state.selected;
  if (state.moveArm) return 'Tap a target zone to move there — or tap away to cancel';
  if (state.buildMenu) return `Build in ${selectedZone(state).name}`;
  if (!selectionValid(state)) return '';
  if (kind === 'structure') {
    const b = BUILDINGS[type];
    if (!b) return type;
    return typeof b.blurb === 'function' ? b.blurb(state, selectedZone(state)) : (b.blurb || cap(b.label));
  }
  if (kind === 'workerGroup') {
    return `idle workers ×${workerCount(state, 'idle')}`;
  }
  if (kind === 'node') {
    const node = nodeById(state, state.selected.id);
    if (!node) return type;
    const n = workersAtNode(state, node).length;
    const status = node.remaining <= 0 ? 'depleted' : `${fmtQty(node.remaining)} left`;
    return `${node.label} · ${status} · ${n} working`;
  }
  if (kind === 'zone') {
    const zone = zoneById(state, state.selected.id);
    if (!zone) return '';
    if (!zone.discovered) {
      const src = zoneByIndex(state, zone.index - 1);
      return `uncharted ground · send scouts from ${src ? src.name : 'the frontier'}`;
    }
    if (zone.status === 'occupied') {
      const g = zone.garrison;
      const engaged = !!zone.strike;
      const gar = (g.veiled && !engaged) ? 'garrison unknown'
        : [`${g.guardsLeft} guards`, g.towersLeft > 0 ? `${g.towersLeft} tower${g.towersLeft === 1 ? '' : 's'}` : null]
          .filter(Boolean).join(', ');
      return `${zone.name} · occupied · ${gar} · ${g.rewardText}`;
    }
    const defs = poolCount(zone.army);
    const nodes = zone.nodes.length;
    return `${zone.name} · owned · ${defs} defender${defs === 1 ? '' : 's'} · ${nodes} node${nodes === 1 ? '' : 's'}`;
  }
  if (kind === 'army') {
    const zone = zoneById(state, state.selected.id);
    if (!zone) return type;
    const parts = Object.keys(ARMY).filter(k => zone.army[k] > 0).map(k => `${zone.army[k]} ${ARMY[k].label}`);
    return `${zone.name} · ${parts.length ? parts.join(', ') : 'no units'}`;
  }
  return '';
}

function renderOrders() {
  // Preserve the command strip's scroll across the full rebuild.
  const prevStrip = dom.orders.querySelector('.command-strip');
  const stripScroll = prevStrip ? prevStrip.scrollLeft : 0;
  dom.orders.replaceChildren();

  const info = document.createElement('div');
  info.className = 'command-info';
  info.textContent = entityInfo(game);
  dom.orders.appendChild(info);

  // One non-wrapping, horizontally scrollable row of command buttons.
  const strip = document.createElement('div');
  strip.className = 'command-strip';
  dom.orders.appendChild(strip);

  selectedCommands(game)
    .filter(command => !(command.hidden && command.hidden(game)))
    .forEach((command, index) => {
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
        // Grey out the pieces of the cost you can't currently cover.
        const short = (RESOURCE_KEYS.includes(icon) && game.resources[icon] < n)
                   || (icon === 'supply' && !supplyFree(game));
        const img = document.createElement('img');
        img.className = short ? 'cost-icon cost-short' : 'cost-icon';
        img.src = `${ICONS[icon]}?v=${ICON_VERSION}`;
        img.alt = icon;
        img.draggable = false;
        costEl.appendChild(img);
        const amt = document.createElement('span');
        amt.className = short ? 'cost-amt cost-short' : 'cost-amt';
        amt.textContent = n;
        costEl.appendChild(amt);
      });
      button.appendChild(costEl);
    }

    strip.appendChild(button);
  });
  if (stripScroll) strip.scrollLeft = stripScroll;
}

function renderGameOver() {
  const el = document.getElementById('gameover');
  if (!game.over) {
    el.classList.remove('show');
    return;
  }
  if (!el.classList.contains('show')) {
    el.replaceChildren();
    const title = document.createElement('strong');
    title.textContent = game.over.won ? 'Victory!' : 'Defeat';
    const line = document.createElement('p');
    line.textContent = game.over.won
      ? `The enemy base lies in ruins. Day ${game.over.day}.`
      : `The town hall has fallen. Day ${game.over.day}.`;
    const hint = document.createElement('p');
    hint.className = 'gameover-hint';
    hint.textContent = 'tap to play again';
    el.append(title, line, hint);
    el.classList.add('show');
  }
}

function renderLog() {
  dom.log.replaceChildren();
  game.log.forEach(line => {
    const item = document.createElement('p');
    item.textContent = line;
    dom.log.appendChild(item);
  });
}

// Smooth ring animation between ticks. Three uniform cases cover everything:
// anything bound to a job uid (construction chips AND march-tile badges),
// node harvest badges, and the scouts' explore ring — new jobs, nodes, or
// tiles that reuse these data attributes never need changes here.
function updateProgressRings() {
  document.querySelectorAll('.construction-chip[data-job-uid], .job-badge[data-job-uid]').forEach(el => {
    const job = game.jobs.find(j => j.uid === Number(el.dataset.jobUid));
    if (!job) return;
    el.querySelectorAll('.radial-progress').forEach(c => c.remove());
    el.appendChild(radialProgressCanvas(jobProgress(game, job)));
  });

  document.querySelectorAll('.job-badge[data-node-id]').forEach(badge => {
    const node = nodeById(game, badge.dataset.nodeId);
    const values = node ? nodeProgressBars(game, node) : [];
    badge.querySelectorAll('.radial-progress').forEach(el => el.remove());
    values.forEach((p, i) => badge.appendChild(radialProgressCanvas(p, values.length, i === 0)));
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
  // A tile tap selects the tile; a tap on empty band area selects the zone.
  const button = event.target.closest('.entity');
  const band = button ? null : event.target.closest('[data-zone-band]');
  worldTap = (button || band)
    ? { id: event.pointerId, x: event.clientX, y: event.clientY, button, band } : null;
}, { passive: true });
dom.world.addEventListener('pointerup', event => {
  const tap = worldTap;
  worldTap = null;
  if (!tap || event.pointerId !== tap.id) return;
  if (Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 10) return;
  // An armed move resolves against the tapped target — one worker/unit per tap.
  // Tapping a resource node sends the worker onto that resource; tapping a zone
  // keeps its resource. A valid tap keeps the move armed for more; an invalid
  // one cancels.
  if (game.moveArm) {
    const arm = game.moveArm;
    let destZone = null, destNode = null;
    if (tap.button) {
      const b = tap.button.dataset;
      if (b.kind === 'node') { destNode = nodeById(game, b.id); destZone = destNode ? nodeZone(game, destNode.id) : null; }
      else if (b.zone != null) destZone = zoneById(game, b.zone);
    } else if (tap.band) {
      destZone = zoneById(game, tap.band.dataset.zoneBand);
    }
    const owned = destZone && destZone.discovered && destZone.status === 'owned';
    if (owned && executeMoveOne(game, arm, destZone, destNode)) {
      // stays armed for another one-at-a-time tap
    } else {
      game.moveArm = null;
      writeLog(game, 'Move ended.');
    }
    render();
    return;
  }
  if (!tap.button && tap.band) {
    // Tapped the band background — select the whole zone.
    const z = zoneById(game, tap.band.dataset.zoneBand);
    if (z) selectEntity('zone', 'head', z.id, z.id);
    return;
  }
  if (tap.button.dataset.kind === 'enemy' || tap.button.dataset.kind === 'frontier') return;
  // A marching column's tile recalls it to where it came from.
  if (tap.button.dataset.kind === 'march') {
    cancelJob(game, Number(tap.button.dataset.id));
    render();
    return;
  }
  const zoneId = tap.button.dataset.zone != null ? tap.button.dataset.zone : undefined;
  selectEntity(tap.button.dataset.kind, tap.button.dataset.type, tap.button.dataset.id, zoneId);
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
  const z = selectedZone(game) && selectedZone(game).status === 'owned' ? selectedZone(game) : homeZone(game);
  z.army.footmen += 1;
  flashTile(`army:defend:${z.id}`, 'spawn');
  render();
});
document.getElementById('cheat-worker').addEventListener('click', () => {
  const z = selectedZone(game) && selectedZone(game).status === 'owned' ? selectedZone(game) : homeZone(game);
  const w = createWorker('idle', null, 0, z.id);
  game.workers.push(w);
  autoAssignWorkers(game);
  if (w.nodeId) flashTile(`node:${w.job}:${w.nodeId}`, 'spawn');
  render();
});
document.getElementById('cheat-farm').addEventListener('click', () => {
  const z = selectedZone(game) && selectedZone(game).status === 'owned' ? selectedZone(game) : homeZone(game);
  z.structures.farm += 1;
  flashTile(`structure:farm:${z.id}`, 'spawn');
  render();
});
document.getElementById('cheat-kill').addEventListener('click', () => {
  if (game.raids.length > 0) {
    writeLog(game, 'All attackers struck down.');
    game.raids = [];
  }
  render();
});
document.getElementById('cheat-scout').addEventListener('click', () => {
  // Reveals the next uncharted zone instantly (garrison and all). Empty ground
  // is claimed; a garrison is exposed as a blocker to assault.
  ensureFrontier(game);
  const z = chartingZone(game);
  if (!z) { render(); return; }
  z.discovered = true;
  game.frontierAt = Math.max(game.frontierAt, z.index);
  flashTile(`zone:head:${z.id}`, 'spawn');
  writeLog(game, `Scouts chart ${z.name}.`);
  render();
});

// Cheat buttons are icon-only; icons injected here so they share ICONS'
// cache-busting.
const CHEAT_ICONS = {
  'cheat-btn': 'gold', 'cheat-train': 'build', 'cheat-harvest': 'harvest',
  'cheat-raid': 'enemy', 'cheat-footman': 'footman',
  'cheat-worker': 'worker', 'cheat-farm': 'farm', 'cheat-scout': 'vision',
  'cheat-kill': 'deathcoil'
};
Object.keys(CHEAT_ICONS).forEach(id => {
  const btn = document.getElementById(id);
  btn.appendChild(makeIcon(ICONS[CHEAT_ICONS[id]], btn.title));
});

document.getElementById('gameover').addEventListener('click', () => location.reload());

// ── Boot ───────────────────────────────────────────────────────────────────

function spawnStartingWorkers(remaining) {
  if (remaining <= 0) return;
  game.workers.push(createWorker());
  autoAssignWorkers(game);   // heads to gold immediately
  render();
  if (remaining > 1) setTimeout(() => spawnStartingWorkers(remaining - 1), 1000);
}

render();
// Open on the home front: the world starts scrolled to the base zone at the
// bottom (later renders preserve wherever the player scrolls).
dom.world.scrollTop = dom.world.scrollHeight;
spawnStartingWorkers(4);

setInterval(gameTick, TICK_MS);
setInterval(updateProgressRings, 100);
