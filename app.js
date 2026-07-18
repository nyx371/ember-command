const MAX_LOG_LINES = 8;

const game = createGame();
const dom = {
  headline: document.querySelector('#headline'),
  phase: document.querySelector('#phase'),
  stores: document.querySelector('#stores'),
  orders: document.querySelector('#orders'),
  camp: document.querySelector('#camp'),
  log: document.querySelector('#log')
};

const GLYPHS = {
  ember: '∴',
  wood: '╱',
  food: '○',
  threat: '∆',
  workers: '◇',
  scouts: '⌖',
  foragers: '∿',
  sentries: '†',
  traps: '⌁',
  huts: '⌂',
  commandGrounds: '⌘'
};

const COMMANDS = [
  {
    id: 'spark',
    glyph: '✶',
    label: 'strike a spark',
    detail: '+1∴',
    visible: s => !s.flags.fire,
    execute: s => {
      s.resources.ember += 1;
      if (s.resources.ember >= 3) {
        s.flags.fire = true;
        writeLog(s, 'The ember catches. The fire is alive.');
      } else {
        writeLog(s, 'A spark jumps, then shivers.');
      }
    }
  },
  {
    id: 'gather-wood',
    glyph: '╱',
    label: 'gather wood',
    detail: '+2╱',
    visible: s => s.flags.fire,
    execute: s => {
      s.resources.wood += 2;
      s.flags.gather = true;
      writeLog(s, 'You drag branches from the black edge of the camp.');
    }
  },
  {
    id: 'feed-fire',
    glyph: '▲',
    label: 'feed the fire',
    detail: '2╱→3∴',
    visible: s => s.flags.fire,
    enabled: s => s.resources.wood >= 2,
    execute: s => {
      s.resources.wood -= 2;
      s.resources.ember += 3;
      writeLog(s, 'The fire climbs higher. Shadows retreat.');
    }
  },
  {
    id: 'forage',
    glyph: '○',
    label: 'forage',
    detail: '+1○ +1∆',
    visible: s => s.flags.gather,
    execute: s => {
      s.resources.food += 1;
      s.threat += 1;
      writeLog(s, 'Tracks cross your path. You return with roots.');
    }
  },
  {
    id: 'set-trap',
    glyph: '⌁',
    label: 'set traps',
    detail: '5╱→1⌁',
    visible: s => s.flags.gather,
    enabled: s => s.resources.wood >= 5,
    execute: s => {
      s.resources.wood -= 5;
      s.structures.traps += 1;
      s.flags.trap = true;
      writeLog(s, 'A snare waits under leaves.');
    }
  },
  {
    id: 'raise-hut',
    glyph: '⌂',
    label: 'raise huts',
    detail: '12╱ 4○',
    visible: s => s.structures.traps >= 1,
    enabled: s => s.resources.wood >= 12 && s.resources.food >= 4,
    execute: s => {
      s.resources.wood -= 12;
      s.resources.food -= 4;
      s.structures.huts += 1;
      s.flags.scout = true;
      writeLog(s, 'Smoke curls from a new shelter.');
    }
  },
  {
    id: 'train-scout',
    glyph: '⌖',
    label: 'train scouts',
    detail: '3○→1⌖',
    visible: s => s.flags.scout,
    enabled: s => s.resources.food >= 3 && totalWorkers(s) < workerCap(s),
    execute: s => {
      s.resources.food -= 3;
      s.units.scouts += 1;
      s.flags.command = true;
      writeLog(s, 'A scout learns the paths between trees.');
    }
  },
  {
    id: 'assign-forager',
    glyph: '∿',
    label: 'assign foragers',
    detail: '4○→1∿',
    visible: s => s.flags.scout,
    enabled: s => s.resources.food >= 4 && totalWorkers(s) < workerCap(s),
    execute: s => {
      s.resources.food -= 4;
      s.units.foragers += 1;
      writeLog(s, 'A quiet worker starts ranging for supplies.');
    }
  },
  {
    id: 'post-sentry',
    glyph: '†',
    label: 'post sentries',
    detail: '5○ 3∴',
    visible: s => s.flags.command,
    enabled: s => s.resources.food >= 5 && s.resources.ember >= 3 && totalWorkers(s) < workerCap(s),
    execute: s => {
      s.resources.food -= 5;
      s.resources.ember -= 3;
      s.units.sentries += 1;
      writeLog(s, 'A spear point glints at the perimeter.');
    }
  },
  {
    id: 'command-ground',
    glyph: '⌘',
    label: 'mark command ground',
    detail: '25╱ 10∴',
    visible: s => s.flags.command,
    enabled: s => s.resources.wood >= 25 && s.resources.ember >= 10,
    execute: s => {
      s.resources.wood -= 25;
      s.resources.ember -= 10;
      s.structures.commandGrounds += 1;
      writeLog(s, 'Orders become doctrine. The camp is now a front.');
    }
  },
  {
    id: 'wait',
    glyph: '›',
    label: 'let time pass',
    detail: 'turn',
    primary: true,
    visible: () => true,
    execute: runTurn
  }
];

