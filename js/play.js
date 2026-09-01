// Play mode: set the table once, then hand after hand until you reset.
// The dealer (game.js) runs the table, the coach (coach.js) grades you after
// every hand, and this file draws the felt and takes your clicks.

import { rankOf, suitOf, RANKS, SUIT_SYMBOLS } from './cards.js';
import { createSession, startHand, step, heroAct, potTotal } from './game.js';
import { gradeHand } from './coach.js';
import { ARCHETYPES, SETTINGS, STAGES, MOODS, archetypeById, settingById, positionById, moodById, hasMoods } from './players.js';

const CONFIG_KEY = 'runout.play.v1';
const escape = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const isRed = (card) => suitOf(card) === 1 || suitOf(card) === 2;

let root = null;
let config = null;
let session = null;
let runToken = 0;
let awaiting = null; // the hero-turn event we are waiting on
let shownBoard = 0; // how many board cards have already animated in
let pace = 'relaxed'; // relaxed | quick | step
let advanceResolver = null; // pending "next action" click in step mode

try {
  pace = localStorage.getItem('runout.pace') || 'relaxed';
} catch {
  /* default stands */
}

const PACE_DELAYS = {
  relaxed: { action: () => 950 + Math.random() * 350, tell: 1700, street: 1200 },
  quick: { action: () => 420 + Math.random() * 220, tell: 900, street: 650 },
};

function unblockAdvance() {
  const resolve = advanceResolver;
  advanceResolver = null;
  resolve?.();
}

/* ------------------------------------------------------------------- config */

