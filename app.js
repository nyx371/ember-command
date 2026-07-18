const state = {
  tick: 0,
  ember: 0,
  wood: 0,
  food: 0,
  scouts: 0,
  foragers: 0,
  sentries: 0,
  traps: 0,
  huts: 0,
  commandGrounds: 0,
  threat: 0,
  unlocked: {
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

const actions = [
  {
    id: 'spark',
    label: 'strike a spark',
    detail: '+1 ember',
    show: () => !state.unlocked.fire,
    run: () => {
      state.ember += 1;
      if (state.ember >= 3) {
        state.unlocked.fire = true;
        addLog('The ember catches. The fire is alive.');
      } else {
        addLog('A spark jumps, then shivers.');
      }
    }
  },
  {
    id: 'gather',
    label: 'gather wood',
    detail: '+2 wood',
    show: () => state.unlocked.fire,
    run: () => {
      state.wood += 2;
      state.unlocked.gather = true;
      addLog('You drag branches from the black edge of the camp.');
    }
  },
  {
    id: 'feed',
    label: 'feed the fire',
    detail: '2 wood → +3 ember',
    show: () => state.unlocked.fire,
    enabled: () => state.wood >= 2,
    run: () => {
      state.wood -= 2;
      state.ember += 3;
      addLog('The fire climbs higher. Shadows retreat.');
    }
  },
  {
    id: 'forage',
    label: 'forage',
    detail: '+1 food, +1 threat',
    show: () => state.unlocked.gather,
    run: () => {
      state.food += 1;
      state.threat += 1;
      addLog('Tracks cross your path. You return with roots.');
    }
  },
  {
    id: 'trap',
    label: 'set traps',
    detail: '5 wood → +1 trap',
    show: () => state.unlocked.gather,
    enabled: () => state.wood >= 5,
    run: () => {
      state.wood -= 5;
      state.traps += 1;
      state.unlocked.trap = true;
      addLog('A snare waits under leaves.');
    }
  },
  {
    id: 'hut',
    label: 'raise huts',
    detail: '12 wood, 4 food → worker cap',
    show: () => state.traps >= 1,
    enabled: () => state.wood >= 12 && state.food >= 4,
    run: () => {
      state.wood -= 12;
      state.food -= 4;
      state.huts += 1;
      state.unlocked.scout = true;
      addLog('Smoke curls from a new shelter.');
    }
  },
  {
    id: 'scout',
    label: 'train scouts',
    detail: '3 food → +1 scout',
    show: () => state.unlocked.scout,
    enabled: () => state.food >= 3 && workers() < workerCap(),
    run: () => {
      state.food -= 3;
      state.scouts += 1;
      state.unlocked.command = true;
      addLog('A scout learns the paths between trees.');
    }
  },
  {
    id: 'forager',
    label: 'assign foragers',
    detail: '4 food → passive supplies',
    show: () => state.unlocked.scout,
    enabled: () => state.food >= 4 && workers() < workerCap(),
    run: () => {
      state.food -= 4;
      state.foragers += 1;
      addLog('A quiet worker starts ranging for supplies.');
    }
  },
  {
    id: 'sentry',
    label: 'post sentries',
    detail: '5 food, 3 ember → defense',
    show: () => state.unlocked.command,
    enabled: () => state.food >= 5 && state.ember >= 3 && workers() < workerCap(),
    run: () => {
      state.food -= 5;
      state.ember -= 3;
      state.sentries += 1;
      addLog('A spear point glints at the perimeter.');
    }
  },
  {
    id: 'command-ground',
    label: 'mark command ground',
    detail: '25 wood, 10 ember → RTS layer',
    show: () => state.unlocked.command,
    enabled: () => state.wood >= 25 && state.ember >= 10,
    run: () => {
      state.wood -= 25;
      state.ember -= 10;
      state.commandGrounds += 1;
      addLog('Orders become doctrine. The camp is now a front.');
    }
  }
];

function workers() {
  return state.scouts + state.foragers + state.sentries;
}

function workerCap() {
  return 2 + state.huts * 2 + state.commandGrounds * 4;
}

function addLog(line) {
  state.log.unshift(line);
  state.log = state.log.slice(0, 8);
}

function passTime() {
  state.tick += 1;

  if (state.unlocked.fire) {
    state.ember += 1 + state.commandGrounds;
  }

  state.wood += state.foragers;
  state.food += Math.max(0, state.foragers - Math.floor(state.threat / 10));
  state.threat += Math.max(0, state.scouts ? 1 : 2) + state.commandGrounds;

  const raidAt = 12 + state.sentries * 5;
  if (state.threat >= raidAt) {
    resolveRaid();
  } else {
    addLog('Time passes. The fire listens.');
  }

  render();
}

function resolveRaid() {
  const defense = state.traps * 2 + state.sentries * 3 + state.commandGrounds * 5;
  const pressure = Math.ceil(state.threat / 3);

  if (defense >= pressure) {
    state.traps = Math.max(0, state.traps - 1);
    state.food += 2;
    addLog('Shapes break on the traps. The camp holds.');
  } else {
    const loss = Math.min(state.wood, pressure - defense + 2);
    state.wood -= loss;
    state.ember = Math.max(0, state.ember - 2);
    addLog(`A raid cuts through the dark. Lost ${loss} wood.`);
  }

  state.threat = Math.floor(state.threat / 3);
}

function phase() {
  if (!state.unlocked.fire) return 'Dark room';
  if (!state.unlocked.command) return 'Camp survival';
  if (!state.commandGrounds) return 'Border command';
  return 'Abstract RTS';
}

function stat(label, value, danger = false) {
  return `<div class="stat${danger ? ' danger' : ''}"><span>${label}</span><strong>${value}</strong></div>`;
}

function renderStats() {
  document.querySelector('#stores').innerHTML = [
    stat('ember', state.ember),
    stat('wood', state.wood),
    stat('food', state.food),
    stat('threat', state.threat, true)
  ].join('');

  document.querySelector('#camp').innerHTML = [
    stat('workers', `${workers()} / ${workerCap()}`),
    stat('scouts', state.scouts),
    stat('foragers', state.foragers),
    stat('sentries', state.sentries),
    stat('traps', state.traps),
    stat('huts', state.huts),
    stat('command grounds', state.commandGrounds)
  ].join('');
}

function renderOrders() {
  const orderBox = document.querySelector('#orders');
  orderBox.innerHTML = '';

  actions.filter(action => action.show()).forEach(action => {
    const button = document.createElement('button');
    const enabled = action.enabled ? action.enabled() : true;
    button.disabled = !enabled;
    button.innerHTML = `<span>${action.label}</span><small>${action.detail}</small>`;
    button.addEventListener('click', () => {
      action.run();
      render();
    });
    orderBox.appendChild(button);
  });

  const timeButton = document.createElement('button');
  timeButton.className = 'primary';
  timeButton.innerHTML = '<span>let time pass</span><small>production + raids</small>';
  timeButton.addEventListener('click', passTime);
  orderBox.appendChild(timeButton);
}

function renderLog() {
  document.querySelector('#log').innerHTML = state.log.map(line => `<p>${line}</p>`).join('');
}

function render() {
  document.querySelector('#headline').textContent = state.unlocked.fire ? 'The fire is roaring.' : 'The room is dark.';
  document.querySelector('#phase').textContent = phase();
  renderStats();
  renderOrders();
  renderLog();
}

render();
