// DOM-stubbed smoke test for app.js (world-zone model, v0.65+).
// Run:  node tools/smoke.js   (from the repo root, or pass a path to app.js)
//
// Stubs just enough DOM for app.js to boot, then drives gameTick/runCommand/
// selectEntity and asserts on `game`. Zones the test relies on are overwritten
// with deterministic contents right after creation, since makeZone rolls
// nodes/garrisons randomly.
const fs = require('fs');
const path = require('path');

function makeEl() {
  const el = {
    children: [], dataset: {}, style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, addEventListener() {},
    appendChild(c) { this.children.push(c); return c; },
    append(...cs) { this.children.push(...cs); },
    replaceChildren() { this.children = []; },
    querySelectorAll: () => [], querySelector: () => null, closest: () => null,
    getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    scrollIntoView() {},
    getContext: () => new Proxy({}, { get: (t, k) => (k === 'createConicGradient')
      ? () => ({ addColorStop() {} })
      : (typeof t[k] !== 'undefined' ? t[k] : () => {}) }),
    click() {},
    set textContent(v) {}, get textContent() { return ''; },
    set className(v) { this._cn = v; }, get className() { return this._cn || ''; },
    set title(v) {}, set src(v) {}, set alt(v) {}, set draggable(v) {}, set decoding(v) {},
    set disabled(v) {}, set hidden(v) {}, set open(v) {}, get open() { return false; },
    contains: () => false
  };
  return el;
}

global.document = {
  createElement: () => makeEl(),
  querySelector: () => makeEl(),
  querySelectorAll: () => [],
  getElementById: () => makeEl(),
  addEventListener() {}
};
global.window = { devicePixelRatio: 1 };
global.performance = { now: () => Date.now() };
const timeouts = [];
global.setTimeout = fn => { timeouts.push(fn); return 0; };
global.setInterval = () => 0;
global.clearTimeout = () => {};

const appPath = process.argv[2] || path.join(__dirname, '..', 'app.js');
const src = fs.readFileSync(appPath, 'utf8');
const exports_ = ['game', 'gameTick', 'runCommand', 'selectEntity', 'selectedCommands',
  'cancelJob', 'supplyCap', 'supplyUsed', 'zoneById', 'zoneByIndex', 'makeZone',
  'makeGarrison', 'GARRISON_POOL', 'STRONGHOLD', 'exploreFrom', 'startTransfer',
  'executeMoveOne', 'spawnRaid', 'poolCount'];
eval(src + '\n;globalThis.__X = {' + exports_.join(',') + '};');
const X = globalThis.__X;

const assert = (cond, msg) => {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
  else console.log('ok:', msg);
};
const workersOf = zone => X.game.workers.filter(w => String(w.zoneId) === String(zone.id));

// ── Boot ──────────────────────────────────────────────────────────────────
const home = X.game.zones[0];
assert(X.game.workers.length === 1, 'first worker spawned at boot');
while (timeouts.length) timeouts.shift()();
X.game.raid.nextIn = 1e9;   // keep ambient raids out of the deterministic run
assert(X.game.workers.length === 4, 'all 4 starting workers spawned');
assert(X.game.workers.every(w => w.job === 'gold'), 'starting workers auto-assigned to gold');
assert(home.structures.hall === 1 && home.structures.farm === 1, 'home starts with hall + farm');
assert(home.army.footmen === 1, 'one starting footman defends home');
assert(X.supplyCap(X.game) === 12, 'supply cap = base 4 + hall 4 + farm 4');

// ── Harvest ───────────────────────────────────────────────────────────────
for (let i = 0; i < 20; i++) X.gameTick();
assert(X.game.resources.gold > 400, 'gold harvested after ticks');
assert(home.nodes[0].remaining < home.nodes[0].capacity, 'gold node depleting');