function defaultConfig() {
  return {
    setting: 'home_cash',
    stage: 'early',
    currency: '$',
    smallBlind: 1,
    bigBlind: 2,
    heroStack: 200,
    mood: 'early',
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
        <label class="field"><span>Their buy-in</span>
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
      positions rotate, stacks carry over, and busting means buying back in. Opponents act on their own cards
      the way their type would, and losing a big pot can put them on tilt. Watch the table talk: tells show up
      there, and some of them are even true.</p>
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
      ${
        hasMoods(setting)
          ? `<label class="field wide"><span>How deep into the night</span>
              <select data-play="mood">${MOODS.map((m) => `<option value="${m.id}"${m.id === (config.mood ?? 'early') ? ' selected' : ''}>${escape(m.name)}</option>`).join('')}</select>
              <small class="hint">${escape(moodById(config.mood ?? 'early').note)}</small></label>`
          : ''
      }
      <label class="field"><span>Small blind</span><input type="number" inputmode="decimal" data-play="smallBlind" value="${config.smallBlind}" min="0.5" step="0.5" /></label>
      <label class="field"><span>Big blind</span><input type="number" inputmode="decimal" data-play="bigBlind" value="${config.bigBlind}" min="1" step="0.5" /></label>
      <label class="field"><span>Your buy-in</span><input type="number" inputmode="decimal" data-play="heroStack" value="${config.heroStack}" min="1" />
        <small class="hint">${(config.heroStack / (config.bigBlind || 1)).toFixed(0)} big blinds</small></label>
    </div>
    <h3 class="subhead">The table (${config.villains.length + 1} seats)</h3>
    <div class="grid randomize-row">
      <label class="field"><span>Don't feel like picking?</span>
        <select id="random-count">${[2, 3, 4, 5, 6, 7, 8, 9]
          .map((n) => `<option value="${n}"${n === config.villains.length + 1 ? ' selected' : ''}>${n} players</option>`)
          .join('')}</select>
      </label>
      <div class="field"><span>&nbsp;</span>
        <button type="button" data-do="randomize">🎲 Randomize the table</button>
      </div>
    </div>
    ${rows}
    <button type="button" class="add" data-do="add-villain">+ Add an opponent</button>
    <div class="actions" style="margin-top:16px">
      <button type="button" class="primary" data-do="deal-in">Deal me in</button>
    </div>
    <p class="hint" style="margin-top:10px">${escape(setting.tagline)}.</p>`;
}

/* ------------------------------------------------------------ the felt */

// Fixed chairs: player 0 (you) at the bottom, the rest going around the oval.
// The button badge is what moves from hand to hand, like at a real table.
function chairAngle(index, count) {
  return ((90 + (index * 360) / count) * Math.PI) / 180;
}

function chairSpot(index, count, rx, ry) {
  const a = chairAngle(index, count);
  return { x: 50 + rx * Math.cos(a), y: 50 + ry * Math.sin(a) };
}

function cardFace(card, cls = 'table-card') {
  return `<span class="${cls}${isRed(card) ? ' red' : ''}"><span class="rank">${RANKS[rankOf(card)]}</span><span class="suit">${SUIT_SYMBOLS[suitOf(card)]}</span></span>`;
}

const cardBack = (cls = 'table-card') => `<span class="${cls} back" aria-hidden="true"></span>`;

function renderSeats() {
  const hand = session.hand;
  const n = hand.seats.length;
  const rimX = (root.clientWidth || 1000) < 700 ? 38 : 42; // hug the rim tighter on a phone
  const winners = hand.finished && hand.results ? new Set(hand.results.pots.flatMap((p) => p.winners)) : new Set();

  const seatsHtml = hand.seats
    .map((seat) => {
      const { x, y } = chairSpot(seat.id, n, rimX, 44);
      const acting = awaiting && !hand.finished && awaiting.seat === seat.id;
      const showFace = seat.isHero || (hand.finished && !seat.folded);
      const cardsHtml = seat.isHero
        ? seat.cards.map((c) => cardFace(c, 'table-card hero-card')).join('')
        : showFace
          ? seat.cards.map((c) => cardFace(c, 'table-card peek')).join('')
          : seat.folded
            ? ''
            : cardBack('table-card peek') + cardBack('table-card peek');
      const steaming = !seat.isHero && (seat.tilt ?? 0) >= 0.25;
      return `<div class="table-seat${seat.isHero ? ' hero' : ''}${seat.folded ? ' out' : ''}${acting ? ' acting' : ''}${
        winners.has(seat.id) ? ' winner' : ''
      }" style="left:${x}%;top:${y}%">
        <div class="peek-cards">${cardsHtml}</div>
        <div class="plaque">
          <div class="plaque-row">
            <span class="pos-pip">${escape(positionById(seat.position).name)}</span>
            <span class="seat-name">${seat.isHero ? 'You' : escape(archetypeById(seat.type).name)}</span>
            ${steaming ? '<span class="steam" title="Steaming after a big loss — expect wider, angrier play">🔥</span>' : ''}
          </div>
          <div class="plaque-row sub">
            <span class="seat-stack">${money(seat.stack)}</span>
            ${seat.folded ? '<span class="seat-state folded">folded</span>' : seat.allIn ? '<span class="seat-state allin">all in</span>' : ''}
          </div>
        </div>
      </div>`;
    })
    .join('');

  // Bets sit between each chair and the middle; the dealer button rides the rim.
  let chipsHtml = '';
  for (const seat of hand.seats) {
    if (seat.streetPut > 0 && !hand.finished) {
      const { x, y } = chairSpot(seat.id, n, 29, 31);
      chipsHtml += `<div class="bet-bubble" style="left:${x}%;top:${y}%"><span class="chip"></span>${money(seat.streetPut)}</div>`;
    }
  }
  const buttonSeat = hand.seats.find((s) => s.position === (n === 2 ? 'sb' : 'btn'));
  if (buttonSeat) {
    const a = chairAngle(buttonSeat.id, n);
    const x = 50 + 36 * Math.cos(a + 0.28);
    const y = 50 + 34 * Math.sin(a + 0.28);
    chipsHtml += `<div class="dealer-button" style="left:${x}%;top:${y}%" title="Dealer">D</div>`;
  }

  root.querySelector('#seats').innerHTML = seatsHtml;
  root.querySelector('#chips-layer').innerHTML = chipsHtml;
}

function renderBoard() {
  const hand = session.hand;
  const streetChip = hand.street === 'preflop' ? 'PREFLOP' : hand.street.toUpperCase();
  let slots = '';
  for (let i = 0; i < 5; i++) {
    const card = hand.board[i];
    if (card !== undefined) {
      slots += cardFace(card, `table-card board${i >= shownBoard ? ' fresh' : ''}`);
    } else {
      const label = i < 3 ? 'flop' : i === 3 ? 'turn' : 'river';
      slots += `<span class="table-card board ghost" data-label="${label}"><span class="ghost-plus">+</span></span>`;
    }
  }
  shownBoard = hand.board.length;
  root.querySelector('#board-area').innerHTML = `
    <div class="board-title">BOARD <span class="street-chip">${escape(streetChip)}</span></div>
    <div class="board-cards">${slots}</div>
    <div class="pot-plate">Pot <strong>${money(potTotal(hand))}</strong></div>`;
}

function renderTable() {
  renderSeats();
  renderBoard();
  renderSessionBar();
}

function renderSessionBar() {
  const hand = session.hand;
  const hero = hand?.seats.find((s) => s.isHero);
  const g = session.grades;
  const invested = session.invested[0];
  const rebuys = session.rebuys[0];
  const netClass = session.net > 0.001 ? 'up' : session.net < -0.001 ? 'down' : '';
  root.querySelector('#session-bar').innerHTML = `
    <span><strong>Hand #${session.handNumber}</strong>${hero ? ` · ${escape(positionById(hero.position).label.toLowerCase())}` : ''}</span>
    <span>Stack: <strong>${money(session.stacks[0])}</strong> · in for ${money(invested)}${rebuys ? ` (${rebuys + 1} buy-ins)` : ''}</span>
    <span>Session: <strong class="${netClass}">${session.net >= 0 ? '+' : '−'}${money(Math.abs(session.net))}</strong> over ${session.handsPlayed} hand${session.handsPlayed === 1 ? '' : 's'}</span>
    <span title="decisions the coach agreed with / close calls / clear mistakes"><strong>${g.good}</strong> good · <strong>${g.ok}</strong> close · <strong>${g.mistake}</strong> mistake${g.mistake === 1 ? '' : 's'}</span>
    ${hand?.finished ? '<button type="button" class="primary bar-next" data-do="next-hand">Next hand</button>' : ''}
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

async function pause(kind, hasTell) {
  if (pace === 'step') {
    renderActionPanel(null); // shows the "next action" button
    await new Promise((resolve) => {
      advanceResolver = resolve;
    });
    return;
  }
  const speeds = PACE_DELAYS[pace] ?? PACE_DELAYS.relaxed;
  await delay(kind === 'street' ? speeds.street : hasTell ? speeds.tell : speeds.action());
}

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
      await pause('action', !!ev.tell);
    } else if (ev.kind === 'street') {
      appendLog(`— ${ev.street[0].toUpperCase()}${ev.street.slice(1)} —`, 'street-line');
      renderTable();
      await pause('street', false);
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
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  if (!ev) {
    const hero = session.hand.seats.find((s) => s.isHero);
    const stepButton = pace === 'step' ? '<button type="button" class="advance" data-do="advance">▸ Next action</button>' : '';
    const skipButton = hero.folded ? '<button type="button" class="ghost" data-do="skip-hand">Skip to the result</button>' : '';
    const hint = hero.folded
      ? 'You folded — the rest of the hand plays out.'
      : pace === 'step'
        ? 'Step through at your own speed.'
        : 'The action is going around…';
    panel.innerHTML = `<div class="fold-wait"><p class="hint">${hint}</p>${stepButton}${skipButton}</div>`;
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
  const custom =
    ev.sizes.length > 0
      ? `<div class="custom-bet">
          <input type="number" id="custom-amount" inputmode="decimal" min="${ev.minRaiseTo}" max="${ev.maxTo}"
            step="${session.config.smallBlind}" placeholder="${session.hand.currentBet > 0 ? 'Raise to…' : 'Bet…'}" />
          <button type="button" data-act="raise-custom">${session.hand.currentBet > 0 ? 'Raise' : 'Bet'}</button>
          <span class="hint">${money(ev.minRaiseTo)}–${money(ev.maxTo)}</span>
        </div>`
      : '';
  panel.innerHTML = `
    <p class="turn-line">Your turn — ${ev.toCall > 0 ? `${money(ev.toCall)} to call` : 'no bet to you'} · pot ${money(ev.pot)} · ${money(ev.stack)} behind</p>
    <div class="action-buttons">${buttons.join('')}</div>${custom}`;
}

/** Play the rest of the hand out instantly — used after the hero folds. */
function fastForwardHand() {
  if (!session?.hand || session.hand.finished) return;
  runToken++; // the paced loop bails out at its next tick
  awaiting = null;
  let guard = 0;
  for (;;) {
    if (++guard > 500) break;
    const ev = step(session);
    if (ev.kind === 'action') {
      appendLog(ev.text, ev.tell ? 'tell' : '');
    } else if (ev.kind === 'street') {
      appendLog(`— ${ev.street[0].toUpperCase()}${ev.street.slice(1)} —`, 'street-line');
    } else if (ev.kind === 'hero-turn') {
      // Cannot happen once the hero has folded, but never spin on it.
      awaiting = ev;
      renderTable();
      renderActionPanel(ev);
      return;
    } else if (ev.kind === 'over') {
      renderTable();
      renderActionPanel(null);
      finishHand(ev.results);
      return;
    }
  }
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

  const steam = coach.steam?.length
    ? `<h3 class="subhead">Tilt at the table</h3>${coach.steam.map((line) => `<div class="note tell-decode">🔥 ${escape(line)}</div>`).join('')}`
    : '';

  const reveal = coach.reveal
    .map(
      (r) => `<div class="runout-street">
      <strong>${r.isHero ? 'You' : escape(positionById(r.position).name)}</strong>
      <span class="mini-cards">${r.cards.map((c) => `<span class="mini${isRed(c) ? ' red' : ''}${r.folded ? ' dim' : ''}">${RANKS[rankOf(c)]}${SUIT_SYMBOLS[suitOf(c)]}</span>`).join('')}</span>
      <span class="pct" style="font-weight:400;color:var(--ink-dim)">${r.folded ? 'folded' : escape(r.handName ?? '')}${r.tilt >= 0.25 ? ' · 🔥' : ''}</span>
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
      ${steam}
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

function syncMoodControl() {
  const wrap = root.querySelector('#mood-wrap');
  if (!session) {
    wrap.hidden = true;
    return;
  }
  const applicable = hasMoods(settingById(session.config.setting));
  wrap.hidden = !applicable;
  if (applicable) root.querySelector('#mood-select').value = session.config.mood ?? 'early';
}

function nextHand() {
  syncMoodControl();
  root.querySelector('#hand-log').innerHTML = '';
  root.querySelector('#hand-analysis').innerHTML = '';
  shownBoard = 0;
  startHand(session);
  const hero = session.hand.seats.find((s) => s.isHero);
  appendLog(`Hand #${session.handNumber}. You are ${positionById(hero.position).label.toLowerCase()}.`, 'street-line');
  for (const entry of session.hand.log) {
    if (entry.kind === 'rebuy') appendLog(entry.text, 'street-line');
    if (entry.kind === 'tilt') appendLog(entry.text, 'tell');
  }
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
    if (action === 'randomize') {
      const total = Number(root.querySelector('#random-count')?.value ?? 6);
      const pool = ARCHETYPES.filter((a) => a.id !== 'unknown');
      config.villains = Array.from({ length: Math.max(1, total - 1) }, () => ({
        type: pool[Math.floor(Math.random() * pool.length)].id,
        stack: config.heroStack,
      }));
      saveConfig();
      renderSetup();
      return;
    }
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
      unblockAdvance();
      nextHand();
    } else if (action === 'advance') {
      unblockAdvance();
    } else if (action === 'skip-hand') {
      unblockAdvance();
      fastForwardHand();
    } else if (action === 'end-session') {
      runToken++;
      unblockAdvance();
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
      if (kind === 'raise-custom') {
        const input = root.querySelector('#custom-amount');
        const raw = Number(input?.value);
        if (!raw || Number.isNaN(raw)) {
          awaiting = ev;
          input?.focus();
          return;
        }
        const to = Math.min(Math.max(raw, ev.minRaiseTo), ev.maxTo);
        heroAct(session, 'raise', to);
      } else if (kind === 'raise') {
        heroAct(session, 'raise', Number(act.dataset.to));
      } else {
        heroAct(session, kind);
      }
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
      <div class="game-layout">
        <div class="table-column">
          <div class="table-stage">
            <div class="felt"><div class="felt-ring"></div></div>
            <div class="board-center" id="board-area"></div>
            <div id="chips-layer"></div>
            <div id="seats"></div>
          </div>
          <section class="panel" id="action-panel"></section>
        </div>
        <div class="side-column">
          <section class="panel log-panel">
            <header class="panel-head log-head"><div><h2>The table talk</h2>
            <p class="hint">Tells and tilt show up in here. Some of it is even true.</p></div>
            <label class="pace-label"><span>Pace</span>
              <select id="pace-select">
                <option value="relaxed">Relaxed</option>
                <option value="quick">Quick</option>
                <option value="step">Tap through</option>
              </select>
            </label>
            <label class="pace-label" id="mood-wrap" hidden><span>The night</span>
              <select id="mood-select">${MOODS.map((m) => `<option value="${m.id}">${escape(m.name)}</option>`).join('')}</select>
            </label></header>
            <div id="hand-log" class="hand-log"></div>
          </section>
          <div id="hand-analysis"></div>
        </div>
      </div>
    </div>`;
  renderSetup();
  const paceSelect = root.querySelector('#pace-select');
  paceSelect.value = pace;
  paceSelect.addEventListener('change', () => {
    pace = paceSelect.value;
    try {
      localStorage.setItem('runout.pace', pace);
    } catch {
      /* fine */
    }
    if (pace !== 'step') unblockAdvance(); // a paused loop resumes at the new speed
  });
  const moodSelect = root.querySelector('#mood-select');
  moodSelect.addEventListener('change', () => {
    const mood = moodById(moodSelect.value);
    config.mood = mood.id;
    saveConfig();
    if (session) {
      session.config.mood = mood.id;
      appendLog(`— The night moves on: ${mood.name.toLowerCase()}. —`, 'tell');
    }
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'custom-amount') {
      root.querySelector('[data-act="raise-custom"]')?.click();
    }
  });
  root.addEventListener('click', onClick);
  root.addEventListener('change', onInput);
  root.addEventListener('input', (e) => {
    if (e.target.matches('input')) onInput(e);
  });
}
