const MAX_LOG_LINES = 9;
const ICON_VERSION = '20260719-minimal2';
const HARVEST_COOLDOWN = 4;
const TICK_MS = 1000;

installZoomGuards();

const dom = {
  stores: document.querySelector('#stores'),
  world: document.querySelector('#world'),
  orders: document.querySelector('#orders'),
  log: document.querySelector('#log'),
  phase: document.querySelector('#phase'),
  selectedLabel: document.querySelector('#selected-label')
};

const ICONS = {
  gold: 'assets/icons/gold.png',
  lumber: 'assets/icons/lumber.png',
  oil: 'assets/icons/oil.png',
  supply: 'assets/icons/supply.png',
  worker: 'assets/icons/worker.png',
  soldier: 'assets/icons/soldier.png',
  archer: 'assets/icons/archer.png',
  hall: 'assets/icons/hall.png',
  farm: 'assets/icons/farm.png',
  barracks: 'assets/icons/barracks.png',
  enemy: 'assets/icons/enemy.png',
  attack: 'assets/icons/attack.png'
};

let idCounter = 0;
const game = createGame();

function createGame() {
  return {
    tick: 0,
    selected: { kind: 'structure', type: 'hall', id: 1 },
    resources: { gold: 120, lumber: 80, oil: 0 },
    production: [],
    workers: [
      createWorker('gold'),
      createWorker('lumber'),
      createWorker('idle')
    ],
    units: { soldiers: 0, archers: 0 },
    structures: {
      hall: 1,
      farms: 1,
      barracks: 0
    },
    enemy: 4,
    log: ['Town hall ready.', 'Workers await orders.']
  };
}

function createWorker(job = 'idle') {
  return { id: nextId(), job, cooldown: job === 'idle' ? 0 : HARVEST_COOLDOWN };
}

function nextId() {
  idCounter += 1;
  return idCounter;
}

const COMMANDS = {
  structure: {
    hall: [
      {
        id: 'train-worker',
        icon: 'worker',
        label: 'train worker',
        cost: '50◈ 1□',
        duration: 4,
        producer: 'hall',
        enabled: s => s.resources.gold >= 50 && supplyUsed(s) < supplyCap(s) && !isProducing(s, 'hall'),
        run: s => startProduction(s, {
          id: 'train-worker', producer: 'hall', icon: 'worker', label: 'worker', duration: 4,
          cost: { gold: 50 },
          complete: state => { state.workers.push(createWorker('idle')); writeLog(state, 'Worker ready.'); }
        })
      },
      {
        id: 'build-farm',
        icon: 'farm',
        label: 'build farm',
        cost: '40▥',
        duration: 5,
        producer: 'hall',
        enabled: s => s.resources.lumber >= 40 && !isProducing(s, 'hall'),
        run: s => startProduction(s, {
          id: 'build-farm', producer: 'hall', icon: 'farm', label: 'farm', duration: 5,
          cost: { lumber: 40 },
          complete: state => { state.structures.farms += 1; writeLog(state, 'Farm complete.'); }
        })
      },
      {
        id: 'build-barracks',
        icon: 'barracks',
        label: 'build barracks',
        cost: '90◈ 70▥',
        duration: 7,
        producer: 'hall',
        enabled: s => s.resources.gold >= 90 && s.resources.lumber >= 70 && !isProducing(s, 'hall'),
        run: s => startProduction(s, {
          id: 'build-barracks', producer: 'hall', icon: 'barracks', label: 'barracks', duration: 7,
          cost: { gold: 90, lumber: 70 },
          complete: state => { state.structures.barracks += 1; selectEntity('structure', 'barracks', 1); writeLog(state, 'Barracks complete.'); }
        })
      }
    ],
    barracks: [
      {
        id: 'train-soldier',
        icon: 'soldier',
        label: 'train soldier',
        cost: '60◈ 2□',
        duration: 5,
        producer: 'barracks',
        enabled: s => s.structures.barracks > 0 && s.resources.gold >= 60 && supplyUsed(s) + 2 <= supplyCap(s) && !isProducing(s, 'barracks'),
        run: s => startProduction(s, {
          id: 'train-soldier', producer: 'barracks', icon: 'soldier', label: 'soldier', duration: 5,
          cost: { gold: 60 },
          complete: state => { state.units.soldiers += 1; writeLog(state, 'Soldier ready.'); }
        })
      },
      {
        id: 'train-archer',
        icon: 'archer',
        label: 'train archer',
        cost: '45◈ 25▥ 2□',
        duration: 5,
        producer: 'barracks',
        enabled: s => s.structures.barracks > 0 && s.resources.gold >= 45 && s.resources.lumber >= 25 && supplyUsed(s) + 2 <= supplyCap(s) && !isProducing(s, 'barracks'),
        run: s => startProduction(s, {
          id: 'train-archer', producer: 'barracks', icon: 'archer', label: 'archer', duration: 5,
          cost: { gold: 45, lumber: 25 },
          complete: state => { state.units.archers += 1; writeLog(state, 'Archer ready.'); }
        })
      }
    ]
  },
  worker: [
    {
      id: 'assign-gold',
      icon: 'gold',
      label: 'mine gold',
      cost: 'auto',
      enabled: () => true,
      run: (s, worker) => assignWorker(s, worker, 'gold')
    },
    {
      id: 'assign-lumber',
      icon: 'lumber',
      label: 'cut lumber',
      cost: 'auto',
      enabled: () => true,
      run: (s, worker) => assignWorker(s, worker, 'lumber')
    },
    {
      id: 'assign-idle',
      icon: 'worker',
      label: 'idle',
      cost: 'stop',
      enabled: () => true,
      run: (s, worker) => assignWorker(s, worker, 'idle')
    }
  ],
  army: [
    {
      id: 'attack',
      icon: 'attack',
      label: 'attack',
      cost: 'vs ∆',
      enabled: s => armyPower(s) > 0 && s.enemy > 0,
      run: s => {
        const hit = armyPower(s);
        s.enemy = Math.max(0, s.enemy - hit);
        writeLog(s, `Attack: ${hit}.`);
      }
    }
  ]
};