// ── Train + cancel at the home hall ───────────────────────────────────────
X.game.resources.gold = 20000; X.game.resources.lumber = 20000;
X.selectEntity('structure', 'hall', home.id, home.id);
X.runCommand('train-worker');
X.runCommand('train-worker');
assert(X.game.jobs.filter(j => j.kind === 'train').length === 2, 'two train jobs queued');
const goldBefore = X.game.resources.gold;
X.cancelJob(X.game, X.game.jobs[1].uid);
assert(X.game.resources.gold === goldBefore + 400, 'cancel refunds gold');
for (let i = 0; i < 16; i++) X.gameTick();   // 45s × 0.3 = 14 ticks
assert(X.game.workers.length === 5, 'worker trained and delivered');

// ── Build in a zone (build menu hangs off the selected zone) ──────────────
X.selectEntity('zone', 'band', home.id, home.id);
X.runCommand('zone-build');
assert(X.game.buildMenu === true, 'zone Build opens the build menu');
X.runCommand('build-farm');
assert(X.game.jobs.some(j => j.kind === 'construct'), 'construction started');
assert(X.game.workers.some(w => w.job === 'building'), 'builder pulled');
for (let i = 0; i < 32; i++) X.gameTick();
assert(home.structures.farm === 2, 'farm completed in the home zone');
assert(!X.game.workers.some(w => w.job === 'building'), 'builder released');
assert(X.supplyCap(X.game) === 16, 'farm supply counted');

// ── Barracks + footman join the zone's defenders ──────────────────────────
X.selectEntity('zone', 'band', home.id, home.id);
X.runCommand('zone-build');
X.runCommand('build-barracks');
for (let i = 0; i < 62; i++) X.gameTick();
assert(home.structures.barracks === 1, 'barracks completed');
X.selectEntity('structure', 'barracks', home.id, home.id);
const archerCmd = X.selectedCommands(X.game).find(c => c.id === 'train-archer');
assert(archerCmd && !archerCmd.enabled(X.game), 'archer blocked without lumber mill');
const knightCmd = X.selectedCommands(X.game).find(c => c.id === 'train-knight');
assert(knightCmd && !knightCmd.enabled(X.game), 'knight sits on the barracks card, gated on stables');
X.runCommand('train-footman');
for (let i = 0; i < 20; i++) X.gameTick();
assert(home.army.footmen === 2, 'footman joins the home zone defenders');

// ── Explore: charting takes time, and a bigger party charts faster ───────
X.exploreFrom(X.game, home.id, 'footmen', 1);
assert(home.army.footmen === 1, 'scout left the home pool');
for (let i = 0; i < 6; i++) X.gameTick();
const z1 = X.zoneByIndex(X.game, 1);
assert(z1 && !z1.discovered, 'one scout has not charted zone 1 yet');
const party = X.game.jobs.find(j => j.kind === 'explore');
assert(party && party.rate === 1, 'a lone scout charts at one tick per tick');
const remainingBefore = party.remaining;
home.army.footmen += 3;                      // stage reinforcements
X.exploreFrom(X.game, home.id, 'footmen', 3);
assert(party.rate === 4, 'reinforcements join the party and speed it up');
X.gameTick();
assert(remainingBefore - party.remaining === 4, 'four scouts chart four times as fast');
let chartGuard = 0;
while (!z1.discovered && chartGuard++ < 30) X.gameTick();
assert(z1.discovered && z1.status === 'owned', 'zone 1 charted and claimed');
assert(z1.army.footmen === 4, 'the whole party settled as zone 1 defenders');
assert(z1.nodes.some(n => n.type === 'gold') && z1.nodes.some(n => n.type === 'lumber'),
  'zone 1 always offers gold and lumber');

// ── Move a worker across zones onto a specific node ───────────────────────
const homeGold = home.nodes.find(n => n.type === 'gold');
const z1gold = z1.nodes.find(n => n.type === 'gold');
const moved = X.executeMoveOne(X.game,
  { kind: 'workers', fromZoneId: home.id, resource: 'gold', nodeId: homeGold.id }, z1, z1gold);
