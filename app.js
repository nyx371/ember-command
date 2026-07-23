// ── Tunables ───────────────────────────────────────────────────────────────

// Bump VERSION (+0.01) and rewrite VERSION_TAG with every pushed change —
// they render at the top of the menu so a stale cache is immediately visible.
const VERSION = '0.41';
const VERSION_TAG = 'homeland targets are assault cards (no attack order), gated war signs';

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
const RAID_OUTPOST_RELIEF = 25; // raid-interval bonus per razed outpost

// The enemy homeland: a chain of assaultable sites, revealed one at a time —
// the next only after the previous is razed. They fight like conquerable
// sites but far tougher, and `reinforce` musters a fresh guard every N ticks
// (up to cap) while under attack. Their garrison is veiled until you engage.
// Outposts pay off in a permanently slower raid schedule; the stronghold's
// fall wins the game.
const ENEMY_TARGETS = [
  { key: 'outpost1', icon: 'outpost', label: 'orc outpost', veiled: true,
    guards: { count: 6, hp: 80, dmg: 9 }, towers: 1,
    reinforce: { every: 8, cap: 8 },
    rewardText: 'the raids will thin', rewardIcon: 'patrol' },
  { key: 'outpost2', icon: 'outpost', label: 'orc war camp', veiled: true,
    guards: { count: 9, hp: 85, dmg: 9 }, towers: 1,
    reinforce: { every: 7, cap: 12 },
    rewardText: 'the raids will thin', rewardIcon: 'patrol' },
  { key: 'stronghold', icon: 'stronghold', label: 'orc stronghold', veiled: true, final: true,
    guards: { count: 12, hp: 90, dmg: 8 }, towers: 2,
    reinforce: { every: 5, cap: 16 },
    rewardText: 'victory', rewardIcon: 'attack' }
];
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
// Conquerable sites: how long the assault column marches each way (same as
// marching to the far field) and the watch-tower stats their garrisons use.
const SITE_MARCH_TICKS = 6;
const SITE_TOWER = { hp: 100, dmg: 6 };

const WORKER_HP = 30;
const REPAIR_HP_PER_TICK = 20;  // how fast one worker patches a building up
// Regen per tick — only defenders resting between fights heal (never while a
// raid is at the base, never on patrol or in the field), so pulling wounded
// units back to defend has a real benefit.
const HEAL_DEFEND_PER_TICK = 1;
const WORKER_HEAL_PER_TICK = 1;   // very slow, and only while not under attack
// Changing orders takes marching time (ticks): 2 + remoteness of both ends.
// Pulling scouts home mid-raid costs real time — they can't teleport back.
const ORDER_REMOTENESS = { defend: 0, patrol: 1, explore: 4, attack: 4 };
const TRANSFER_BASE_TICKS = 2;
const HP_BAR_LINGER_MS = 3000;  // keep a combat hp bar visible across volleys
// Raider targeting: warriors first, then the towers shooting at them, then
// workers, then the remaining buildings — the town hall falls last.
const RAID_TOWER_TARGETS = ['cannontower', 'guardtower', 'tower'];
const RAID_TARGET_ORDER = ['farm', 'barracks', 'lumbermill', 'blacksmith', 'hall'];

// discoverAt is explore-progress (explorer-ticks); 0 = known from the start.
// Scouts keep exploring after finding the enemy base and reveal these in turn.
const NODE_DEFS = [
  { id: 'gold-1',   type: 'gold',   label: 'gold mine',   icon: 'goldSite',   distance: 1, capacity: 48000, discoverAt: 0 },
  { id: 'forest-1', type: 'lumber', label: 'forest',      icon: 'lumberSite', distance: 1, capacity: 25000, discoverAt: 0 },
  { id: 'forest-2', type: 'lumber', label: 'far forest',  icon: 'lumberSite', distance: 5, capacity: 25000, discoverAt: 0 },
  // The hill mine is deliberately the FIRST thing exploration finds — the
  // opening scout trip pays off with economy, not a fight.
  { id: 'gold-2',   type: 'gold',   label: 'hill mine',   icon: 'goldSite',   distance: 4, capacity: 25000, discoverAt: 80 },
  { id: 'forest-3', type: 'lumber', label: 'deep woods',  icon: 'lumberSite', distance: 6, capacity: 30000, discoverAt: 220 },
  { id: 'gold-3',   type: 'gold',   label: 'mountain mine', icon: 'goldSite', distance: 9, capacity: 40000, discoverAt: 500 },
  // Unlocked by clearing the overrun-mine site, never by scouting alone.
  { id: 'gold-4',   type: 'gold',   label: 'rich gold mine', icon: 'goldSite', distance: 3, capacity: 30000, discoverAt: Infinity }
];

// Conquerable sites — mini-bases in the far field, revealed by exploration
// like distant nodes. Each shows its garrison (guard units + watch towers);
// warriors sent from the defend pool must clear it, then the reward unlocks
// and survivors march home. `reward`: { cache } pays out instantly,
// { nodeId } reveals that NODE_DEFS entry (give it discoverAt: Infinity so
// scouts can't find it first), { units } march home with the survivors.
// All sites share the terrain art (siteTerrain); `rewardIcon` is the
// contextual badge that tells the player what clearing it pays. Garrisons
// listed here are the base — they scale up with the raid-wave counter at the
// moment of discovery (see discoverSite), so late finds are tougher, just
// like attack waves. Each run draws SITE_SLOTS.length sites at random from
// the pool (no repeats) and lays them on the discovery ladder in slot order;
// slots sit AFTER the hill mine (80), so exploration's first find is always
// economy, never a fight.
const SITE_SLOTS = [260, 400, 560, 750, 950, 1200];
const SITE_POOL = [
  { key: 'camp',  icon: 'siteTerrain', rewardIcon: 'gold', label: 'raider camp',
    guards: { count: 3, hp: 60, dmg: 7 }, towers: 1,
    reward: { cache: { gold: 2500, lumber: 1500 } }, rewardText: 'war chest 2500g 1500w' },
  { key: 'warband', icon: 'siteTerrain', rewardIcon: 'gold', label: 'orc warband',
    guards: { count: 4, hp: 70, dmg: 8 }, towers: 0,
    reward: { cache: { gold: 1500, lumber: 800 } }, rewardText: 'plunder 1500g 800w' },
  { key: 'mine',  icon: 'siteTerrain', rewardIcon: 'goldSite', label: 'overrun mine',
    guards: { count: 5, hp: 66, dmg: 8 }, towers: 1,
    reward: { nodeId: 'gold-4' }, rewardText: 'rich gold mine' },
  { key: 'stockade', icon: 'siteTerrain', rewardIcon: 'footman', label: 'prison camp',
    guards: { count: 6, hp: 72, dmg: 9 }, towers: 2,
    reward: { units: { footmen: 3 } }, rewardText: '3 captive footmen' },
  { key: 'loggers', icon: 'siteTerrain', rewardIcon: 'worker', label: 'logging camp',
    guards: { count: 5, hp: 80, dmg: 9 }, towers: 1,
    reward: { workers: 3 }, rewardText: '3 captive peasants' },
  { key: 'pens', icon: 'siteTerrain', rewardIcon: 'worker', label: 'work pens',
    guards: { count: 4, hp: 75, dmg: 9 }, towers: 0,
    reward: { workers: 2, units: { footmen: 1 } }, rewardText: 'captive peasants & footman' },
  { key: 'shrine', icon: 'siteTerrain', rewardIcon: 'gold', label: 'orc shrine',
    guards: { count: 6, hp: 75, dmg: 9 }, towers: 1,
    reward: { cache: { gold: 3000 } }, rewardText: 'looted idol 3000g' },
  { key: 'hoard', icon: 'siteTerrain', rewardIcon: 'gold', label: 'orc hoard',
    guards: { count: 8, hp: 80, dmg: 10 }, towers: 2,
    reward: { cache: { gold: 4000, lumber: 2500 } }, rewardText: 'war hoard 4000g 2500w' },
  { key: 'armory', icon: 'siteTerrain', rewardIcon: 'knight', label: 'slave pens',
    guards: { count: 10, hp: 85, dmg: 10 }, towers: 2,
    reward: { units: { knights: 2, archers: 2 } }, rewardText: 'captive knights & archers' }
];

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
    blurb: s => `${cap(hallTierName(s))} · ${productionMeta(s, 'hall') || 'ready'} · +${Math.round(incomePerTick(s, 'gold'))}g +${Math.round(incomePerTick(s, 'lumber'))}w /s`
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
    blurb: s => `Barracks · ${productionMeta(s, 'barracks') || 'ready'}`
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
  },
  ballista: {
    icon: 'ballista', label: 'ballista', producer: 'barracks', time: 250, cost: { gold: 900, lumber: 300 },
    requires: ['blacksmith'],
    done: s => { s.army.defend.ballistas += 1; flashTile('army:defend:1', 'spawn'); writeLog(s, 'Ballista ready.'); }
  },
  knight: {
    icon: 'knight', label: 'knight', producer: 'stables', time: 90, cost: { gold: 800, lumber: 100 },
    done: s => { s.army.defend.knights += 1; flashTile('army:defend:1', 'spawn'); writeLog(s, 'Knight ready.'); }
  }
};