function assignWorker(state, worker, job) {
  if (!worker) return;
  worker.job = job;
  worker.cooldown = job === 'idle' ? 0 : HARVEST_COOLDOWN;
  writeLog(state, `Worker ${worker.id}: ${job}.`);
}

function isProducing(state, producer) {
  return state.production.some(job => job.producer === producer);
}

function activeProduction(state, producer) {
  return state.production.find(job => job.producer === producer) || null;
}

function canAfford(state, cost) {
  return Object.keys(cost).every(key => state.resources[key] >= cost[key]);
}

function spend(state, cost) {
  Object.keys(cost).forEach(key => { state.resources[key] -= cost[key]; });
}

function startProduction(state, job) {
  if (isProducing(state, job.producer) || !canAfford(state, job.cost)) return;
  spend(state, job.cost);
  state.production.push({ ...job, remaining: job.duration });
  writeLog(state, `${job.label}: started.`);
}

function advanceProduction(state) {
  state.production.forEach(job => { job.remaining -= 1; });
  const done = state.production.filter(job => job.remaining <= 0);
  state.production = state.production.filter(job => job.remaining > 0);
  done.forEach(job => job.complete(state));
}

function gameTick() {
  game.tick += 1;

  advanceProduction(game);

  game.workers.forEach(worker => {
    if (worker.job === 'idle') return;
    worker.cooldown -= 1;
    if (worker.cooldown > 0) return;

    if (worker.job === 'gold') game.resources.gold += 12;
    if (worker.job === 'lumber') game.resources.lumber += 8;
    worker.cooldown = HARVEST_COOLDOWN;
  });

  if (game.tick % 6 === 0) game.enemy += 1;
  clampGame(game);
  render();
}

function selectedWorker(state) {
  if (state.selected.kind !== 'worker') return null;
  return state.workers.find(worker => worker.id === state.selected.id) || null;
}

function selectedCommands(state) {
  if (state.selected.kind === 'structure') {
    return COMMANDS.structure[state.selected.type] || [];
  }
  if (state.selected.kind === 'worker') return COMMANDS.worker;
  if (state.selected.kind === 'army') return COMMANDS.army;
  return [];
}