assert(moved && workersOf(z1).length === 1, 'move arm relocated one worker to zone 1');
assert(workersOf(z1)[0].nodeId === z1gold.id, 'relocated worker harvests the tapped node');

// ── Assault an occupied zone (deterministic garrison) ─────────────────────
for (let i = 0; i < 2; i++) X.gameTick();   // let ensureFrontier create zone 2
let z2 = X.zoneByIndex(X.game, 2) || (X.game.zones.push(X.makeZone(2, 0)), X.zoneByIndex(X.game, 2));
z2.discovered = false;
z2.status = 'occupied';
z2.strike = null;
z2.garrison = X.makeGarrison(X.GARRISON_POOL[0], 2, 0);   // raider camp, index 2, wave 0
const campGold = X.game.resources.gold;
z1.army.footmen += 11;   // stage a 12-footman assault force in zone 1
X.startTransfer(X.game, z1.id, z2.id, 'footmen', 12);
assert(z2.discovered, 'assault column revealed the occupied zone');
assert(z2.strike && z2.strike.footmen === 12, 'column became the strike force');
for (let i = 0; i < 10; i++) X.gameTick();
let guard = 0;
while (z2.status === 'occupied' && guard++ < 60) X.gameTick();
assert(z2.status === 'owned', 'garrison cleared — zone conquered');
assert(z2.wasOccupied, 'conquered zone marked for raid relief');
assert(X.game.resources.gold >= campGold + 2500, 'war chest paid out');
assert(z2.army.footmen >= 9, 'survivors settled as the zone defenders');

// ── Raid marches in and is repelled at the frontier zone ──────────────────
X.game.raid.wave = 2;
X.spawnRaid(X.game);
assert(X.game.raids.length === 1 && X.game.raids[0].index === 2, 'raid spawns at the deepest owned zone');
guard = 0;
while (X.game.raids.length && guard++ < 80) X.gameTick();
assert(X.game.raids.length === 0, 'raid repelled by zone defenders');
assert(home.structures.hall === 1, 'home untouched behind the frontier');
X.game.raid.nextIn = 1e9;

// ── Repair a damaged building ─────────────────────────────────────────────
home.structureDamage.hall = 100;
X.selectEntity('structure', 'hall', home.id, home.id);
X.runCommand('repair-hall');
assert(X.game.jobs.some(j => j.kind === 'construct' && j.repairKey === 'hall'), 'repair job started');
for (let i = 0; i < 7; i++) X.gameTick();
assert(home.structureDamage.hall === 0, 'building repaired');

// ── TIME_SCALE ────────────────────────────────────────────────────────────
home.structures.farm += 4;   // headroom — the assault army ate the supply cap
X.selectEntity('structure', 'hall', home.id, home.id);
X.runCommand('train-worker');
const trainJob = X.game.jobs.find(j => j.kind === 'train');
assert(trainJob && trainJob.duration === 14, 'train duration scaled by TIME_SCALE (45 × 0.3)');
X.cancelJob(X.game, trainJob.uid);

// ── Stronghold falls -> victory (shrunken for test speed) ─────────────────
let z3 = X.zoneByIndex(X.game, 3) || (X.game.zones.push(X.makeZone(3, 0)), X.zoneByIndex(X.game, 3));
z3.discovered = false;
z3.status = 'occupied';
z3.strike = null;
z3.garrison = X.makeGarrison(X.STRONGHOLD, 3, 0);
z3.garrison.units = { grunt: 2 };
z3.garrison.stats = { grunt: { hp: 50, dmg: 5 } };
z3.garrison.towers = 0; z3.garrison.towersLeft = 0;
z3.garrison.maxPool = 100;
X.startTransfer(X.game, z2.id, z3.id, 'footmen', 8, 'assault');
guard = 0;
while (!X.game.over && guard++ < 60) X.gameTick();
assert(X.game.over && X.game.over.won, 'stronghold falls -> victory');

console.log(process.exitCode ? 'SMOKE FAILED' : 'SMOKE PASSED');
