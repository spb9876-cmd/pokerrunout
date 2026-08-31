// Play mode: set the table once, then hand after hand until you reset.
// The dealer (game.js) runs the table, the coach (coach.js) grades you after
// every hand, and this file just draws it all and takes your clicks.

import { rankOf, suitOf, RANKS, SUIT_SYMBOLS } from './cards.js';
import { createSession, startHand, step, heroAct, potTotal } from './game.js';
import { gradeHand } from './coach.js';
import { ARCHETYPES, SETTINGS, STAGES, archetypeById, settingById, stageById, positionById } from './players.js';

const CONFIG_KEY = 'runout.play.v1';
const escape = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const isRed = (card) => suitOf(card) === 1 || suitOf(card) === 2;

let root = null;
let config = null;
let session = null;
let runToken = 0;
let awaiting = null; // the hero-turn event we are waiting on

/* ------------------------------------------------------------------- config */

function defaultConfig() {
  return {
    setting: 'home_cash',
    stage: 'early',
    currency: '$',
    smallBlind: 1,
    bigBlind: 2,
    heroStack: 200,
    villains: [
      { type: 'recreational', stack: 200 },
      { type: 'abc', stack: 200 },
      { type: 'tricky', stack: 200 },
    ],
  };
}

function loadConfig() {
  try {
    const saved = localStorage.getItem(CONFIG_KEY);
    if (saved) return JSON.parse(saved);
  } catch {
    /* fall through */
  }
  return defaultConfig();
}

function saveConfig() {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch {
    /* fine without it */
  }
}

const money = (n) => {
  const setting = settingById(config.setting);
  const v = Math.round(n * 100) / 100;
  return setting.format === 'tournament' ? `${v.toLocaleString()}` : `${config.currency}${v}`;
};

/* -------------------------------------------------------------------- setup */

function renderSetup() {
  const setting = settingById(config.setting);
  const tournament = setting.format === 'tournament';
  const rows = config.villains
    .map(
      (v, i) => `<div class="grid seat-row" data-index="${i}">
        <label class="field"><span>Opponent ${i + 1}</span>
          <select data-play="villain.${i}.type">${ARCHETYPES.map(
            (a) => `<option value="${a.id}"${a.id === v.type ? ' selected' : ''}>${escape(a.name)}</option>`
          ).join('')}</select>
        </label>
        <label class="field"><span>Their stack</span>
          <input type="number" inputmode="decimal" data-play="villain.${i}.stack" value="${v.stack}" min="1" />
        </label>
        <div class="field seat-remove"><span>&nbsp;</span><button type="button" class="danger" data-do="remove-villain" data-index="${i}">Remove</button></div>
      </div>
      <p class="archetype-note">${escape(archetypeById(v.type).tagline)}.</p>`
    )
    .join('');

  root.querySelector('#play-setup').innerHTML = `
    <header class="panel-head">
      <h2>Set the table</h2>
      <p class="hint">Pick where you are playing and who is sitting with you. Then it deals hand after hand —
      positions rotate, opponents act on their own cards the way their type would, and you get graded after
      every hand. Watch for the tells in the table talk; some players' bodies tell the truth and some do not.</p>
    </header>
    <div class="grid">
      <label class="field wide"><span>Where you are playing</span>
        <select data-play="setting">${SETTINGS.map((s) => `<option value="${s.id}"${s.id === config.setting ? ' selected' : ''}>${escape(s.name)}</option>`).join('')}</select>
      </label>
      ${
        tournament
          ? `<label class="field"><span>Stage</span><select data-play="stage">${STAGES.map((s) => `<option value="${s.id}"${s.id === config.stage ? ' selected' : ''}>${escape(s.name)}</option>`).join('')}</select></label>`
          : `<label class="field"><span>Currency</span><input type="text" data-play="currency" value="${escape(config.currency)}" maxlength="3" /></label>`
      }
      <label class="field"><span>Small blind</span><input type="number" inputmode="decimal" data-play="smallBlind" value="${config.smallBlind}" min="0.5" step="0.5" /></label>
      <label class="field"><span>Big blind</span><input type="number" inputmode="decimal" data-play="bigBlind" value="${config.bigBlind}" min="1" step="0.5" /></label>
      <label class="field"><span>Your stack</span><input type="number" inputmode="decimal" data-play="heroStack" value="${config.heroStack}" min="1" />
        <small class="hint">${(config.heroStack / (config.bigBlind || 1)).toFixed(0)} big blinds</small></label>
    </div>
    <h3 class="subhead">The table (${config.villains.length + 1} seats)</h3>
    ${rows}
    <button type="button" class="add" data-do="add-villain">+ Add an opponent</button>
    <div class="actions" style="margin-top:16px">
      <button type="button" class="primary" data-do="deal-in">Deal me in</button>
    </div>
    <p class="hint" style="margin-top:10px">${escape(setting.tagline)}. Stacks reset to these sizes each hand; the session keeps score.</p>`;
}