function runCommand(id) {
  const worker = selectedWorker(game);
  const command = selectedCommands(game).find(item => item.id === id);
  if (!command || !command.enabled(game, worker)) return;
  command.run(game, worker);
  clampGame(game);
  render();
}

function selectEntity(kind, type, id) {
  game.selected = { kind, type, id };
  render();
}

function supplyUsed(state) {
  return state.workers.length + state.units.soldiers * 2 + state.units.archers * 2;
}

function supplyCap(state) {
  return 4 + state.structures.hall * 4 + state.structures.farms * 4;
}

function armyPower(state) {
  return state.units.soldiers * 3 + state.units.archers * 2;
}

function phase(state) {
  if (state.structures.barracks < 1) return 'economy';
  if (armyPower(state) < 5) return 'mustering';
  return 'war front';
}

function clampGame(state) {
  for (const key of Object.keys(state.resources)) {
    state.resources[key] = Math.max(0, Math.floor(state.resources[key]));
  }
  state.enemy = Math.max(0, Math.floor(state.enemy));
}

function writeLog(state, line) {
  state.log.unshift(line);
  state.log = state.log.slice(0, MAX_LOG_LINES);
}

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

function entityButton({ kind, type, id, icon, label, count, meta, danger, compact, jobIcon, progress }) {
  const button = document.createElement('button');
  const classes = ['entity'];
  if (danger) classes.push('danger');
  if (compact) classes.push('compact');
  button.className = classes.join(' ');
  if (game.selected.kind === kind && game.selected.type === type && game.selected.id === id) {
    button.classList.add('selected');
  }
  button.dataset.kind = kind;
  button.dataset.type = type;
  button.dataset.id = id;
  button.title = label;
  button.setAttribute('aria-label', label);

  button.appendChild(makeIcon(ICONS[icon], label));

  if (jobIcon) {
    const badge = document.createElement('span');
    badge.className = 'job-badge';
    badge.appendChild(makeIcon(ICONS[jobIcon], meta || jobIcon));
    if (typeof progress === 'number') {
      const fill = document.createElement('span');
      fill.className = 'cooldown-fill';
      fill.style.width = `${Math.max(0, Math.min(100, progress * 100))}%`;
      badge.appendChild(fill);
    }
    button.appendChild(badge);
  }

  if (!compact) {
    const body = document.createElement('span');
    body.className = 'entity-body';

    const name = document.createElement('strong');
    name.textContent = count ? `${label} ${count}` : label;

    const sub = document.createElement('small');
    sub.textContent = meta || '';

    body.append(name, sub);
    button.appendChild(body);
  }
  return button;
}

function render() {
  dom.phase.textContent = phase(game);
  dom.selectedLabel.textContent = selectedTitle(game).toUpperCase();

  renderResources();
  renderWorld();
  renderOrders();
  renderLog();
}

function selectedTitle(state) {
  if (state.selected.kind === 'worker') {
    const worker = selectedWorker(state);
    return worker ? 'worker' : 'worker';
  }
  if (state.selected.kind === 'army') return 'army';
  return state.selected.type === 'hall' ? 'town hall' : state.selected.type;
}

