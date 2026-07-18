const MAX_LOG_LINES = 8;

installZoomGuards();

const game = createGame();
const dom = {
  headline: document.querySelector('#headline'),
  phase: document.querySelector('#phase'),
  stores: document.querySelector('#stores'),
  orders: document.querySelector('#orders'),
  camp: document.querySelector('#camp'),
  log: document.querySelector('#log')
};

const ICONS = {
  gold: [6, 13],
  lumber: [8, 13],
  oil: [8, 15],
  supply: [4, 13],
  workers: [0, 0],
  soldiers: [2, 0],
  archers: [4, 3],
  hall: [0, 4],
  farms: [1, 4],
  barracks: [2, 4],
  enemy: [3, 8],
  wait: [6, 17],
  attack: [3, 8]
};

const COMMANDS = [
  {
    id: 'wait',
    icon: 'wait',
    label: 'end turn',
    detail: 'turn',
    primary: true,
    visible: () => true,
    execute: runTurn
  },
  {
    id: 'mine-gold',
    icon: 'gold',
    label: 'mine gold',
    detail: '+8◈',
    visible: () => true,
    execute: s => {
      s.resources.gold += 8;
      writeLog(s, 'Gold gathered.');
    }
  },
  {
    id: 'cut-lumber',
    icon: 'lumber',
    label: 'cut lumber',
    detail: '+6▥',
    visible: () => true,
    execute: s => {
      s.resources.lumber += 6;
      writeLog(s, 'Lumber stacked.');
    }
  },
  {
    id: 'pump-oil',
    icon: 'oil',
    label: 'pump oil',
    detail: '+3≈',
    visible: s => s.structures.barracks > 0,
    execute: s => {
      s.resources.oil += 3;
      s.enemy += 1;
      writeLog(s, 'Oil drawn from black water.');
    }
  },
  {
    id: 'train-worker',
    icon: 'workers',
    label: 'train worker',
    detail: '25◈ 1□',
    visible: () => true,
    enabled: s => s.resources.gold >= 25 && supplyUsed(s) < supplyCap(s),
    execute: s => {
      s.resources.gold -= 25;
      s.units.workers += 1;
      writeLog(s, 'Worker ready.');
    }
  },
  {
    id: 'build-farm',
    icon: 'farms',
    label: 'build farm',
    detail: '25▥ +4□',
    visible: () => true,
    enabled: s => s.resources.lumber >= 25,
    execute: s => {
      s.resources.lumber -= 25;
      s.structures.farms += 1;
      writeLog(s, 'Farm raised.');
    }
  },
  {
    id: 'build-barracks',
    icon: 'barracks',
    label: 'build barracks',
    detail: '80◈ 60▥',
    visible: s => s.structures.farms > 0,
    enabled: s => s.resources.gold >= 80 && s.resources.lumber >= 60,
    execute: s => {
      s.resources.gold -= 80;
      s.resources.lumber -= 60;
      s.structures.barracks += 1;
      writeLog(s, 'Barracks complete.');
    }
  },
  {
    id: 'train-soldier',
    icon: 'soldiers',
    label: 'train soldier',
    detail: '45◈ 2□',
    visible: s => s.structures.barracks > 0,
    enabled: s => s.resources.gold >= 45 && supplyUsed(s) + 2 <= supplyCap(s),
    execute: s => {
      s.resources.gold -= 45;
      s.units.soldiers += 1;
      writeLog(s, 'Soldier armed.');
    }
  },
  {
    id: 'train-archer',
    icon: 'archers',
    label: 'train archer',
    detail: '35◈ 20▥ 2□',
    visible: s => s.structures.barracks > 0,
    enabled: s => s.resources.gold >= 35 && s.resources.lumber >= 20 && supplyUsed(s) + 2 <= supplyCap(s),
    execute: s => {
      s.resources.gold -= 35;
      s.resources.lumber -= 20;
      s.units.archers += 1;
      writeLog(s, 'Archer posted.');
    }
  },
  {
    id: 'strike',
    icon: 'attack',
    label: 'strike enemy',
    detail: 'vs ∆',
    visible: s => armyPower(s) > 0,
    enabled: s => armyPower(s) > 0,
    execute: s => {
      const hit = armyPower(s);
      s.enemy = Math.max(0, s.enemy - hit);
      writeLog(s, `Strike lands: ${hit}.`);
    }
  }
];

function createGame() {
  return {
    turn: 0,
    resources: {
      gold: 80,
      lumber: 40,
      oil: 0
    },
    units: {
      workers: 2,
      soldiers: 0,
      archers: 0
    },
    structures: {
      hall: 1,
      farms: 1,
      barracks: 0
    },
    enemy: 4,
    log: [
      'Hall online.',
      'Enemy camp sighted.'
    ]
  };
}

function commandById(id) {
  return COMMANDS.find(command => command.id === id);
}