/* ------------------------------------------------------------------- table */

function seatBadge(seat, hand) {
  const revealed = hand.finished;
  const cardsHtml = seat.isHero || revealed
    ? seat.cards.map((c) => `<span class="mini${isRed(c) ? ' red' : ''}${!seat.isHero && seat.folded ? ' dim' : ''}">${RANKS[rankOf(c)]}${SUIT_SYMBOLS[suitOf(c)]}</span>`).join('')
    : seat.folded
      ? ''
      : '<span class="mini back">🂠</span><span class="mini back">🂠</span>';
  const state = seat.folded ? '<span class="seat-state folded">folded</span>' : seat.allIn ? '<span class="seat-state allin">all in</span>' : '';
  const bet = seat.streetPut > 0 && !hand.finished ? `<span class="seat-bet">${money(seat.streetPut)}</span>` : '';
  const acting = awaiting && !hand.finished && !seat.folded && awaiting.seat === seat.id;
  return `<div class="seat-card${seat.isHero ? ' hero' : ''}${seat.folded ? ' out' : ''}${acting ? ' acting' : ''}">
    <div class="seat-top">
      <span class="badge">${escape(positionById(seat.position).name)}</span>
      <span class="seat-name">${seat.isHero ? 'You' : escape(archetypeById(seat.type).name)}</span>
      ${seat.position === 'btn' || (hand.positions.length === 2 && seat.position === 'sb') ? '<span class="dealer" title="Dealer">D</span>' : ''}
    </div>
    <div class="seat-cards">${cardsHtml}</div>
    <div class="seat-bottom"><span class="seat-stack">${money(seat.stack)}</span>${bet}${state}</div>
  </div>`;
}

function renderTable() {
  const hand = session.hand;
  root.querySelector('#seats').innerHTML = hand.seats.map((s) => seatBadge(s, hand)).join('');
  const board = hand.board
    .map((c) => `<span class="board-card${isRed(c) ? ' red' : ''}"><span class="rank">${RANKS[rankOf(c)]}</span><span class="suit">${SUIT_SYMBOLS[suitOf(c)]}</span></span>`)
    .join('');
  root.querySelector('#board-area').innerHTML = `
    <div class="board-line">${board || '<span class="hint">Preflop</span>'}</div>
    <div class="pot-line">Pot: <strong>${money(potTotal(hand))}</strong> · ${escape(hand.street)}</div>`;
  renderSessionBar();
}

function renderSessionBar() {
  const hand = session.hand;
  const hero = hand?.seats.find((s) => s.isHero);
  const g = session.grades;
  const total = g.good + g.ok + g.mistake;
  const netClass = session.net > 0.001 ? 'up' : session.net < -0.001 ? 'down' : '';
  root.querySelector('#session-bar').innerHTML = `
    <span><strong>Hand #${session.handNumber}</strong>${hero ? ` · you are ${escape(positionById(hero.position).label.toLowerCase())}` : ''}</span>
    <span>Session: <strong class="${netClass}">${session.net >= 0 ? '+' : '−'}${money(Math.abs(session.net))}</strong> over ${session.handsPlayed} hand${session.handsPlayed === 1 ? '' : 's'}</span>
    <span title="decisions the coach agreed with / close calls / clear mistakes">Decisions: <strong>${g.good}</strong> good · <strong>${g.ok}</strong> close · <strong>${g.mistake}</strong> mistake${g.mistake === 1 ? '' : 's'}${total ? '' : ' (yet)'}</span>
    <button type="button" class="ghost" data-do="end-session">Change setup</button>`;
}