function renderResources() {
  dom.stores.replaceChildren();
  const rows = [
    ['gold', ICONS.gold, game.resources.gold],
    ['lumber', ICONS.lumber, game.resources.lumber],
    ['oil', ICONS.oil, game.resources.oil],
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

function renderWorld() {
  dom.world.replaceChildren();

  const structures = document.createElement('section');
  structures.className = 'world-group structures';
  structures.appendChild(entityButton({ kind: 'structure', type: 'hall', id: 1, icon: 'hall', label: 'town hall', count: game.structures.hall, meta: productionMeta(game, 'hall') || 'train/build', jobIcon: productionIcon(game, 'hall'), progress: productionProgress(game, 'hall') }));

  for (let i = 1; i <= game.structures.farms; i += 1) {
    structures.appendChild(entityButton({ kind: 'structure', type: 'farm', id: i, icon: 'farm', label: 'farm', meta: '+4 supply' }));
  }

  for (let i = 1; i <= game.structures.barracks; i += 1) {
    structures.appendChild(entityButton({ kind: 'structure', type: 'barracks', id: i, icon: 'barracks', label: 'barracks', meta: productionMeta(game, 'barracks') || 'train army', jobIcon: productionIcon(game, 'barracks'), progress: productionProgress(game, 'barracks') }));
  }

  const workers = document.createElement('section');
  workers.className = 'world-group workers';
  advanceProduction(game);

  game.workers.forEach(worker => {
    workers.appendChild(entityButton({
      kind: 'worker',
      type: 'worker',
      id: worker.id,
      icon: 'worker',
      label: `worker ${worker.id}`,
      meta: workerMeta(worker),
      compact: true,
      jobIcon: workerJobIcon(worker),
      progress: workerProgress(worker)
    }));
  });

  const army = document.createElement('section');
  army.className = 'world-group army';
  if (game.units.soldiers > 0) army.appendChild(entityButton({ kind: 'army', type: 'soldiers', id: 1, icon: 'soldier', label: 'soldiers', count: game.units.soldiers, meta: `power ${game.units.soldiers * 3}` }));
  if (game.units.archers > 0) army.appendChild(entityButton({ kind: 'army', type: 'archers', id: 1, icon: 'archer', label: 'archers', count: game.units.archers, meta: `power ${game.units.archers * 2}` }));
  army.appendChild(entityButton({ kind: 'enemy', type: 'enemy', id: 1, icon: 'enemy', label: 'enemy', count: game.enemy, meta: 'threat', danger: true }));

  dom.world.append(structures, workers, army);
}

function workerMeta(worker) {
  return worker.job;
}

function workerJobIcon(worker) {
  if (worker.job === 'gold') return 'gold';
  if (worker.job === 'lumber') return 'lumber';
  return 'worker';
}

function workerProgress(worker) {
  if (worker.job === 'idle') return 0;
  return (HARVEST_COOLDOWN - worker.cooldown) / HARVEST_COOLDOWN;
}

function productionMeta(state, producer) {
  const job = activeProduction(state, producer);
  if (!job) return '';
  return `${job.label} ${job.remaining}s`;
}

function productionIcon(state, producer) {
  const job = activeProduction(state, producer);
  return job ? job.icon : '';
}

function productionProgress(state, producer) {
  const job = activeProduction(state, producer);
  return job ? (job.duration - job.remaining) / job.duration : 0;
}

function renderOrders() {
  dom.orders.replaceChildren();
  const worker = selectedWorker(game);

  selectedCommands(game).forEach(command => {
    const button = document.createElement('button');
    button.className = 'command';
    button.dataset.command = command.id;
    button.disabled = !command.enabled(game, worker);
    button.title = command.label;
    button.setAttribute('aria-label', command.label);

    button.appendChild(makeIcon(ICONS[command.icon], command.label));

    const copy = document.createElement('span');
    copy.className = 'command-copy';
    const label = document.createElement('strong');
    label.textContent = command.label;
    const cost = document.createElement('small');
    cost.textContent = command.cost;
    copy.append(label, cost);
    button.appendChild(copy);
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

function installZoomGuards() {
  let lastTouchEnd = 0;
  document.addEventListener('gesturestart', event => event.preventDefault(), { passive: false });
  document.addEventListener('gesturechange', event => event.preventDefault(), { passive: false });
  document.addEventListener('gestureend', event => event.preventDefault(), { passive: false });
  document.addEventListener('touchend', event => {
    const now = Date.now();
    if (now - lastTouchEnd <= 320) event.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });
}

dom.world.addEventListener('click', event => {
  const button = event.target.closest('.entity');
  if (!button) return;
  if (button.dataset.kind === 'enemy') return;
  selectEntity(button.dataset.kind, button.dataset.type, Number(button.dataset.id));
});

dom.orders.addEventListener('click', event => {
  const button = event.target.closest('button[data-command]');
  if (!button) return;
  runCommand(button.dataset.command);
});

render();
setInterval(gameTick, TICK_MS);