function canRun(command, state) {
  return command.visible(state) && (!command.enabled || command.enabled(state));
}

function runCommand(id) {
  const command = commandById(id);
  if (!command || !canRun(command, game)) return;
  command.execute(game);
  clampGame(game);
  render();
}

function runTurn(state) {
  state.turn += 1;
  harvest(state);
  enemyTurn(state);
}

function harvest(state) {
  const workers = state.units.workers;
  state.resources.gold += workers * 4;
  state.resources.lumber += workers * 2;

  if (state.structures.barracks > 0) {
    state.resources.oil += state.structures.barracks;
  }

  writeLog(state, `Turn ${state.turn}: +${workers * 4} gold, +${workers * 2} lumber.`);
}

function enemyTurn(state) {
  state.enemy += 1 + Math.floor(state.turn / 5);

  if (state.enemy < raidThreshold(state)) return;

  const attack = state.enemy;
  const defense = defensePower(state);

  if (defense >= attack) {
    state.enemy = Math.floor(state.enemy / 2);
    writeLog(state, 'Raid broken.');
    return;
  }

  const loss = Math.min(state.resources.gold, (attack - defense) * 3);
  state.resources.gold -= loss;
  if (state.units.workers > 1 && attack - defense > 3) state.units.workers -= 1;
  state.enemy = Math.floor(state.enemy / 3);
  writeLog(state, `Raid hits. Lost ${loss} gold.`);
}

function supplyUsed(state) {
  return state.units.workers + state.units.soldiers * 2 + state.units.archers * 2;
}

function supplyCap(state) {
  return 4 + state.structures.farms * 4 + state.structures.hall * 4;
}

function armyPower(state) {
  return state.units.soldiers * 3 + state.units.archers * 2;
}

function defensePower(state) {
  return armyPower(state) + state.units.workers + state.structures.barracks * 2;
}

function raidThreshold(state) {
  return 9 + state.units.soldiers * 2 + state.units.archers;
}

function phase(state) {
  if (state.structures.barracks < 1) return 'economy';
  if (armyPower(state) < 5) return 'mustering';
  return 'war front';
}

function writeLog(state, line) {
  state.log.unshift(line);
  state.log = state.log.slice(0, MAX_LOG_LINES);
}

function clampGame(state) {
  Object.keys(state.resources).forEach(key => {
    state.resources[key] = Math.max(0, Math.floor(state.resources[key]));
  });
  state.enemy = Math.max(0, Math.floor(state.enemy));
}

function render() {
  dom.headline.textContent = 'WAR';
  dom.phase.textContent = phase(game);

  renderStats(dom.stores, [
    ['gold', ICONS.gold, game.resources.gold],
    ['lumber', ICONS.lumber, game.resources.lumber],
    ['oil', ICONS.oil, game.resources.oil],
    ['supply', ICONS.supply, `${supplyUsed(game)}/${supplyCap(game)}`]
  ]);

  renderStats(dom.camp, [
    ['workers', ICONS.workers, game.units.workers],
    ['soldiers', ICONS.soldiers, game.units.soldiers],
    ['archers', ICONS.archers, game.units.archers],
    ['hall', ICONS.hall, game.structures.hall],
    ['farms', ICONS.farms, game.structures.farms],
    ['barracks', ICONS.barracks, game.structures.barracks],
    ['enemy', ICONS.enemy, game.enemy, true]
  ]);

  renderOrders();
  renderLog();
}

function makeSprite(icon) {
  const sprite = document.createElement('span');
  sprite.className = 'sprite';
  sprite.style.setProperty('--sx', icon[0]);
  sprite.style.setProperty('--sy', icon[1]);
  return sprite;
}

function renderStats(parent, stats) {
  parent.replaceChildren();

  stats.forEach(([label, glyph, value, danger]) => {
    const row = document.createElement('div');
    row.className = danger ? 'stat danger' : 'stat';
    row.title = label;
    row.setAttribute('aria-label', `${label}: ${value}`);

    const mark = makeSprite(glyph);

    const amount = document.createElement('strong');
    amount.textContent = value;

    row.append(mark, amount);
    parent.appendChild(row);
  });
}

function renderOrders() {
  dom.orders.replaceChildren();

  COMMANDS.filter(command => command.visible(game)).forEach(command => {
    const button = document.createElement('button');
    button.dataset.command = command.id;
    button.className = command.primary ? 'primary' : '';
    button.disabled = !canRun(command, game);
    button.title = command.label;
    button.setAttribute('aria-label', command.label);

    const glyph = makeSprite(ICONS[command.icon]);

    const detail = document.createElement('small');
    detail.textContent = command.detail;

    button.append(glyph, detail);
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

dom.orders.addEventListener('click', event => {
  const button = event.target.closest('button[data-command]');
  if (!button) return;
  runCommand(button.dataset.command);
});

render();