function appendLog(text, cls = '') {
  const log = root.querySelector('#hand-log');
  const line = document.createElement('p');
  line.className = `log-line ${cls}`;
  const dash = text.indexOf(' — ');
  if (cls === 'tell' && dash > 0) {
    line.innerHTML = `${escape(text.slice(0, dash))} — <em class="tell-text">${escape(text.slice(dash + 3))}</em>`;
  } else {
    line.textContent = text;
  }
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

/* --------------------------------------------------------------- the loop */

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runHand() {
  const token = ++runToken;
  awaiting = null;
  renderActionPanel(null);
  for (;;) {
    if (token !== runToken) return;
    const ev = step(session);
    if (ev.kind === 'action') {
      appendLog(ev.text, ev.tell ? 'tell' : '');
      renderTable();
      await delay(ev.tell ? 900 : 450 + Math.random() * 250);
    } else if (ev.kind === 'street') {
      appendLog(`— ${ev.street[0].toUpperCase()}${ev.street.slice(1)} —`, 'street-line');
      renderTable();
      await delay(650);
    } else if (ev.kind === 'hero-turn') {
      awaiting = ev;
      renderTable();
      renderActionPanel(ev);
      return;
    } else if (ev.kind === 'over') {
      awaiting = null;
      renderTable();
      renderActionPanel(null); // nothing left to wait for
      finishHand(ev.results);
      return;
    }
  }
}

function renderActionPanel(ev) {
  const panel = root.querySelector('#action-panel');
  if (!session?.hand || session.hand.finished) {
    panel.innerHTML = '';
    return;
  }
  if (!ev) {
    panel.innerHTML = '<p class="hint">The action is going around…</p>';
    return;
  }
  const buttons = [];
  if (ev.canFold) buttons.push(`<button type="button" class="ghost act-fold" data-act="fold">Fold</button>`);
  buttons.push(
    ev.canCheck
      ? `<button type="button" data-act="check">Check</button>`
      : `<button type="button" data-act="call">Call ${money(ev.call)}</button>`
  );
  for (const size of ev.sizes) {
    buttons.push(
      `<button type="button" class="act-raise" data-act="raise" data-to="${size.to}">${
        session.hand.currentBet > 0 ? 'Raise' : 'Bet'
      } ${money(size.to)} <small>${escape(size.label)}</small></button>`
    );
  }
  panel.innerHTML = `
    <p class="turn-line">Your turn — ${ev.toCall > 0 ? `${money(ev.toCall)} to call` : 'no bet to you'} · pot ${money(ev.pot)} · ${money(ev.stack)} behind</p>
    <div class="action-buttons">${buttons.join('')}</div>`;
}

function finishHand(results) {
  appendLog(results.winnersText, 'result-line');
  const coach = gradeHand(session, session.hand);
  renderSessionBar();
  renderAnalysis(coach, results);
}

/* ---------------------------------------------------------------- analysis */

function renderAnalysis(coach, results) {
  const gradeIcon = { good: '✔', ok: '≈', mistake: '✘' };

  const decisions = coach.decisions.length
    ? coach.decisions
        .map(
          (d) => `<div class="decision ${d.grade ?? ''}">
          <div class="decision-head"><span class="grade-mark">${gradeIcon[d.grade] ?? '·'}</span>
            <strong>${escape(cap(d.street))}${d.hand ? ` — you had ${escape(d.hand)}` : ''}</strong></div>
          <p>${escape(d.verdict)}</p>
          ${d.detail ? `<p class="hint">${escape(d.detail)}</p>` : ''}
        </div>`
        )
        .join('')
    : '<p class="hint">No decisions reached you this hand.</p>';

  const tells = coach.tells.length
    ? coach.tells.map((t) => `<div class="note tell-decode"><strong>${escape(t.position)} (${escape(t.type)})</strong>: ${escape(t.decoded)}</div>`).join('')
    : '<p class="hint">No tells this hand.</p>';

  const reveal = coach.reveal
    .map(
      (r) => `<div class="runout-street">
      <strong>${r.isHero ? 'You' : escape(positionById(r.position).name)}</strong>
      <span class="mini-cards">${r.cards.map((c) => `<span class="mini${isRed(c) ? ' red' : ''}${r.folded ? ' dim' : ''}">${RANKS[rankOf(c)]}${SUIT_SYMBOLS[suitOf(c)]}</span>`).join('')}</span>
      <span class="pct" style="font-weight:400;color:var(--ink-dim)">${r.folded ? 'folded' : escape(r.handName ?? '')}</span>
    </div>`
    )
    .join('');

  const netClass = results.heroNet > 0.001 ? 'up' : results.heroNet < -0.001 ? 'down' : '';
  root.querySelector('#hand-analysis').innerHTML = `
    <section class="panel analysis">
      <header class="panel-head"><h2>How you did</h2>
        <p class="hint">${escape(coach.summary.process)}</p></header>
      <p class="outcome ${netClass}">${escape(coach.summary.outcome)} ${escape(results.winnersText)}</p>
      <h3 class="subhead">Your decisions</h3>
      ${decisions}
      <h3 class="subhead">The tells, decoded</h3>
      ${tells}
      <h3 class="subhead">Everyone's cards</h3>
      ${reveal}
      <div class="actions" style="margin-top:14px">
        <button type="button" class="primary" data-do="next-hand">Next hand</button>
        <button type="button" class="ghost" data-do="end-session">Change setup</button>
      </div>
    </section>`;
  root.querySelector('#hand-analysis').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

const cap = (s) => s[0].toUpperCase() + s.slice(1);

/* ----------------------------------------------------------------- wiring */

function showGame(inGame) {
  root.querySelector('#play-setup').hidden = inGame;
  root.querySelector('#play-game').hidden = !inGame;
}

function nextHand() {
  root.querySelector('#hand-log').innerHTML = '';
  root.querySelector('#hand-analysis').innerHTML = '';
  startHand(session);
  const hero = session.hand.seats.find((s) => s.isHero);
  appendLog(`Hand #${session.handNumber}. You are ${positionById(hero.position).label.toLowerCase()}.`, 'street-line');
  renderTable();
  runHand();
}

function onInput(event) {
  const el = event.target.closest('[data-play]');
  if (!el) return;
  const path = el.dataset.play.split('.');
  const numeric = ['smallBlind', 'bigBlind', 'heroStack', 'stack'];
  const value = numeric.includes(path.at(-1)) ? Number(el.value) : el.value;
  if (path[0] === 'villain') config.villains[Number(path[1])][path[2]] = value;
  else config[path[0]] = value;
  saveConfig();
  if (el.tagName === 'SELECT') renderSetup(); // taglines and stage field follow the selects
}

function onClick(event) {
  const doBtn = event.target.closest('[data-do]');
  if (doBtn) {
    const action = doBtn.dataset.do;
    if (action === 'add-villain') {
      if (config.villains.length < 8) config.villains.push({ type: settingById(config.setting).defaultType, stack: config.heroStack });
      saveConfig();
      renderSetup();
    } else if (action === 'remove-villain') {
      config.villains.splice(Number(doBtn.dataset.index), 1);
      if (config.villains.length === 0) config.villains.push({ type: 'unknown', stack: config.heroStack });
      saveConfig();
      renderSetup();
    } else if (action === 'deal-in') {
      try {
        session = createSession(structuredClone(config));
      } catch (err) {
        alert(err.message);
        return;
      }
      showGame(true);
      nextHand();
    } else if (action === 'next-hand') {
      nextHand();
    } else if (action === 'end-session') {
      runToken++;
      session = null;
      awaiting = null;
      showGame(false);
      renderSetup();
    }
    return;
  }

  const act = event.target.closest('[data-act]');
  if (act && awaiting) {
    const kind = act.dataset.act;
    const ev = awaiting;
    awaiting = null;
    try {
      if (kind === 'raise') heroAct(session, 'raise', Number(act.dataset.to));
      else heroAct(session, kind);
    } catch (err) {
      awaiting = ev;
      appendLog(`(${err.message})`, 'street-line');
      return;
    }
    const last = session.hand.log.at(-1);
    appendLog(last.text, 'you-line');
    renderTable();
    runHand();
  }
}

export function initPlay(rootEl) {
  root = rootEl;
  config = loadConfig();
  root.innerHTML = `
    <section class="panel" id="play-setup"></section>
    <div id="play-game" hidden>
      <div class="panel session-bar" id="session-bar"></div>
      <div class="layout play-layout">
        <div class="builder">
          <section class="panel" id="table-panel">
            <div id="seats" class="seats"></div>
            <div id="board-area" class="board-area"></div>
          </section>
          <section class="panel" id="action-panel"></section>
          <section class="panel log-panel">
            <header class="panel-head"><h2>The table talk</h2>
            <p class="hint">Tells show up in here. Some of them are even true.</p></header>
            <div id="hand-log" class="hand-log"></div>
          </section>
        </div>
        <div class="results"><div id="hand-analysis"></div></div>
      </div>
    </div>`;
  renderSetup();
  root.addEventListener('click', onClick);
  root.addEventListener('change', onInput);
  root.addEventListener('input', (e) => {
    if (e.target.matches('input')) onInput(e);
  });
}