function createGame() {
  return {
    turn: 0,
    resources: {
      ember: 0,
      wood: 0,
      food: 0
    },
    units: {
      scouts: 0,
      foragers: 0,
      sentries: 0
    },
    structures: {
      traps: 0,
      huts: 0,
      commandGrounds: 0
    },
    threat: 0,
    flags: {
      fire: false,
      gather: false,
      trap: false,
      scout: false,
      command: false
    },
    log: [
      'The room is dark.',
      'Something waits beyond the tree line.'
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
  produceResources(state);
  increaseThreat(state);

  if (state.threat >= raidThreshold(state)) {
    resolveRaid(state);
  } else {
    writeLog(state, 'Time passes. The fire listens.');
  }
}

function produceResources(state) {
  if (state.flags.fire) {
    state.resources.ember += 1 + state.structures.commandGrounds;
  }

  state.resources.wood += state.units.foragers;
  state.resources.food += Math.max(0, state.units.foragers - Math.floor(state.threat / 10));
}

function increaseThreat(state) {
  const scoutReduction = state.units.scouts > 0 ? 1 : 0;
  state.threat += 2 - scoutReduction + state.structures.commandGrounds;
}

function resolveRaid(state) {
  const defense = defenseValue(state);
  const pressure = Math.ceil(state.threat / 3);

  if (defense >= pressure) {
    state.structures.traps = Math.max(0, state.structures.traps - 1);
    state.resources.food += 2;
    writeLog(state, 'Shapes break on the traps. The camp holds.');
  } else {
    const loss = Math.min(state.resources.wood, pressure - defense + 2);
    state.resources.wood -= loss;
    state.resources.ember = Math.max(0, state.resources.ember - 2);
    writeLog(state, `A raid cuts through the dark. Lost ${loss} wood.`);
  }

  state.threat = Math.floor(state.threat / 3);
}

function defenseValue(state) {
  return state.structures.traps * 2 + state.units.sentries * 3 + state.structures.commandGrounds * 5;
}

function raidThreshold(state) {
  return 12 + state.units.sentries * 5;
}

function totalWorkers(state) {
  return state.units.scouts + state.units.foragers + state.units.sentries;
}

function workerCap(state) {
  return 2 + state.structures.huts * 2 + state.structures.commandGrounds * 4;
}

function phase(state) {
  if (!state.flags.fire) return 'Dark room';
  if (!state.flags.command) return 'Camp survival';
  if (!state.structures.commandGrounds) return 'Border command';
  return 'Abstract RTS';
}

function writeLog(state, line) {
  state.log.unshift(line);
  state.log = state.log.slice(0, MAX_LOG_LINES);
}

function clampGame(state) {
  Object.keys(state.resources).forEach(key => {
    state.resources[key] = Math.max(0, Math.floor(state.resources[key]));
  });
  state.threat = Math.max(0, Math.floor(state.threat));
}

function render() {
  dom.headline.textContent = game.flags.fire ? 'FIRE' : 'DARK';
  dom.phase.textContent = phase(game);

  renderStats(dom.stores, [
    ['ember', GLYPHS.ember, game.resources.ember],
    ['wood', GLYPHS.wood, game.resources.wood],
    ['food', GLYPHS.food, game.resources.food],
    ['threat', GLYPHS.threat, game.threat, true]
  ]);

  renderStats(dom.camp, [
    ['workers', GLYPHS.workers, `${totalWorkers(game)}/${workerCap(game)}`],
    ['scouts', GLYPHS.scouts, game.units.scouts],
    ['foragers', GLYPHS.foragers, game.units.foragers],
    ['sentries', GLYPHS.sentries, game.units.sentries],
    ['traps', GLYPHS.traps, game.structures.traps],
    ['huts', GLYPHS.huts, game.structures.huts],
    ['command grounds', GLYPHS.commandGrounds, game.structures.commandGrounds]
  ]);

  renderOrders();
  renderLog();
}

function renderStats(parent, stats) {
  parent.replaceChildren();

  stats.forEach(([label, glyph, value, danger]) => {
    const row = document.createElement('div');
    row.className = danger ? 'stat danger' : 'stat';
    row.title = label;
    row.setAttribute('aria-label', `${label}: ${value}`);

    const mark = document.createElement('span');
    mark.className = 'glyph';
    mark.textContent = glyph;

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

    const glyph = document.createElement('span');
    glyph.className = 'glyph';
    glyph.textContent = command.glyph;

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

dom.orders.addEventListener('click', event => {
  const button = event.target.closest('button[data-command]');
  if (!button) return;
  runCommand(button.dataset.command);
});

render();