// Army unit types. `hp`/`dmg` drive raid combat (listed first = soaks damage
// first within a pool); `attack` is siege dps against the enemy base. Units
// live in per-order pools on `game.army` (see ORDERS).
const ARMY = {
  footmen:   { icon: 'footman',  label: 'footmen',   singular: 'footman',  hp: 60,  dmg: 7,  attack: 0.10 },
  knights:   { icon: 'knight',   label: 'knights',   singular: 'knight',   hp: 90,  dmg: 10, attack: 0.15 },
  archers:   { icon: 'archer',   label: 'archers',   singular: 'archer',   hp: 40,  dmg: 5,  attack: 0.06 },
  ballistas: { icon: 'ballista', label: 'ballistas', singular: 'ballista', hp: 110, dmg: 25, attack: 0.50 }
};

// Standing orders an army unit can hold. Units live in one pool per order and
// are moved between pools one at a time (workers-row style). Attacking the
// enemy homeland is not an order — it's a site assault (tap the target card).
const ORDERS = ['defend', 'patrol', 'explore'];

const GUARD_TOWER = { cost: { gold: 500, lumber: 150 }, time: 140 };
const CANNON_TOWER = { cost: { gold: 1000, lumber: 300 }, time: 190 };
// Hall tiers: Town Hall → Keep → Castle. The hall keeps its structure key —
// only game.hallTier changes — so the loss condition, targeting, and worker
// training are untouched. Each tier: tougher hall, a little more supply;
// the Keep gates the Stables, the Castle needs them (WC2 ladder).
const HALL_TIERS = [
  { key: 'keep',   label: 'keep',   icon: 'keep',
    cost: { gold: 2000, lumber: 1000 }, time: 200, hpBonus: 600, supply: 4,
    requires: s => s.structures.barracks > 0, reqLabel: 'Need a barracks' },
  { key: 'castle', label: 'castle', icon: 'castle',
    cost: { gold: 2500, lumber: 1200 }, time: 200, hpBonus: 600, supply: 4,
    requires: s => s.structures.stables > 0, reqLabel: 'Need stables' }
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

function createGame() {
  return {
    tick: 0,
    selected: { kind: 'structure', type: 'hall', id: 1 },
    resources: { gold: 400, lumber: 100, oil: 0 },
    // One unified list of timed jobs: kind ∈ train|construct|upgrade. All share
    // { uid, icon, label, duration, remaining, cost, complete }; train jobs add
    // { producer, supply }, construct jobs add { workerId, returnTo }, upgrade
    // jobs add { tag }.
    jobs: [],
    buildMenu: false,
    workers: [],
    nodes: NODE_DEFS.map(d => ({ ...d, remaining: d.capacity, discovered: d.discoverAt === 0 })),
    tech: Object.fromEntries(Object.keys(TECH).map(k => [k, 0])),
    over: null,   // { won, day } once the game ends
    // One pool per standing order; each holds counts per ARMY type plus a
    // shared wounds pool for raid damage.
    // One veteran footman guards the town from the start.
    army: Object.fromEntries(ORDERS.map(o =>
      [o, { ...Object.fromEntries(Object.keys(ARMY).map(k => [k, o === 'defend' && k === 'footmen' ? 1 : 0])), wounds: 0 }])),
    structures: Object.fromEntries(Object.keys(BUILDINGS).map(k => [k, (k === 'hall' || k === 'farm') ? 1 : 0])),
    hallTier: 0,   // 0 = town hall, 1 = keep
    // Accumulated raid damage on the front instance of each building type —
    // persists after the raid dies, until repaired (or the building falls).
    structureDamage: Object.fromEntries(Object.keys(BUILDINGS).map(k => [k, 0])),
    enemy: {
      known: false,
      // Site-shaped instances so the whole site machinery (assault, combat,
      // conquest) applies unchanged; `discovered` is synced each tick.
      targets: ENEMY_TARGETS.map(t => ({
        ...t, discovered: false, cleared: false,
        guards: { ...t.guards },
        guardsLeft: t.guards.count, guardPool: t.guards.count * t.guards.hp,
        towersLeft: t.towers, towerHp: SITE_TOWER.hp,
        strike: null, march: null, returning: null,
        myStrikeIn: DEFENSE_VOLLEY_EVERY, foeStrikeIn: RAID_VOLLEY_EVERY,
        reinforceIn: 0, lastHitAt: 0, strikeHitAt: 0
      }))
    },
    // Conquerable sites (see SITES): garrison state plus up to three of our
    // columns per site — `march` heading out, `strike` fighting there,
    // `returning` heading home. All count toward supply.
    sites: (() => {
      const pool = [...SITE_POOL];
      return SITE_SLOTS.map(at => {
        const d = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
        return {
          ...d, discoverAt: at, discovered: false, cleared: false,
          guards: { ...d.guards },
          guardsLeft: d.guards.count, guardPool: d.guards.count * d.guards.hp,
          towersLeft: d.towers, towerHp: SITE_TOWER.hp,
          strike: null, march: null, returning: null,
          myStrikeIn: DEFENSE_VOLLEY_EVERY, foeStrikeIn: RAID_VOLLEY_EVERY,
          lastHitAt: 0, strikeHitAt: 0
        };
      });
    })(),
    exploreProgress: 0,
    raid: { nextIn: RAID_FIRST_DELAY, interval: RAID_INTERVAL_BASE, wave: 0 },
    raids: [],            // active raiding parties (see spawnRaid)
    workerWounds: 0,      // damage accumulated toward the next worker death
    log: ['Raiders are coming — one footman won\'t hold them forever.', 'Tap the town hall to build and train.', 'Welcome to Ember Command.'],
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
  return state.nodes.find(n => n.type === type && n.discovered && n.remaining > 0) || null;
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
    .filter(n => n.discovered && n.remaining > 0 && workersAtNode(state, n).length > 0)
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
    const gained = Math.min(harvestYield(state, worker.job), node.remaining);
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

// Repair rides the construct-job machinery: a worker is pulled the same way,
// walks over, patches the accumulated damage off, and returns to its node.
function pendingRepair(state, key) {
  return state.jobs.some(j => j.kind === 'construct' && j.repairKey === key);
}

function startRepair(state, key) {
  const worker = builderWorker(state);
  if (!worker) return;
  const returnTo = worker.nodeId;
  worker.job = 'building';
  worker.nodeId = null;
  worker.cooldown = 0;
  const time = Math.max(1, Math.ceil(state.structureDamage[key] / REPAIR_HP_PER_TICK));
  state.jobs.push({
    uid: nextId(), kind: 'construct', workerId: worker.id, returnTo, repairKey: key,
    icon: 'repair', label: `repair ${BUILDINGS[key].label}`, duration: time, remaining: time,
    cost: {},
    complete: s => {
      s.structureDamage[key] = 0;
      flashTile(`structure:${key}:1`, 'spawn');
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

// One research at a time per source building — a second blacksmith (etc.)
// unlocks a second parallel upgrade slot.
function upgradeSlotFree(state, source) {
  return state.jobs.filter(j => j.kind === 'upgrade' && j.source === source).length
       < state.structures[source];
}

function cancelJob(state, uid) {
  const job = state.jobs.find(j => j.uid === uid);
  if (!job) return;
  state.jobs = state.jobs.filter(j => j !== job);
  refund(state, job.cost);
  if (job.kind === 'construct') releaseBuilder(state, job.workerId, job.returnTo);
  if (job.kind === 'transfer') {
    state.army[job.from][job.type] += job.count;
    writeLog(state, `${job.label}: recalled.`);
    return;
  }
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
    if (job.kind === 'transfer') {
      state.army[job.to][job.type] += job.count;
      flashTile(`army:${job.to}:1`, 'spawn');
      writeLog(state, `${job.count} ${job.count === 1 ? ARMY[job.type].singular : ARMY[job.type].label} arrived at ${job.to}.`);
      return;
    }
    job.complete(state);
  });
}

// ── Stats ──────────────────────────────────────────────────────────────────

function supplyUsed(state) {
  return state.workers.length
       + ORDERS.reduce((sum, o) => sum + poolCount(state.army[o]), 0)
       + state.jobs.filter(j => j.kind === 'transfer').reduce((sum, j) => sum + j.count, 0)
       + state.sites.reduce((sum, s) => sum + siteUnits(s), 0)
       + state.enemy.targets.reduce((sum, t) => sum + siteUnits(t), 0);
}

function hallTierBonus(state, field) {
  return HALL_TIERS.slice(0, state.hallTier).reduce((sum, t) => sum + t[field], 0);
}

function supplyCap(state) {
  return SUPPLY_BASE + Object.keys(BUILDINGS)
    .reduce((sum, k) => sum + (BUILDINGS[k].supply || 0) * state.structures[k], 0)
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

// Rough income estimate per tick for the hall's info line.
function incomePerTick(state, resource) {
  return state.workers.reduce((sum, w) => {
    if (w.job !== resource) return sum;
    const node = nodeById(state, w.nodeId);
    return node ? sum + harvestYield(state, resource) / nodeCooldown(node) : sum;
  }, 0);
}

function harvestYield(state, resource) {
  return resource === 'lumber'
    ? Math.round(HARVEST_YIELD * (1 + state.tech.lumber * LUMBER_YIELD_PER_LEVEL))
    : HARVEST_YIELD;
}

function unitsOnOrder(state, order) {
  return poolCount(state.army[order]);
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
  if (!victim || victim.nodeId !== node.id) return null;
  return {
    segments: count,
    partial: 1 - state.workerWounds / WORKER_HP,
    total: (count * WORKER_HP - state.workerWounds) / (count * WORKER_HP)
  };
}

// Structure tiles: bar whenever the type carries unrepaired damage.
function buildingHp(state, key) {
  const dmg = state.structureDamage[key];
  if (!dmg || dmg <= 0) return null;
  const full = buildingMaxHp(state, key);
  const segments = state.structures[key];
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

// Site garrison bar: one segment per remaining guard or tower, only while
// damaged (or just hit). Guards soak before towers, so the draining segment
// is whichever of the two is currently being chewed.
function siteHp(site) {
  const full = site.guards.count * site.guards.hp + site.towers * SITE_TOWER.hp;
  const left = site.guardPool
    + (site.towersLeft > 0 ? (site.towersLeft - 1) * SITE_TOWER.hp + site.towerHp : 0);
  if (left >= full && !recentlyHit(site.lastHitAt)) return null;
  const segments = site.guardsLeft + site.towersLeft;
  if (segments === 0) return null;
  const partial = site.guardsLeft > 0
    ? (site.guardPool - (site.guardsLeft - 1) * site.guards.hp) / site.guards.hp
    : site.towerHp / SITE_TOWER.hp;
  return { segments, partial, total: left / full };
}

// The strike force's own bar — only the fighting column takes damage.
function strikeHp(site) {
  const col = site.strike;
  if (!col) return null;
  const count = strikeCount(col);
  if (count === 0) return null;
  if (!col.wounds && !recentlyHit(site.strikeHitAt)) return null;
  const type = Object.keys(ARMY).find(k => col[k] > 0);
  const maxHp = Object.keys(ARMY).reduce((sum, k) => sum + (col[k] || 0) * ARMY[k].hp, 0);
  return {
    segments: count,
    partial: 1 - col.wounds / ARMY[type].hp,
    total: (maxHp - col.wounds) / maxHp
  };
}

// Ring on the scouts' wilderness tile: how far the accumulated explore points
// have come from the last discovery milestone toward the next one (enemy
// base, hidden node, or garrisoned site). Null once everything is found.
// Interpolates within the tick — each tick adds one point per explorer — so
// the 100ms animator can spin it fluidly, faster with more scouts.
function exploreRing(state) {
  const all = [
    EXPLORE_THRESHOLD,
    ...state.nodes.filter(n => Number.isFinite(n.discoverAt)).map(n => n.discoverAt),
    ...state.sites.map(s => s.discoverAt)
  ];
  const ahead = all.filter(t => t > state.exploreProgress);
  if (!ahead.length) return null;
  const next = Math.min(...ahead);
  const prev = Math.max(0, ...all.filter(t => t <= state.exploreProgress));
  const p = state.exploreProgress + tickFraction(poolCount(state.army.explore));
  return Math.min(1, (p - prev) / (next - prev));
}

function enemyTarget(state) {
  return state.enemy.targets.find(t => !t.cleared) || null;
}

// Changing orders is a timed march (a 'transfer' job): units leave the source
// pool immediately, spend the march in transit (not fighting, not targetable),
// and join the target pool on arrival. Tapping the chip recalls them to where
// they came from. Consecutive moves on the same route join the same column.
function transferTicks(from, to) {
  return TRANSFER_BASE_TICKS + ORDER_REMOTENESS[from] + ORDER_REMOTENESS[to];
}

function startTransfer(state, from, to, type, count) {
  const pool = state.army[from];
  const moved = Math.min(count, pool[type]);
  if (moved <= 0) return;
  pool[type] -= moved;
  if (poolCount(pool) === 0) pool.wounds = 0;
  // Joining the scouts is instant — the unit just adds to the explorer pool
  // and progress speeds up. (Coming back from explore still takes a march.)
  if (to === 'explore') {
    state.army.explore[type] += moved;
    flashTile('army:explore:1', 'spawn');
    writeLog(state, `${moved} ${moved === 1 ? ARMY[type].singular : ARMY[type].label} joined the scouts.`);
    return;
  }
  const marching = state.jobs.find(j => j.kind === 'transfer' && j.from === from && j.to === to && j.type === type);
  if (marching) {
    marching.count += moved;   // join the column already under way
  } else {
    const time = transferTicks(from, to);
    // No complete() — advanceJobs delivers transfers itself so late joiners
    // (merged counts) all arrive together.
    state.jobs.push({
      uid: nextId(), kind: 'transfer', from, to, type, count: moved,
      icon: ARMY[type].icon, overlay: orderIcon(to), label: `${ARMY[type].label} → ${to}`,
      duration: time, remaining: time, cost: {}
    });
  }
  writeLog(state, `${moved} ${moved === 1 ? ARMY[type].singular : ARMY[type].label} marching to ${to}.`);
}

function moveUnit(state, from, to, type) {
  startTransfer(state, from, to, type, 1);
}

function moveAllUnits(state, from, to, type) {
  startTransfer(state, from, to, type, state.army[from][type]);
}

// ── Raid combat ────────────────────────────────────────────────────────────
// Raiding parties are real: grunts with hp/damage arrive, exchange volleys
// every VOLLEY_EVERY ticks, and target defenders first, then workers, then
// buildings. Units on attack/explore are away from the base and neither fight
// raiders nor get targeted.

// Damage my side deals per volley. Only defend and patrol pools fight raids —
// scouts and the attack force are away from the base. A raid fights the patrol
// at the perimeter (near zone); only once it breaks through to the base do
// defenders and towers open fire.
function poolDamage(state, pool) {
  return Object.keys(ARMY).reduce((sum, k) => sum + pool[k] * unitDmg(state, k), 0);
}

function defenseDamage(state, raid) {
  if (!raid.atBase) return poolDamage(state, state.army.patrol);
  // Siege parties sit beyond tower range — only warriors can reach them.
  const towerDmg = raid.siege ? 0
    : Object.keys(BUILDINGS).reduce((sum, k) => sum + (BUILDINGS[k].dmg || 0) * state.structures[k], 0);
  return poolDamage(state, state.army.defend) + towerDmg;
}

// Damage flows into the pool's wounds; every full hp's worth kills one unit
// (footmen soak before archers).
function damagePool(state, order, dmg) {
  const pool = state.army[order];
  flashTile(`army:${order}:1`, 'damage');
  pool.lastHitAt = performance.now();
  pool.wounds += dmg;
  let type = Object.keys(ARMY).find(k => pool[k] > 0);
  while (type && pool.wounds >= unitHp(state, type)) {
    pool.wounds -= unitHp(state, type);
    pool[type] -= 1;
    writeLog(state, `A ${ARMY[type].singular} has fallen.`);
    type = Object.keys(ARMY).find(k => pool[k] > 0);
  }
  if (!type) pool.wounds = 0;
}

function damageWorkers(state, dmg) {
  state.workerLastHitAt = performance.now();
  state.workerWounds += dmg;
  // The crew being hit is wherever the next victim works — flash its node red
  // on every strike, not just on a death.
  const target = state.workers.filter(w => w.job !== 'building').pop()
              || state.workers[state.workers.length - 1];
  if (target && target.nodeId) flashTile(`node:${target.job}:${target.nodeId}`, 'damage');
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

// Raiders razing buildings: damage accumulates on the building type
// (persisting until repaired), destroying one instance when it exceeds its
// hp; the raid then picks its next target from the given priority list.
function damageBuildings(state, raid, dmg, order) {
  if (!raid.targetType || !order.includes(raid.targetType) || state.structures[raid.targetType] <= 0) {
    raid.targetType = order.find(k => state.structures[k] > 0) || null;
  }
  if (!raid.targetType) return;   // nothing left standing
  const key = raid.targetType;
  flashTile(`structure:${key}:1`, 'damage');
  state.structureDamage[key] += dmg;
  if (state.structureDamage[key] >= buildingMaxHp(state, key)) {
    state.structures[key] -= 1;
    state.structureDamage[key] = 0;
    writeLog(state, `${cap(BUILDINGS[key].label)} destroyed by raiders!`);
    if (key === 'hall') {
      flashError('The town hall has fallen!');
      state.over = { won: false, day: currentDay(state) + 1 };
    }
    raid.targetType = null;
  }
}

function spawnRaid(state) {
  const wave = state.raid.wave;
  state.raid.wave += 1;
  let total = 0;
  let party = 0;
  Object.keys(RAIDER_TYPES).forEach(key => {
    const t = RAIDER_TYPES[key];
    if (wave < t.fromWave) return;
    const size = Math.floor(t.baseSize + (wave - t.fromWave) * t.sizePerWave);
    if (size <= 0) return;
    const grunt = { hp: t.hp + wave * t.hpPerWave, dmg: t.dmg + wave * t.dmgPerWave };
    // Each party's first strike is offset by its index, so simultaneous
    // parties volley on staggered ticks rather than all at once.
    const foeDelay = RAID_VOLLEY_EVERY + party;
    state.raids.push({
      id: nextId(), kind: key, icon: t.icon, label: t.label, siege: !!t.siege,
      size, grunt, hpPool: size * grunt.hp, discovered: false,
      arriveIn: RAID_ARRIVE_TICKS, atBase: false,
      myStrikeIn: DEFENSE_VOLLEY_EVERY, foeStrikeIn: foeDelay, foeDelay,
      targetType: null
    });
    total += size;
    party += 1;
  });
  // A standing patrol spots the wave the moment it sets out; otherwise it
  // approaches unseen until a patrol picks it up (or it arrives).
  if (unitsOnOrder(state, 'patrol') > 0) {
    state.raids.forEach(r => {
      if (!r.discovered && r.arriveIn >= RAID_ARRIVE_TICKS) r.discovered = true;
    });
    writeLog(state, `Patrol spotted ${total} raiders approaching!`);
    flashError('Patrol spotted enemies approaching!');
  }
}

function raidTick(state) {
  state.raids.forEach(raid => {
    if (raid.arriveIn > 0) {
      // A standing patrol scouts the approach — without one, raiders appear
      // out of nowhere when they reach the perimeter.
      if (!raid.discovered && unitsOnOrder(state, 'patrol') > 0) {
        raid.discovered = true;
        writeLog(state, `Patrol spotted ${raid.size} ${raid.label} approaching!`);
        flashError('Patrol spotted enemies approaching!');
      }
      raid.arriveIn -= 1;
      if (raid.arriveIn <= 0) {
        raid.discovered = true;
        if (unitsOnOrder(state, 'patrol') > 0) {
          writeLog(state, `${raid.size} ${raid.label} clash with our patrol!`);
          flashError('Our patrol engages the raiders!');
        }
      }
    }
    // A raid is held at the perimeter as long as the patrol stands; only once
    // the patrol is defeated (or was never there) does it advance on the town.
    if (raid.arriveIn <= 0 && !raid.atBase && unitsOnOrder(state, 'patrol') === 0) {
      raid.atBase = true;
      writeLog(state, `${raid.size} ${raid.label} attack the town!`);
      flashError('Our town is under attack!');
    }
    const arrived = raid.arriveIn <= 0;
    // My side volleys on its own cadence: the patrol fires while the raid is
    // out in the field, defenders + towers once it reaches the base. Damage
    // splits across the parties fighting in the same place.
    raid.myStrikeIn -= 1;
    if (raid.myStrikeIn <= 0) {
      raid.myStrikeIn = DEFENSE_VOLLEY_EVERY;
      const peers = state.raids.filter(r => !!r.atBase === !!raid.atBase).length;
      const dealt = defenseDamage(state, raid) / peers;
      if (dealt > 0) {
        flashTile(`enemy:raid:${raid.id}`, 'damage');
        flashTile(raid.atBase ? 'army:defend:1' : 'army:patrol:1', 'attack');
        // Firing towers rattle too.
        if (raid.atBase) {
          RAID_TOWER_TARGETS.forEach(k => {
            if (state.structures[k] > 0) flashTile(`structure:${k}:1`, 'attack');
          });
        }
        raid.lastHitAt = performance.now();
      }
      const sizeBefore = raid.size;
      raid.hpPool -= dealt;
      raid.size = Math.max(0, Math.ceil(raid.hpPool / raid.grunt.hp));
      // Every raider killed drops plunder — defending pays.
      const kills = sizeBefore - raid.size;
      if (kills > 0) {
        const loot = kills * RAIDER_TYPES[raid.kind].bounty;
        raid.plunder = (raid.plunder || 0) + loot;
        state.resources.gold += loot;
      }
      if (raid.size <= 0) {
        writeLog(state, `Raid repelled! Plundered ${raid.plunder || 0} gold.`);
        return;
      }
    }

    // Raiders strike back on a slower, offset cadence, and only once arrived:
    // the patrol while held at the perimeter, then defenders at the base;
    // scouts and the attack force are away and untouchable. Out of warriors
    // -> towers, workers, buildings.
    if (!arrived) {
      // Hold each party at its own staggered phase until it arrives, so the
      // first volleys land on different ticks.
      raid.foeStrikeIn = raid.foeDelay || RAID_VOLLEY_EVERY;
      return;
    }
    raid.foeStrikeIn -= 1;
    if (raid.foeStrikeIn > 0) return;
    raid.foeStrikeIn = RAID_VOLLEY_EVERY;
    const dmg = raid.size * raid.grunt.dmg;
    flashTile(`enemy:raid:${raid.id}`, 'attack');
    if (!raid.atBase) {
      damagePool(state, 'patrol', dmg);
      return;
    }
    const towersStanding = RAID_TOWER_TARGETS.some(k => state.structures[k] > 0);
    // Catapults shell buildings and nothing else — towers first (they
    // outrange them), then the rest. Warriors are simply ignored.
    if (raid.siege) {
      if (!raid.razing) {
        raid.razing = true;
        flashError('Catapults are shelling the town!');
      }
      damageBuildings(state, raid, dmg, towersStanding ? RAID_TOWER_TARGETS : RAID_TARGET_ORDER);
      return;
    }
    if (unitsOnOrder(state, 'defend') > 0) damagePool(state, 'defend', dmg);
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

// ── Conquerable sites ──────────────────────────────────────────────────────
// Mini-bases in the far field. Warriors sent from the defend pool march out
// (SITE_MARCH_TICKS each way), exchange volleys with the garrison on the raid
// cadences — guards soak first, then the watch towers are razed — and the
// survivors march home automatically once the site is cleared, bringing the
// reward with them. A wiped strike leaves the garrison's damage standing, so
// a second expedition finishes the job.

function siteByKey(state, key) {
  return state.sites.find(s => s.key === key)
      || state.enemy.targets.find(t => t.key === key);
}

// Sites toughen the later they're found: at the moment of discovery the
// garrison scales with the raid-wave counter, mirroring how attack waves
// ramp (more guards, harder guards).
function discoverSite(state, site) {
  const wave = state.raid.wave;
  site.guards = {
    count: site.guards.count + Math.floor(wave / 2),
    hp: site.guards.hp + wave * 4,
    dmg: site.guards.dmg + wave * 0.5
  };
  site.guardsLeft = site.guards.count;
  site.guardPool = site.guards.count * site.guards.hp;
  site.discovered = true;
  flashTile(`site:${site.key}:1`, 'spawn');
}

function strikeCount(col) {
  return col ? Object.keys(ARMY).reduce((n, k) => n + (col[k] || 0), 0) : 0;
}

function siteUnits(site) {
  return strikeCount(site.strike) + strikeCount(site.march) + strikeCount(site.returning);
}

function sendToSite(state, site, type, count) {
  const moved = Math.min(count, state.army.defend[type]);
  if (moved <= 0) return;
  state.army.defend[type] -= moved;
  if (poolCount(state.army.defend) === 0) state.army.defend.wounds = 0;
  if (site.march) site.march[type] = (site.march[type] || 0) + moved;   // join the column under way
  else site.march = { [type]: moved, arriveIn: SITE_MARCH_TICKS };
  writeLog(state, `${moved} ${moved === 1 ? ARMY[type].singular : ARMY[type].label} marching on the ${site.label}.`);
}

function damageStrike(state, site, dmg) {
  const strike = site.strike;
  strike.wounds = (strike.wounds || 0) + dmg;
  site.strikeHitAt = performance.now();
  flashTile(`site:${site.key}:1`, 'damage');
  let type = Object.keys(ARMY).find(k => strike[k] > 0);
  while (type && strike.wounds >= unitHp(state, type)) {
    strike.wounds -= unitHp(state, type);
    strike[type] -= 1;
    writeLog(state, `A ${ARMY[type].singular} has fallen at the ${site.label}.`);
    type = Object.keys(ARMY).find(k => strike[k] > 0);
  }
  if (!type) {
    site.strike = null;
    writeLog(state, `Our assault on the ${site.label} was wiped out!`);
    flashError(`Our warriors fell at the ${site.label}!`);
  }
}

function conquerSite(state, site) {
  site.cleared = true;
  writeLog(state, `${cap(site.label)} cleared!`);
  flashError(`${cap(site.label)} cleared — ${site.rewardText}!`);
  const survivors = site.strike;
  site.strike = null;
  // Homeland targets: outposts thin the raids (see the interval calc), the
  // stronghold's fall ends the game.
  if (site.final) {
    writeLog(state, 'The orc stronghold lies in ruins! Victory!');
    state.over = { won: true, day: currentDay(state) + 1 };
  } else if (site.veiled) {
    writeLog(state, `${cap(site.label)} razed — the raids will thin out.`);
  }
  const r = site.reward || {};
  if (r.cache) {
    refund(state, r.cache);
    writeLog(state, `Plundered: ${Object.keys(r.cache).map(k => `${r.cache[k]} ${k}`).join(', ')}.`);
  }
  if (r.nodeId) {
    const node = nodeById(state, r.nodeId);
    if (node) {
      node.discovered = true;
      flashTile(`node:${node.type}:${node.id}`, 'spawn');
      writeLog(state, `The ${node.label} is ours — send workers.`);
    }
  }
  if (r.workers) {
    for (let i = 0; i < r.workers; i += 1) state.workers.push(createWorker());
    autoAssignWorkers(state);
    writeLog(state, `${r.workers} rescued peasants head straight to work.`);
  }
  const freed = r.units || {};
  if (r.units) {
    writeLog(state, `${Object.values(r.units).reduce((a, b) => a + b, 0)} freed units join the survivors.`);
  }
  // Scouts that stormed the place are already out here — they pocket the
  // loot and go straight back to exploring, no march home, no cooldown.
  // Commanded assaults from the defend pool march home as before.
  if (site.strikeFrom === 'explore') {
    Object.keys(ARMY).forEach(k => {
      state.army.explore[k] += (survivors[k] || 0) + (freed[k] || 0);
    });
    state.army.explore.wounds += survivors.wounds || 0;
    flashTile('army:explore:1', 'spawn');
    writeLog(state, 'The scouts resume exploring.');
    return;
  }
  const back = site.returning || { wounds: 0 };
  back.returnIn = SITE_MARCH_TICKS;
  Object.keys(ARMY).forEach(k => { back[k] = (back[k] || 0) + (survivors[k] || 0) + (freed[k] || 0); });
  back.wounds = (back.wounds || 0) + (survivors.wounds || 0);
  site.returning = back;
}

function siteTick(state) {
  [...state.sites, ...state.enemy.targets].forEach(site => {
    // Homeland targets muster reinforcements while under attack — a fresh
    // guard every `reinforce.every` ticks, up to the cap.
    if (site.reinforce && site.strike && !site.cleared) {
      site.reinforceIn -= 1;
      if (site.reinforceIn <= 0) {
        site.reinforceIn = site.reinforce.every;
        if (site.guardsLeft < site.reinforce.cap) {
          site.guardsLeft += 1;
          site.guardPool += site.guards.hp;
          flashTile(`site:${site.key}:1`, 'spawn');
          writeLog(state, `Reinforcements muster at the ${site.label}.`);
        }
      }
    }
    if (site.march) {
      site.march.arriveIn -= 1;
      if (site.march.arriveIn <= 0) {
        const strike = site.strike || { wounds: 0 };
        Object.keys(ARMY).forEach(k => { strike[k] = (strike[k] || 0) + (site.march[k] || 0); });
        site.strike = strike;
        site.strikeFrom = 'defend';   // commanded assaults march home afterwards
        site.march = null;
        writeLog(state, `Our warriors storm the ${site.label}!`);
      }
    }
    if (site.returning) {
      site.returning.returnIn -= 1;
      if (site.returning.returnIn <= 0) {
        Object.keys(ARMY).forEach(k => { state.army.defend[k] += site.returning[k] || 0; });
        state.army.defend.wounds += site.returning.wounds || 0;
        flashTile('army:defend:1', 'spawn');
        writeLog(state, `The expedition from the ${site.label} has returned.`);
        site.returning = null;
      }
    }
    if (!site.strike || site.cleared) return;
    // Our volley: guards soak everything first, then towers fall one by one.
    site.myStrikeIn -= 1;
    if (site.myStrikeIn <= 0) {
      site.myStrikeIn = DEFENSE_VOLLEY_EVERY;
      let dealt = Object.keys(ARMY).reduce((sum, k) => sum + (site.strike[k] || 0) * unitDmg(state, k), 0);
      if (dealt > 0) {
        flashTile(`site:${site.key}:1`, 'damage');
        site.lastHitAt = performance.now();
      }
      if (site.guardsLeft > 0) {
        site.guardPool = Math.max(0, site.guardPool - dealt);
        site.guardsLeft = Math.ceil(site.guardPool / site.guards.hp);
      } else {
        while (dealt > 0 && site.towersLeft > 0) {
          const hit = Math.min(dealt, site.towerHp);
          site.towerHp -= hit;
          dealt -= hit;
          if (site.towerHp <= 0) {
            site.towersLeft -= 1;
            site.towerHp = SITE_TOWER.hp;
            writeLog(state, `Watch tower at the ${site.label} destroyed.`);
          }
        }
      }
      if (site.guardsLeft <= 0 && site.towersLeft <= 0) {
        conquerSite(state, site);
        return;
      }
    }
    // The garrison strikes back on the raiders' cadence.
    site.foeStrikeIn -= 1;
    if (site.foeStrikeIn > 0) return;
    site.foeStrikeIn = RAID_VOLLEY_EVERY;
    const dmg = site.guardsLeft * site.guards.dmg + site.towersLeft * SITE_TOWER.dmg;
    if (dmg > 0) {
      flashTile(`site:${site.key}:1`, 'attack');
      damageStrike(state, site, dmg);
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

  // Survivors patch up between fights — defenders only, and never while a
  // raid is inside the base fighting them. Workers mend very slowly, and not
  // at all while the town is under attack.
  if (!game.raids.some(r => r.atBase)) {
    game.army.defend.wounds = Math.max(0, game.army.defend.wounds - HEAL_DEFEND_PER_TICK);
    game.workerWounds = Math.max(0, game.workerWounds - WORKER_HEAL_PER_TICK);
  }

  // Exploration — accumulates per exploring unit. Finds the enemy base first,
  // then keeps revealing distant resource nodes at their discoverAt thresholds.
  const explorers = unitsOnOrder(game, 'explore');
  if (explorers > 0) {
    game.exploreProgress += explorers;
    if (!game.enemy.known && game.exploreProgress >= EXPLORE_THRESHOLD) {
      game.enemy.known = true;
      writeLog(game, 'Enemy homeland located! Attack order unlocked.');
    }
    game.nodes.forEach(n => {
      if (!n.discovered && game.exploreProgress >= n.discoverAt) {
        n.discovered = true;
        flashTile(`node:${n.type}:${n.id}`, 'spawn');
        writeLog(game, `Scouts discovered a ${n.label}!`);
      }
    });
    game.sites.forEach(site => {
      if (!site.discovered && game.exploreProgress >= site.discoverAt) {
        discoverSite(game, site);
        // The scouts that found a garrisoned site storm it on the spot: the
        // whole explore pool becomes the strike force (survivors march home
        // to defend after the fight, like any assault). Exploration pauses
        // until fresh scouts are sent.
        flashError('Enemy camp discovered!');
        const scouts = game.army.explore;
        if (!site.cleared && poolCount(scouts) > 0) {
          const strike = site.strike || { wounds: 0 };
          Object.keys(ARMY).forEach(k => { strike[k] = (strike[k] || 0) + scouts[k]; scouts[k] = 0; });
          strike.wounds = (strike.wounds || 0) + scouts.wounds;
          scouts.wounds = 0;
          site.strike = strike;
          site.strikeFrom = 'explore';   // victors resume exploring on the spot
          writeLog(game, `Scouts found a ${site.label} — and storm it!`);
        } else {
          writeLog(game, `Scouts found a ${site.label} — ${site.guards.count} grunts and ${site.towers} watch tower${site.towers === 1 ? '' : 's'} guard it.`);
        }
      }
    });
  }

  // Homeland visibility: targets reveal one at a time once the enemy is
  // found — the next only after the previous falls. Their combat runs
  // through siteTick like any other site.
  game.enemy.targets.reduce((open, t) => {
    t.discovered = game.enemy.known && open;
    return open && t.cleared;
  }, true);

  // Raids — spawn on a shrinking interval, then fight tick by tick. Every
  // razed outpost permanently stretches the interval back out.
  game.raid.nextIn -= 1;
  if (game.raid.nextIn <= 0) {
    spawnRaid(game);
    const relief = game.enemy.targets.filter(t => t.cleared && !t.final).length * RAID_OUTPOST_RELIEF;
    game.raid.interval = Math.max(RAID_INTERVAL_MIN, RAID_INTERVAL_BASE - currentDay(game) * RAID_INTERVAL_SCALE) + relief;
    game.raid.nextIn = game.raid.interval;
  }
  raidTick(game);
  siteTick(game);

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

// One command per tech track, attached to its source building. Shows the next
// tier's icon/cost; fades out when maxed or already researching.
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
      startUpgrade(s, {
        tag: key, source: t.source, icon: t.icons[tier], label: `${t.label} ${tier + 1}`,
        time: t.times[tier], cost: t.costs[tier],
        complete: st => {
          st.tech[key] += 1;
          flashTile(`structure:${t.source}:1`, 'spawn');
          writeLog(st, `${cap(t.label)} upgraded to tier ${st.tech[key]}.`);
        }
      });
    }
  };
}

// Both tower upgrades draw from the same pool of plain towers, so each
// counts the other's in-flight upgrades when checking for a free one.
function towersFree(s) {
  return s.structures.tower > pendingUpgrades(s, 'guardtower') + pendingUpgrades(s, 'cannontower');
}

function towerUpgradeCommand(key, spec, requires, reqLabel) {
  const b = BUILDINGS[key];
  const { available, reason } = gated([
    [s => s.structures[requires] > 0, reqLabel],
    [towersFree, 'No tower free to upgrade']
  ]);
  return {
    id: `upgrade-${key}`, icon: key, label: `upgrade to ${b.label}`,
    cost: costIcons(spec.cost),
    available, reason,
    enabled: s => available(s) && canAfford(s, spec.cost),
    run: s => startUpgrade(s, {
      tag: key, source: 'tower', icon: key, label: b.label,
      time: spec.time, cost: spec.cost,
      complete: st => {
        st.structures.tower -= 1;
        st.structures[key] += 1;
        flashTile(`structure:${key}:1`, 'spawn');
        writeLog(st, `${cap(b.label)} ready.`);
      }
    })
  };
}

function guardTowerCommand() {
  return towerUpgradeCommand('guardtower', GUARD_TOWER, 'lumbermill', 'Need a lumber mill');
}

// One command per hall tier — each shows only while it's the next step up.
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
        flashTile('structure:hall:1', 'spawn');
        writeLog(st, `Our hall now stands as a ${t.label}.`);
      }
    })
  };
}

function cannonTowerCommand() {
  return towerUpgradeCommand('cannontower', CANNON_TOWER, 'blacksmith', 'Need a blacksmith');
}

// Commands for a selected order group: one button per (unit type present ×
// other order) — the unit's icon with the target order overlaid in the
// corner. Tap moves one of that type, hold moves all of them. Only types
// actually in the group produce buttons, so the card stays small.
function armyGroupCommands(state, order, onlyType) {
  const pool = state.army[order];
  const commands = [];
  Object.keys(ARMY).forEach(type => {
    if (pool[type] <= 0) return;
    if (onlyType && type !== onlyType) return;
    ORDERS.filter(o => o !== order).forEach(o => {
      commands.push({
        id: `move-${order}-${type}-${o}`,
        icon: ARMY[type].icon, overlay: orderIcon(o),
        label: `send ${ARMY[type].singular} to ${o}`, cost: '',
        enabled: s => s.army[order][type] > 0,
        reason: () => 'None left in this group',
        run: s => moveUnit(s, order, o, type),
        runAll: s => moveAllUnits(s, order, o, type)
      });
    });
  });
  return commands;
}

// Commands for a selected site: one assault button per army type (pulled from
// the defend pool — tap sends one, hold sends all of that type). No recall —
// an assault is a commitment; the column comes home when the fight is done.
// Mirrors armyGroupCommands' shape.
function siteCommands(state, site) {
  return Object.keys(ARMY).map(type => ({
    id: `assault-${site.key}-${type}`,
    icon: ARMY[type].icon, overlay: 'attack',
    label: `send ${ARMY[type].singular} to assault`, cost: '',
    hidden: () => site.cleared,
    enabled: s => !site.cleared && s.army.defend[type] > 0,
    reason: s => site.cleared ? 'Already cleared'
               : `No ${ARMY[type].label} resting on defend`,
    run: s => sendToSite(s, site, type, 1),
    runAll: s => sendToSite(s, site, type, s.army.defend[type])
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
    }, ...HALL_TIERS.map((t, i) => hallTierCommand(i)));
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
        hidden: s => !(s.structureDamage[key] > 0) || pendingRepair(s, key),
        enabled: s => s.structureDamage[key] > 0 && !pendingRepair(s, key) && builderWorker(s) != null,
        reason: () => 'No worker available',
        run: s => startRepair(s, key)
      });
    });
    return byStructure;
  })(),
  workerGroup: []
};

function buildMenuCommands() {
  return [
    // Back/cancel leads the list so it's always the first, findable button.
    { id: 'build-menu-stop', icon: 'stop', label: 'back', cost: '',
      enabled: () => true,
      run: s => { s.buildMenu = false; } },
    ...Object.keys(BUILDINGS).filter(key => BUILDINGS[key].build).map(key => {
      const b = BUILDINGS[key];
      const { available, reason } = gated([
        ...(b.build.requires || []).map(req => [s => s.structures[req] > 0, `Need a ${BUILDINGS[req].label}`]),
        ...(b.build.requiresTier
          ? [[s => s.hallTier >= b.build.requiresTier, `Need a ${HALL_TIERS[b.build.requiresTier - 1].label}`]]
          : []),
        [s => builderWorker(s) != null, 'No worker available']
      ]);
      return {
        id: `build-${key}`, icon: b.icon, label: `build ${b.label}`, cost: costIcons(b.build.cost),
        available, reason,
        enabled: s => available(s) && canAfford(s, b.build.cost),
        run: s => startConstruction(s, key)
      };
    }),
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
  if (!selectionValid(state)) return [];   // stale selection -> empty card
  if (state.selected.kind === 'structure') return COMMANDS.structure[state.selected.type] || [];
  if (state.selected.kind === 'workerGroup') return COMMANDS.workerGroup;
  if (state.selected.kind === 'node') {
    const node = nodeById(state, state.selected.id);
    return node ? nodeCommands(state, node) : [];
  }
  if (state.selected.kind === 'army') {
    // A per-type tile (defend) scopes the card to that type's moves.
    const only = ARMY[state.selected.id] ? state.selected.id : null;
    return armyGroupCommands(state, state.selected.type, only);
  }
  if (state.selected.kind === 'site') {
    const site = siteByKey(state, state.selected.type);
    return site ? siteCommands(state, site) : [];
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

function selectEntity(kind, type, id) {
  game.selected = { kind, type, id };
  game.buildMenu = false;
  render();
}

// Selection is left alone even when its target disappears (depleted node,
// structure consumed by an upgrade, emptied army group) — a stale selection
// simply shows an empty command bar until the player taps something else.
const SELECTION_VALID = {
  structure: (s, sel) => sel.type === 'hall' || s.structures[sel.type] > 0,
  node: (s, sel) => { const n = nodeById(s, sel.id); return !!n && n.remaining > 0; },
  army: (s, sel) => {
    if (!ORDERS.includes(sel.type)) return false;
    if (ARMY[sel.id]) return s.army[sel.type][sel.id] > 0;   // per-type tile
    return unitsOnOrder(s, sel.type) > 0 || s.jobs.some(j => j.kind === 'transfer' && j.to === sel.type);
  },
  workerGroup: () => true,
  enemy: () => true,
  // A cleared site stays selectable while our columns are still out there.
  site: (s, sel) => {
    const site = siteByKey(s, sel.type);
    return !!site && site.discovered && (!site.cleared || siteUnits(site) > 0);
  }
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
  const cd = nodeCooldown(node);
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

function entityButton({ kind, type, id, icon, label, count, meta, danger, compact, jobIcon, badgeBlink, progressBars, nodeId, jobUid, exploreBadge, countLabel, countIcon, hp, dimmed }) {
  const button = document.createElement('button');
  const classes = ['entity'];
  if (danger)  classes.push('danger');
  if (compact) classes.push('compact');
  if (dimmed)  classes.push('dimmed');
  const flash = tileFlash(`${kind}:${type}:${id}`);
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
  if (game.selected.kind === kind && game.selected.type === type && String(game.selected.id) === String(id)) {
    button.classList.add('selected');
  }
  button.dataset.kind = kind;
  button.dataset.type = type;
  button.dataset.id = id;
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

function renderWorld() {
  dom.world.replaceChildren();

  const structures = document.createElement('section');
  structures.className = 'world-group structures';

  // Building tiles scroll horizontally instead of wrapping (like the nodes row).
  const structTiles = document.createElement('div');
  structTiles.className = 'tile-row';
  structTiles.dataset.scroll = 'structures';
  structTiles.appendChild(entityButton({
    kind: 'structure', type: 'hall', id: 1, compact: true,
    icon: hallTierIcon(game), label: hallTierName(game),
    hp: buildingHp(game, 'hall')
  }));
  Object.keys(BUILDINGS).forEach(key => {
    if (key === 'hall' || game.structures[key] <= 0) return;
    structTiles.appendChild(entityButton({
      kind: 'structure', type: key, id: 1, compact: true,
      icon: BUILDINGS[key].icon, label: BUILDINGS[key].label,
      countLabel: game.structures[key],
      hp: buildingHp(game, key)
    }));
  });
  structures.appendChild(structTiles);

  // A horizontally scrollable row (see .world-group.workers) of the live
  // resource nodes — each shows its worker count and a harvest ring per worker;
  // the amount remaining is in the command card. Depleted nodes are hidden. The
  // idle-workers tile only appears when there's nothing left to harvest.
  const workers = document.createElement('section');
  workers.className = 'world-group workers';
  workers.dataset.scroll = 'workers';

  const liveNodes = game.nodes.filter(n => n.discovered && n.remaining > 0);

  if (liveNodes.length === 0) {
    const idleCount = workerCount(game, 'idle');
    workers.appendChild(entityButton({
      kind: 'workerGroup', type: 'idle', id: 1,
      icon: 'worker', label: 'idle workers', compact: true,
      countLabel: idleCount > 0 ? idleCount : null, dimmed: idleCount === 0
    }));
  }

  liveNodes.forEach(node => {
    const crew = workersAtNode(game, node).length;
    workers.appendChild(entityButton({
      kind: 'node', type: node.type, id: node.id,
      icon: node.icon, label: `${node.label} (dist ${node.distance})`, compact: true,
      progressBars: nodeProgressBars(game, node), nodeId: node.id,
      countLabel: crew > 0 ? crew : null, countIcon: crew > 0 ? 'worker' : null,
      hp: nodeHp(game, node)
    }));
  });

  // My army: one tile per standing order, workers-row style — tap to select,
  // then move units between orders one per tap. Each order gets its own
  // always-present row (see armySection) so the layout never reflows as
  // pools empty and refill.
  // Defenders spread out into one tile per unit type (all selecting the same
  // defend group — its command card is per-type anyway); other orders stay as
  // one grouped tile with the dominant type's icon. The shared wounds bar
  // rides on the soaking type (first ARMY key present).
  function armyTiles(order) {
    const pool = game.army[order];
    const n = poolCount(pool);
    if (n === 0) return [];
    const types = Object.keys(ARMY).filter(k => pool[k] > 0);
    if (order === 'defend') {
      // Each type tile is its own selection (id = type key), so tapping the
      // footmen never highlights the archers.
      return types.map((k, i) => entityButton({
        kind: 'army', type: order, id: k, compact: true,
        icon: ARMY[k].icon, label: `${order} ${ARMY[k].label}`,
        jobIcon: orderIcon(order),
        countLabel: pool[k],
        hp: i === 0 ? poolHp(pool) : null
      }));
    }
    const domType = types.reduce((best, k) => (pool[k] > pool[best] ? k : best), types[0]);
    return [entityButton({
      kind: 'army', type: order, id: 1, compact: true,
      icon: ARMY[domType].icon, label: order,
      jobIcon: orderIcon(order),
      countLabel: n,
      hp: poolHp(pool)
    })];
  }

  // A column mid-march renders as its own tile right beside the group it's
  // joining: unit icon, destination-order badge with a progress ring for the
  // switching time, no blinking. Tapping it recalls the column to where it
  // came from.
  function marchTile(job) {
    return entityButton({
      kind: 'march', type: job.to, id: job.uid, compact: true,
      icon: ARMY[job.type].icon, label: `${job.count} marching to ${job.to} — tap to recall`,
      jobIcon: orderIcon(job.to), jobUid: job.uid,
      progressBars: [jobProgress(game, job)],
      countLabel: job.count
    });
  }

  function armySection(cls, orders, scrollKey) {
    const section = document.createElement('section');
    section.className = `world-group ${cls}`;
    const row = document.createElement('div');
    row.className = 'tile-row';
    row.dataset.scroll = scrollKey;
    orders.forEach(order => {
      armyTiles(order).forEach(tile => row.appendChild(tile));
      game.jobs.filter(j => j.kind === 'transfer' && j.to === order)
        .forEach(j => row.appendChild(marchTile(j)));
    });
    section.appendChild(row);
    return section;
  }

  const patrol = armySection('patrol', ['patrol'], 'patrol');
  const defend = armySection('defend', ['defend'], 'defend');

  // Enemy raiders share the near zone with the patrol — they approach through
  // it, fight the patrol there, and only drop into the base zone once the
  // patrol is defeated. Each zone has its own enemy row so a column visibly
  // moves down the map when it breaks through.
  function enemyRow(zoneKey, raids) {
    const enemies = document.createElement('section');
    enemies.className = 'world-group enemies';
    const raidTiles = document.createElement('div');
    raidTiles.className = 'tile-row';
    raidTiles.dataset.scroll = `enemies-${zoneKey}`;
    raids.forEach(raid => {
      raidTiles.appendChild(entityButton({
        kind: 'enemy', type: 'raid', id: raid.id, compact: true,
        icon: raid.icon, label: raid.label, danger: true,
        countLabel: raid.size,
        hp: raidHp(raid)
      }));
    });
    enemies.appendChild(raidTiles);
    return enemies;
  }

  // Conquerable sites out in the far field: one double-size tile per site
  // carrying the whole fight — the garrison as chips down the right edge
  // (grunts, then watch towers), our assault column as a chip bottom-left
  // (blinking while marching or returning), the garrison's red hp bar along
  // the bottom and the strike force's green one just above it.
  const sitesRow = document.createElement('section');
  sitesRow.className = 'world-group sites';
  const siteTiles = document.createElement('div');
  siteTiles.className = 'tile-row';
  siteTiles.dataset.scroll = 'sites';
  function siteChip(icon, n) {
    const chip = document.createElement('span');
    chip.className = 'site-chip';
    chip.appendChild(makeIcon(ICONS[icon], icon));
    const count = document.createElement('span');
    count.textContent = n;
    chip.appendChild(count);
    return chip;
  }
  // Our forces at a site / out exploring: one chip per unit type present,
  // stacked bottom-left, so mixed columns show every type.
  function mineChips(counts, blink) {
    const wrap = document.createElement('span');
    wrap.className = blink ? 'mine-chips badge-blink' : 'mine-chips';
    Object.keys(ARMY).forEach(k => {
      if (counts[k] > 0) wrap.appendChild(siteChip(ARMY[k].icon, counts[k]));
    });
    return wrap;
  }
  // Scouts on Explore live here too: an empty stretch of wilderness they're
  // combing. The vision badge carries a progress ring — how close the
  // accumulated explore points are to the next discovery (units sent to
  // explore join instantly, so more scouts just spin it faster). They storm
  // garrisoned sites themselves on discovery, so this tile empties into a
  // site tile when something turns up. Tapping it selects the explore pool.
  const scoutPool = game.army.explore;
  const scoutsOut = poolCount(scoutPool);
  if (scoutsOut > 0) {
    const ring = exploreRing(game);
    const btn = entityButton({
      kind: 'army', type: 'explore', id: 1, compact: true,
      icon: 'siteTerrain', label: 'exploring',
      jobIcon: 'explore', exploreBadge: true,
      progressBars: ring != null ? [ring] : undefined,
      hp: poolHp(scoutPool)
    });
    btn.classList.add('site-big');
    btn.appendChild(mineChips(scoutPool));
    siteTiles.appendChild(btn);
  }
  // The enemy homeland: once found, the attack force's current target stands
  // at the end of the sites row — a danger tile with its hp bar and our
  // besieging units' chips.
  // One builder for every assaultable place. Homeland targets (`veiled`)
  // render wide-but-flat and keep their garrison hidden until our own
  // troops are marching on or fighting at them.
  function siteTileEl(site, cls) {
    const mine = siteUnits(site);
    const engaged = !!(site.strike || site.march);
    const btn = entityButton({
      kind: 'site', type: site.key, id: 1, compact: true,
      icon: site.icon, label: site.label, danger: !site.cleared,
      hp: (!site.veiled || engaged) ? siteHp(site) : null
    });
    btn.classList.add(cls);
    const reward = document.createElement('span');
    reward.className = 'site-chip reward';
    reward.appendChild(makeIcon(ICONS[site.rewardIcon], site.rewardText));
    btn.appendChild(reward);
    if (!site.veiled || engaged) {
      const foes = document.createElement('span');
      foes.className = 'site-chips';
      if (!site.cleared && site.guardsLeft > 0) foes.appendChild(siteChip('enemy', site.guardsLeft));
      if (!site.cleared && site.towersLeft > 0) foes.appendChild(siteChip('orctower', site.towersLeft));
      if (foes.children.length) btn.appendChild(foes);
    }
    if (mine > 0) {
      const byType = {};
      [site.strike, site.march, site.returning].forEach(col => {
        if (!col) return;
        Object.keys(ARMY).forEach(k => { byType[k] = (byType[k] || 0) + (col[k] || 0); });
      });
      btn.appendChild(mineChips(byType, !!(site.march || site.returning)));
      const shp = strikeHp(site);
      if (shp) btn.appendChild(hpBarEl(shp, 'mine'));
    }
    return btn;
  }

  game.sites.forEach(site => {
    if (!site.discovered) return;
    if (site.cleared && siteUnits(site) === 0) return;
    siteTiles.appendChild(siteTileEl(site, 'site-big'));
  });
  // The homeland's current target: a wide, flat, tap-to-assault card.
  game.enemy.targets.forEach(target => {
    if (!target.discovered || (target.cleared && siteUnits(target) === 0)) return;
    siteTiles.appendChild(siteTileEl(target, 'site-wide'));
  });
  sitesRow.appendChild(siteTiles);

  // War signs: while scouts are out, exploration also brings word of what
  // the enemy is massing — the next wave's composition and countdown, plus
  // the wave after, fainter. Deliberately non-interactive: a strip of small
  // muted icons, no tiles, nothing to tap — it must not read as an attack.
  const forecast = document.createElement('div');
  forecast.className = 'forecast';
  // War signs need seasoned scouts: nothing shows until exploration has
  // already found the enemy homeland.
  if (unitsOnOrder(game, 'explore') > 0 && game.enemy.known && !game.over) {
    forecast.appendChild(makeIcon(ICONS.explore, 'war signs'));
    // Rumours, not intel: a vague sense of when ('imminent'…'distant') and
    // roughly how many of each raider type ('few'…'a horde'). No numbers,
    // and only the next wave — beyond that the scouts hear nothing.
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

  const seen = game.raids.filter(raid => raid.discovered);
  const raidZone = raid => raid.atBase ? 'base' : 'near';

  // Three zones, read top to bottom as distance from home:
  //   far   — beyond the map's edge: where scouts and attack columns go.
  //   near  — the approach: patrols stand here, and raiders cross it and fight
  //           the patrol here until it falls.
  //   base  — home: defenders, workers on their nodes, the buildings, and any
  //           raid that has broken through the patrol.
  // Every zone (and every row inside it) stays mounted when empty so tiles never
  // shift position as pools fill and drain; the whole stack scrolls as one.
  dom.world.append(
    zone('far', [sitesRow, enemyRow('far', seen.filter(r => raidZone(r) === 'far')), forecast]),
    zone('near', [enemyRow('near', seen.filter(r => raidZone(r) === 'near')), patrol]),
    zone('base', [enemyRow('base', seen.filter(r => raidZone(r) === 'base')), defend, workers, structures])
  );
}

// A band of the world (far/near/base); rows stack inside it. The tint tells
// the story — no caption.
function zone(key, rows) {
  const el = document.createElement('section');
  el.className = `world-zone zone-${key}`;
  rows.forEach(row => el.appendChild(row));
  return el;
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
  if (!selectionValid(state)) return '';
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
  if (kind === 'site') {
    const site = siteByKey(state, type);
    if (!site) return '';
    // Homeland garrisons stay veiled until our own troops are on the field.
    const garrison = site.cleared ? 'cleared'
      : (site.veiled && !site.strike && !site.march) ? 'garrison unknown'
      : [`${site.guardsLeft} defenders`,
         site.towersLeft > 0 ? `${site.towersLeft} watch tower${site.towersLeft === 1 ? '' : 's'}` : null]
        .filter(Boolean).join(', ');
    const parts = [`${site.label} · ${garrison} · ${site.rewardText}`];
    if (site.march) parts.push(`${strikeCount(site.march)} marching`);
    if (site.strike) parts.push(`${strikeCount(site.strike)} attacking`);
    if (site.returning) parts.push(`${strikeCount(site.returning)} returning`);
    return parts.join(' · ');
  }
  if (kind === 'army') {
    const pool = state.army[type];
    if (!pool) return type;
    const parts = Object.keys(ARMY).filter(k => pool[k] > 0).map(k => `${pool[k]} ${ARMY[k].label}`);
    const enRoute = state.jobs.filter(j => j.kind === 'transfer' && j.to === type)
      .reduce((sum, j) => sum + j.count, 0);
    let base = `${type} · ${parts.length ? parts.join(', ') : 'no units'}`;
    if (enRoute > 0) base += ` · ${enRoute} en route`;
    return base;
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

  document.querySelectorAll('.job-badge[data-explore-ring]').forEach(badge => {
    const p = exploreRing(game);
    badge.querySelectorAll('.radial-progress').forEach(el => el.remove());
    if (p != null) badge.appendChild(radialProgressCanvas(p));
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
  // A marching column's tile recalls it to where it came from.
  if (tap.button.dataset.kind === 'march') {
    cancelJob(game, Number(tap.button.dataset.id));
    render();
    return;
  }
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
  flashTile('army:defend:1', 'spawn');
  render();
});
document.getElementById('cheat-worker').addEventListener('click', () => {
  const w = createWorker();
  game.workers.push(w);
  autoAssignWorkers(game);
  if (w.nodeId) flashTile(`node:${w.job}:${w.nodeId}`, 'spawn');
  render();
});
document.getElementById('cheat-farm').addEventListener('click', () => {
  game.structures.farm += 1;
  flashTile('structure:farm:1', 'spawn');
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
  // Everything scouting could ever find: enemy base, scoutable nodes, sites.
  // Site-locked rewards (discoverAt: Infinity) still need conquest.
  game.exploreProgress = Math.max(game.exploreProgress, EXPLORE_THRESHOLD,
    ...game.nodes.map(n => n.discoverAt).filter(Number.isFinite),
    ...game.sites.map(s => s.discoverAt));
  if (!game.enemy.known) {
    game.enemy.known = true;
    writeLog(game, 'Enemy homeland located! Attack order unlocked.');
  }
  game.nodes.forEach(n => {
    if (!n.discovered && Number.isFinite(n.discoverAt)) {
      n.discovered = true;
      flashTile(`node:${n.type}:${n.id}`, 'spawn');
    }
  });
  game.sites.forEach(s => {
    if (!s.discovered) discoverSite(game, s);
  });
  writeLog(game, 'The map lies revealed.');
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
