import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const initialState = {
  tick: 0,
  ember: 0,
  wood: 0,
  food: 0,
  scouts: 0,
  foragers: 0,
  sentries: 0,
  traps: 0,
  huts: 0,
  barracks: 0,
  enemies: 0,
  threat: 0,
  log: ['The room is dark.', 'Something waits beyond the tree line.'],
  unlocked: { fire: false, gather: false, trap: false, scout: false, command: false }
};

const actions = [
  {
    id: 'spark', label: 'strike a spark', text: '+1 ember', show: s => !s.unlocked.fire,
    run: s => patch(s, { ember: s.ember + 1, unlocked: { ...s.unlocked, fire: s.ember >= 2 } }, s.ember >= 2 ? 'The ember catches. The fire is alive.' : 'A spark jumps, then shivers.')
  },
  {
    id: 'feed', label: 'feed the fire', text: '2 wood → +3 ember', show: s => s.unlocked.fire, enabled: s => s.wood >= 2,
    run: s => patch(s, { wood: s.wood - 2, ember: s.ember + 3 }, 'The fire climbs higher. Shadows retreat.')
  },
  {
    id: 'gather', label: 'gather wood', text: '+2 wood', show: s => s.unlocked.fire,
    run: s => patch(s, { wood: s.wood + 2, unlocked: { ...s.unlocked, gather: true } }, 'You drag branches from the black edge of the camp.')
  },
  {
    id: 'forage', label: 'forage', text: '+1 food, +threat', show: s => s.unlocked.gather,
    run: s => patch(s, { food: s.food + 1, threat: s.threat + 1 }, 'Tracks cross your path. You return with roots.')
  },
  {
    id: 'trap', label: 'set traps', text: '5 wood → +1 trap', show: s => s.unlocked.gather, enabled: s => s.wood >= 5,
    run: s => patch(s, { wood: s.wood - 5, traps: s.traps + 1, unlocked: { ...s.unlocked, trap: true } }, 'A snare waits under leaves.')
  },
  {
    id: 'hut', label: 'raise huts', text: '12 wood, 4 food → +2 workers cap', show: s => s.traps >= 1, enabled: s => s.wood >= 12 && s.food >= 4,
    run: s => patch(s, { wood: s.wood - 12, food: s.food - 4, huts: s.huts + 1, unlocked: { ...s.unlocked, scout: true } }, 'Smoke curls from a new shelter.')
  },
  {
    id: 'scout', label: 'train scouts', text: '3 food → +1 scout', show: s => s.unlocked.scout, enabled: s => s.food >= 3 && workers(s) < workerCap(s),
    run: s => patch(s, { food: s.food - 3, scouts: s.scouts + 1, unlocked: { ...s.unlocked, command: true } }, 'A scout learns the paths between trees.')
  },
  {
    id: 'forager', label: 'assign foragers', text: '4 food → +1 forager', show: s => s.unlocked.scout, enabled: s => s.food >= 4 && workers(s) < workerCap(s),
    run: s => patch(s, { food: s.food - 4, foragers: s.foragers + 1 }, 'A quiet worker starts ranging for supplies.')
  },
  {
    id: 'sentry', label: 'post sentries', text: '5 food, 3 ember → +1 sentry', show: s => s.unlocked.command, enabled: s => s.food >= 5 && s.ember >= 3 && workers(s) < workerCap(s),
    run: s => patch(s, { food: s.food - 5, ember: s.ember - 3, sentries: s.sentries + 1 }, 'A spear point glints at the perimeter.')
  },
  {
    id: 'barracks', label: 'mark a command ground', text: '25 wood, 10 ember → RTS layer', show: s => s.unlocked.command, enabled: s => s.wood >= 25 && s.ember >= 10,
    run: s => patch(s, { wood: s.wood - 25, ember: s.ember - 10, barracks: s.barracks + 1 }, 'Orders become doctrine. The camp is now a front.')
  }
];

function patch(s, update, line) {
  return { ...s, ...update, log: [line, ...s.log].slice(0, 8) };
}

function workerCap(s) { return 2 + s.huts * 2 + s.barracks * 4; }
function workers(s) { return s.scouts + s.foragers + s.sentries; }

function advance(s) {
  let next = { ...s, tick: s.tick + 1 };
  if (s.unlocked.fire) next.ember += 1 + s.barracks;
  next.wood += s.foragers;
  next.food += Math.max(0, s.foragers - Math.floor(s.threat / 10));
  next.threat += Math.max(0, s.scouts ? 1 : 2) + s.barracks;

  const raidAt = 12 + s.sentries * 5;
  if (next.threat >= raidAt) {
    const defense = s.traps * 2 + s.sentries * 3 + s.barracks * 5;
    const pressure = Math.ceil(next.threat / 3);
    if (defense >= pressure) {
      next.traps = Math.max(0, next.traps - 1);
      next.food += 2;
      next.log = ['Shapes break on the traps. The camp holds.', ...s.log].slice(0, 8);
    } else {
      const loss = Math.min(next.wood, pressure - defense + 2);
      next.wood -= loss;
      next.ember = Math.max(0, next.ember - 2);
      next.log = [`A raid cuts through the dark. Lost ${loss} wood.`, ...s.log].slice(0, 8);
    }
    next.threat = Math.floor(next.threat / 3);
  }
  return next;
}

function App() {
  const [state, setState] = useState(initialState);
  const visibleActions = actions.filter(a => a.show(state));
  const phase = useMemo(() => {
    if (!state.unlocked.fire) return 'Dark room';
    if (!state.unlocked.command) return 'Camp survival';
    if (!state.barracks) return 'Border command';
    return 'Abstract RTS';
  }, [state]);

  return <main className="shell">
    <section className="hero panel">
      <p className="eyebrow">EMBER COMMAND</p>
      <h1>{state.unlocked.fire ? 'The fire is roaring.' : 'The room is dark.'}</h1>
      <p className="lede">A tiny abstract RTS: clicker survival grows into scouting, logistics, perimeter defense, and eventually command doctrine.</p>
      <div className="phase">{phase}</div>
    </section>

    <section className="grid">
      <div className="panel resources">
        <h2>Stores</h2>
        <Stat label="ember" value={state.ember} />
        <Stat label="wood" value={state.wood} />
        <Stat label="food" value={state.food} />
        <Stat label="threat" value={state.threat} danger />
      </div>

      <div className="panel actions">
        <h2>Orders</h2>
        {visibleActions.map(action => {
          const enabled = action.enabled ? action.enabled(state) : true;
          return <button key={action.id} disabled={!enabled} onClick={() => setState(action.run(state))}>
            <span>{action.label}</span><small>{action.text}</small>
          </button>;
        })}
        <button className="primary" onClick={() => setState(advance(state))}>
          <span>let time pass</span><small>resolve production + raids</small>
        </button>
      </div>

      <div className="panel forces">
        <h2>Camp</h2>
        <Stat label="workers" value={`${workers(state)} / ${workerCap(state)}`} />
        <Stat label="scouts" value={state.scouts} />
        <Stat label="foragers" value={state.foragers} />
        <Stat label="sentries" value={state.sentries} />
        <Stat label="traps" value={state.traps} />
        <Stat label="huts" value={state.huts} />
        <Stat label="command grounds" value={state.barracks} />
      </div>

      <div className="panel log">
        <h2>Signs</h2>
        {state.log.map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}
      </div>
    </section>
  </main>;
}

function Stat({ label, value, danger }) {
  return <div className={danger ? 'stat danger' : 'stat'}><span>{label}</span><strong>{value}</strong></div>;
}

createRoot(document.getElementById('root')).render(<App />);
