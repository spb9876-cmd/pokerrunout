// Runout — the browser app. Builds a spot, hands it to the engine, renders the read.

import { parseCards, cardName, rankOf, suitOf, RANKS, SUIT_SYMBOLS, deckWithout } from './cards.js';
import { evaluate, describe } from './evaluator.js';
import { equityVsRanges } from './equity.js';
import { analyse, streetOf } from './engine.js';
import { ARCHETYPES, SETTINGS, STAGES, archetypeById, settingById, stageById, positionById, seatsForTableSize } from './players.js';
import { EXAMPLES } from './examples.js';

const STORAGE_KEY = 'runout.spot.v1';
const $ = (sel) => document.querySelector(sel);
const escape = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const isRed = (card) => suitOf(card) === 1 || suitOf(card) === 2;

let nextSeatId = 1;
let state = null;
let lastReport = null;
let lastSpot = null;
let pickerSlot = null;
let exampleIndex = 0;

/* ------------------------------------------------------------------ state */

function blankSpot() {
  return {
    setting: 'casino_cash',
    stage: 'early',
    currency: '$',
    smallBlind: 2,
    bigBlind: 5,
    tableSize: 6,
    hero: { position: 'btn', cards: [], stack: 500 },
    villains: [],
    board: [],
    pot: 0,
    toCall: 0,
  };
}

function addVillain(spot, over = {}) {
  const taken = new Set([spot.hero.position, ...spot.villains.map((v) => v.position)]);
  const free = seatsForTableSize(spot.tableSize).find((p) => !taken.has(p)) ?? 'bb';
  spot.villains.push({
    id: nextSeatId++,
    position: free,
    type: settingById(spot.setting).defaultType,
    stack: spot.hero.stack,
    role: 'called',
    action: 'checked',
    customRange: '',
    ...over,
  });
}

/** Everything the engine needs, derived from the form state. */
function toEngineSpot() {
  const pot = Number(state.pot) || 0;
  const toCall = Number(state.toCall) || 0;
  return {
    ...state,
    pot,
    toCall,
    betRatio: pot > 0 ? toCall / pot : 0.6,
    hero: { ...state.hero, stack: Number(state.hero.stack) || 0 },
    villains: state.villains.map((v) => ({ ...v, stack: Number(v.stack) || 0 })),
  };
}

/* ------------------------------------------------------------- persistence */

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* private browsing or a full quota — the app works fine without it */
  }
}

function encodeSpot(spot) {
  const compact = { ...spot, hero: { ...spot.hero, cards: spot.hero.cards.map(cardName) }, board: spot.board.map(cardName) };
  const bytes = new TextEncoder().encode(JSON.stringify(compact));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeSpot(text) {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const spot = JSON.parse(new TextDecoder().decode(bytes));
  spot.hero.cards = spot.hero.cards.map((c) => parseCards(c)[0]);
  spot.board = spot.board.map((c) => parseCards(c)[0]);
  spot.villains.forEach((v) => {
    v.id = nextSeatId++;
  });
  return spot;
}

function load() {
  if (location.hash.startsWith('#s=')) {
    try {
      return decodeSpot(location.hash.slice(3));
    } catch {
      toast('That shared link could not be read — starting fresh.');
    }
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const spot = JSON.parse(saved);
      spot.villains.forEach((v) => {
        v.id = nextSeatId++;
      });
      return spot;
    }
  } catch {
    /* fall through to the example */
  }
  return null;
}

/* ---------------------------------------------------------------- controls */

function field(label, inner, opts = {}) {
  return `<label class="field${opts.wide ? ' wide' : ''}"><span>${escape(label)}</span>${inner}${
    opts.hint ? `<small class="hint">${escape(opts.hint)}</small>` : ''
  }</label>`;
}

function select(path, options, value) {
  const opts = options
    .map((o) => `<option value="${escape(o.value)}"${o.value === value ? ' selected' : ''}>${escape(o.label)}</option>`)
    .join('');
  return `<select data-field="${escape(path)}">${opts}</select>`;
}

function number(path, value, opts = {}) {
  return `<input type="number" inputmode="decimal" data-field="${escape(path)}" value="${escape(value ?? 0)}" min="${
    opts.min ?? 0
  }" step="${opts.step ?? 1}" />`;
}

function cardSlot(slot, card) {
  if (card === undefined || card === null) {
    return `<button type="button" class="card-slot" data-action="pick" data-slot="${slot}" aria-label="Choose a card">+</button>`;
  }
  return `<button type="button" class="card-slot filled${isRed(card) ? ' red' : ''}" data-action="pick" data-slot="${slot}"><span class="rank">${
    RANKS[rankOf(card)]
  }</span><span class="suit">${SUIT_SYMBOLS[suitOf(card)]}</span></button>`;
}

/* ----------------------------------------------------------------- render */

function renderSetting() {
  const setting = settingById(state.setting);
  $('#setting-tagline').textContent = setting.tagline;
  const tournament = setting.format === 'tournament';
  $('#setting-fields').innerHTML = [
    field(
      'Where you are playing',
      select('setting', SETTINGS.map((s) => ({ value: s.id, label: s.name })), state.setting),
      { wide: true }
    ),
    tournament
      ? field('Stage', select('stage', STAGES.map((s) => ({ value: s.id, label: s.name })), state.stage))
      : field('Currency', `<input type="text" data-field="currency" value="${escape(state.currency)}" maxlength="3" />`),
    field(tournament ? 'Small blind (chips)' : 'Small blind', number('smallBlind', state.smallBlind, { step: 0.5 })),
    field(tournament ? 'Big blind (chips)' : 'Big blind', number('bigBlind', state.bigBlind, { step: 0.5 })),
    field(
      'Players at the table',
      select('tableSize', [2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ value: String(n), label: `${n}-handed` })), String(state.tableSize))
    ),
  ].join('');
  $('#setting-notes').innerHTML = setting.notes.map((n) => `<li>${escape(n)}</li>`).join('');
}

function readableHand() {
  const [a, b] = state.hero.cards;
  if (a === undefined || b === undefined) return '';
  if (rankOf(a) === rankOf(b)) return `pocket ${RANKS[rankOf(a)]}s`;
  const hi = RANKS[Math.max(rankOf(a), rankOf(b))];
  const lo = RANKS[Math.min(rankOf(a), rankOf(b))];
  return `${hi}${lo} ${suitOf(a) === suitOf(b) ? 'suited' : 'offsuit'}`;
}

function renderHero() {
  const seats = seatsForTableSize(state.tableSize);
  const setting = settingById(state.setting);
  const stackHint = `${(Number(state.hero.stack) / (Number(state.bigBlind) || 1)).toFixed(0)} big blinds`;
  $('#hero-fields').innerHTML = [
    field('Your seat', select('hero.position', seats.map((p) => ({ value: p, label: positionById(p).label })), state.hero.position)),
    field(setting.format === 'tournament' ? 'Your stack (chips)' : 'Your stack', number('hero.stack', state.hero.stack), {
      hint: stackHint,
    }),
    `<div class="field wide"><span>Your hand</span><div class="card-row">${cardSlot('hero:0', state.hero.cards[0])}${cardSlot(
      'hero:1',
      state.hero.cards[1]
    )}<span class="hint" style="margin-left:8px">${
      state.hero.cards.length === 2 ? escape(readableHand()) : 'Tap a card to choose it'
    }</span></div></div>`,
  ].join('');
}

const ROLES = [
  { value: 'raised', label: 'Raised preflop' },
  { value: '3bet', label: 'Three-bet preflop' },
  { value: 'called', label: 'Called a raise' },
  { value: 'limped', label: 'Limped in' },
  { value: 'blind', label: 'Defended their blind' },
];

const STREET_ACTIONS = [
  { value: 'checked', label: 'Checked to you' },
  { value: 'called', label: 'Called your bet' },
  { value: 'bet', label: 'Bet into you' },
  { value: 'raised', label: 'Raised you' },
];

function renderVillains() {
  const seats = seatsForTableSize(state.tableSize);
  const preflop = state.board.length === 0;
  if (state.villains.length === 0) {
    $('#villain-list').innerHTML = '<p class="hint">No opponents yet. A hand needs at least one.</p>';
    return;
  }
  $('#villain-list').innerHTML = state.villains
    .map((v) => {
      const arch = archetypeById(v.type);
      return `<div class="seat" data-seat="${v.id}">
        <div class="seat-head">
          <div class="seat-title">${escape(positionById(v.position).label)} <span class="badge">${escape(arch.name)}</span></div>
          <button type="button" class="danger" data-action="remove-villain" data-id="${v.id}">Remove</button>
        </div>
        <div class="grid">
          ${field(
            'Seat',
            select(
              `villain.${v.id}.position`,
              seats.filter((p) => p !== state.hero.position).map((p) => ({ value: p, label: positionById(p).label })),
              v.position
            )
          )}
          ${field('What kind of player', select(`villain.${v.id}.type`, ARCHETYPES.map((a) => ({ value: a.id, label: a.name })), v.type))}
          ${field('Their stack', number(`villain.${v.id}.stack`, v.stack))}
          ${field('Before the flop', select(`villain.${v.id}.role`, ROLES, v.role))}
          ${preflop ? '' : field('On this street', select(`villain.${v.id}.action`, STREET_ACTIONS, v.action))}
          ${field(
            'Override their range (optional)',
            `<input type="text" data-field="villain.${v.id}.customRange" value="${escape(v.customRange ?? '')}" placeholder="e.g. 88+, ATs+, KQs, 15%" />`,
            { wide: true }
          )}
        </div>
        <p class="archetype-note">${escape(arch.tagline)}.</p>
      </div>`;
    })
    .join('');
}

function renderBoard() {
  let html = '';
  for (let i = 0; i < 5; i++) {
    if (i === 3 || i === 4) html += '<div class="street-divider"></div>';
    html += cardSlot(`board:${i}`, state.board[i]);
  }
  html += `<span class="street-label">${escape(streetOf(state.board))}</span>`;
  $('#board-slots').innerHTML = html;

  const setting = settingById(state.setting);
  const unit = setting.format === 'tournament' ? 'chips' : state.currency;
  $('#money-fields').innerHTML = [
    field(`Pot before your decision (${unit})`, number('pot', state.pot), {
      hint: `${(Number(state.pot) / (Number(state.bigBlind) || 1)).toFixed(1)} big blinds`,
    }),
    field(`To call (${unit})`, number('toCall', state.toCall), {
      hint: Number(state.toCall) > 0 ? 'You are facing a bet' : 'Nothing to call — it is checked to you',
    }),
  ].join('');
}

function renderAll() {
  renderSetting();
  renderHero();
  renderVillains();
  renderBoard();
  save();
}

/* ---------------------------------------------------------------- results */

function miniCards(cards) {
  return cards.map((c) => `<span class="mini${isRed(c) ? ' red' : ''}">${RANKS[rankOf(c)]}${SUIT_SYMBOLS[suitOf(c)]}</span>`).join('');
}

function renderReport(report, spot) {
  const setting = settingById(spot.setting);
  const money = (n) => (setting.format === 'tournament' ? `${Math.round(n)} chips` : `${spot.currency}${Math.round(n * 100) / 100}`);
  const eq = report.equity.equity;
  const needed = report.math.requiredEquity;
  const marginText = report.equity.exact
    ? 'exact — every remaining board counted'
    : `±${(report.equity.stdError * 196).toFixed(1)}% at 95% confidence, ${report.equity.trials.toLocaleString()} runouts`;

  const stats = [
    ['Your equity', pct(eq), marginText],
    spot.toCall > 0
      ? [
          'Equity needed',
          pct(needed),
          report.math.riskPremium > 0.005
            ? `pot odds ${pct(report.math.potOdds)} + ${pct(report.math.riskPremium)} survival`
            : `pot odds ${pct(report.math.potOdds)}`,
        ]
      : null,
    spot.toCall > 0 ? ['EV of calling', money(report.math.evCall), report.math.evCall >= 0 ? 'better than folding' : 'worse than folding'] : null,
    ['Stack-to-pot', report.spr.toFixed(1), `effective ${money(report.effectiveStack)}`],
    ['Position', report.inPosition ? 'You act last' : 'Out of position', positionById(spot.hero.position).label],
  ].filter(Boolean);

  const opponents = report.exploits
    .map((e, i) => {
      const r = report.ranges[i];
      const s = e.range;
      return `<div class="opponent">
        <h4><span>${escape(e.seat)}</span><span>${e.equity !== null && e.equity !== undefined ? escape(pct(e.equity)) : ''}</span></h4>
        <p class="range-line">Holding ${escape(s.label)} — about ${s.combosLeft} combos${
          s.bluffShare > 0.02 ? `, roughly ${Math.round(s.bluffShare * 100)}% of it air` : ''
        }. Their preflop range was around ${pct(r.preflopPercent)} of all hands.</p>
        <p class="combos">${escape(s.topCodes.join('  '))}${s.combosLeft > 8 ? '  …' : ''}</p>
        <p class="archetype-note">${escape(e.note)}</p>
      </div>`;
    })
    .join('');

  $('#results').innerHTML = `
    <section class="panel">
      <div class="verdict" data-action="${escape(report.decision.action)}">
        <div class="call-to-action">${escape(report.decision.headline)}</div>
        <p class="holding">You have ${escape(report.hand.made)}${
          report.hand.drawText ? ` with a ${escape(report.hand.drawText)}` : ''
        } on the ${escape(report.street)}.</p>
        <div class="equity-bar" title="Your equity against the ranges still in the pot">
          <span class="mine" style="width:${(eq * 100).toFixed(1)}%"></span>
          ${spot.toCall > 0 ? `<span class="needed" style="margin-left:${Math.max(0, (needed - eq) * 100).toFixed(1)}%"></span>` : ''}
        </div>
        <dl class="stats">
          ${stats.map(([k, v, s]) => `<div class="stat"><dt>${escape(k)}</dt><dd>${escape(v)}<small>${escape(s)}</small></dd></div>`).join('')}
        </dl>
        <ul class="reasons">${report.reasons.map((r) => `<li>${escape(r)}</li>`).join('')}</ul>
      </div>
    </section>

    <section class="panel">
      <header class="panel-head"><h2>Who you are up against</h2>
        <p class="hint">Ranges built from the reads you entered, then narrowed by the action on this board.</p>
      </header>
      ${opponents}
    </section>

    <section class="panel">
      <header class="panel-head"><h2>Because of where you are playing</h2>
        <p class="hint">${escape(setting.name)}${setting.format === 'tournament' ? ` — ${escape(stageById(spot.stage).name)}` : ''}</p>
      </header>
      <div class="setting-notes">${report.context.map((c) => `<li>${escape(c)}</li>`).join('')}</div>
    </section>

    <section class="panel">
      <header class="panel-head"><h2>Run it out</h2>
        <p class="hint">Deal the rest of the hand once: what your equity does street by street, and who ends up winning.</p>
      </header>
      <button type="button" class="ghost" data-action="run-it-out">Deal the runout</button>
      <div id="runout"></div>
    </section>`;
}

/** Deal the hand to the end once, giving every opponent a real holding from their range. */
function runItOut(report, spot) {
  const used = new Set([...spot.hero.cards, ...spot.board]);
  const hands = [];
  for (const r of report.ranges) {
    const options = r.combos.filter((c) => !used.has(c[0]) && !used.has(c[1]));
    if (options.length === 0) return { error: 'No holding left in that range once the other cards are dealt.' };
    const pick = options[Math.floor(Math.random() * options.length)];
    used.add(pick[0]);
    used.add(pick[1]);
    hands.push({ villain: r.villain, cards: pick });
  }

  const deck = deckWithout(used);
  const board = [...spot.board];
  while (board.length < 5) board.push(deck.splice(Math.floor(Math.random() * deck.length), 1)[0]);

  // Equity at each street, against the same ranges — what you would have known at the time.
  const streets = [];
  for (const size of [3, 4, 5]) {
    const snapshot = board.slice(0, size);
    const r = equityVsRanges({
      hero: spot.hero.cards,
      board: snapshot,
      villains: report.ranges,
      trials: 6000,
      seed: (Math.random() * 1e9) | 0,
    });
    streets.push({ name: size === 3 ? 'Flop' : size === 4 ? 'Turn' : 'River', board: snapshot, equity: r.equity });
  }

  const heroScore = evaluate([...spot.hero.cards, ...board], 7);
  const scored = hands.map((h) => ({ ...h, score: evaluate([...h.cards, ...board], 7) }));
  const best = Math.max(heroScore, ...scored.map((s) => s.score));
  const winners = [heroScore === best ? 'you' : null, ...scored.filter((s) => s.score === best).map((s) => positionById(s.villain.position).name)].filter(
    Boolean
  );

  return { board, streets, scored, heroScore, best, winners, heroHand: describe(heroScore) };
}

function renderRunout(result, spot) {
  const host = $('#runout');
  if (!host) return;
  if (result.error) {
    host.innerHTML = `<p class="hint">${escape(result.error)}</p>`;
    return;
  }
  const rows = result.streets
    .map(
      (s) => `<div class="runout-street">
        <strong>${escape(s.name)}</strong>
        <span class="mini-cards">${miniCards(s.board)}</span>
        <span class="pct">${escape(pct(s.equity))}</span>
      </div>`
    )
    .join('');

  const showdown = result.scored
    .map(
      (s) => `<div class="runout-street"><strong>${escape(positionById(s.villain.position).name)}</strong>
      <span class="mini-cards">${miniCards(s.cards)}</span>
      <span class="pct" style="font-weight:400;color:var(--ink-dim)">${escape(describe(s.score))}</span></div>`
    )
    .join('');

  const won = result.winners.includes('you');
  const others = result.winners.filter((w) => w !== 'you');
  const outcome = won
    ? others.length
      ? `Split pot — you and ${escape(others.join(', '))} chop it.`
      : `You win it with ${escape(result.heroHand)}.`
    : `${escape(others.join(', '))} takes it with ${escape(describe(result.best))}.`;

  host.innerHTML = `<div class="runout">${rows}
    <div class="runout-street"><strong>You</strong><span class="mini-cards">${miniCards(spot.hero.cards)}</span>
      <span class="pct" style="font-weight:400;color:var(--ink-dim)">${escape(result.heroHand)}</span></div>
    ${showdown}
    <div class="result-line">${outcome} That is one runout out of many — the equity above is what pays over time.</div>
    </div>`;
}

/* ---------------------------------------------------------------- actions */

function showError(message) {
  $('#results').innerHTML = `<section class="panel error"><h2>Cannot read that yet</h2><p class="hint">${escape(message)}</p></section>`;
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    el.hidden = true;
  }, 2800);
}

function readSpot() {
  const spot = toEngineSpot();
  if (spot.hero.cards.length !== 2) return showError('Pick your two cards first.');
  if (spot.villains.length === 0) return showError('Add at least one opponent — that is the whole point.');
  if (spot.pot <= 0) return showError('Set the pot size so the price can be worked out.');
  if (spot.board.length === 1 || spot.board.length === 2) {
    return showError('A flop is three cards. Fill all three, or clear them for a preflop spot.');
  }

  $('#results').innerHTML = '<section class="panel"><p class="spinner">Dealing 20,000 runouts…</p></section>';
  requestAnimationFrame(() => {
    try {
      lastSpot = spot;
      lastReport = analyse(spot, { trials: 20000, seed: (Math.random() * 1e9) | 0 });
      renderReport(lastReport, spot);
    } catch (err) {
      showError(err.message);
    }
  });
}

/* ----------------------------------------------------------- card picking */

function openPicker(slot) {
  pickerSlot = slot;
  const [where, index] = slot.split(':');
  $('#picker-title').textContent = where === 'hero' ? 'Your cards' : `Board card ${Number(index) + 1}`;
  const current = where === 'hero' ? state.hero.cards[index] : state.board[index];
  const used = new Set([...state.hero.cards, ...state.board].filter((c) => c !== undefined && c !== null));
  used.delete(current);

  let html = '';
  for (let suit = 0; suit < 4; suit++) {
    for (let rank = 12; rank >= 0; rank--) {
      const card = (rank << 2) | suit;
      html += `<button type="button" class="pick${isRed(card) ? ' red' : ''}" data-card="${card}"${
        used.has(card) ? ' disabled' : ''
      }>${RANKS[rank]}${SUIT_SYMBOLS[suit]}</button>`;
    }
  }
  $('#card-grid').innerHTML = html;
  $('#card-picker').showModal();
}

function setSlot(slot, card) {
  const [where, indexText] = slot.split(':');
  const index = Number(indexText);
  if (where === 'hero') {
    const cards = [...state.hero.cards];
    if (card === null) cards.splice(index, 1);
    else cards[index] = card;
    state.hero.cards = cards.filter((c) => c !== undefined && c !== null);
  } else {
    const board = [...state.board];
    if (card === null) board.splice(index, 1);
    else board[index] = card;
    state.board = board.filter((c) => c !== undefined && c !== null);
  }
  renderAll();
}

/* ----------------------------------------------------------------- wiring */

function setPath(path, value) {
  const parts = path.split('.');
  if (parts[0] === 'villain') {
    const villain = state.villains.find((v) => String(v.id) === parts[1]);
    if (villain) villain[parts[2]] = value;
    return;
  }
  if (parts.length === 2) state[parts[0]][parts[1]] = value;
  else state[parts[0]] = value;
}

const NUMERIC = new Set(['smallBlind', 'bigBlind', 'pot', 'toCall', 'tableSize', 'stack']);

function freeSeatFor(villain) {
  const seats = seatsForTableSize(state.tableSize);
  return seats.find((p) => p !== state.hero.position && !state.villains.some((o) => o !== villain && o.position === p)) ?? 'bb';
}

function onFieldChange(event) {
  const el = event.target.closest('[data-field]');
  if (!el) return;
  const path = el.dataset.field;
  const key = path.split('.').pop();
  const value = NUMERIC.has(key) ? Number(el.value) : el.value;
  setPath(path, value);

  if (path === 'tableSize') {
    const seats = seatsForTableSize(state.tableSize);
    if (!seats.includes(state.hero.position)) state.hero.position = seats.at(-1);
    state.villains.forEach((v) => {
      if (!seats.includes(v.position) || v.position === state.hero.position) v.position = freeSeatFor(v);
    });
  }
  if (path === 'hero.position') {
    state.villains.forEach((v) => {
      if (v.position === state.hero.position) v.position = freeSeatFor(v);
    });
  }
  renderAll();
}

function applySpot(spot) {
  state = spot;
  state.villains.forEach((v) => {
    if (v.id === undefined) v.id = nextSeatId++;
  });
  lastReport = null;
  renderAll();
  $('#results').innerHTML =
    '<section class="panel placeholder"><h2>Ready when you are</h2><p>Press <strong>Read the spot</strong> to see your equity, the price you are being offered, and the read that comes from who these players are.</p></section>';
}

function onClick(event) {
  const trigger = event.target.closest('[data-action]');
  if (!trigger) return;
  const action = trigger.dataset.action;

  if (action === 'pick') return openPicker(trigger.dataset.slot);
  if (action === 'clear-slot') {
    if (pickerSlot) setSlot(pickerSlot, null);
    $('#card-picker').close();
    return;
  }
  if (action === 'add-villain') {
    addVillain(state);
    return renderAll();
  }
  if (action === 'remove-villain') {
    state.villains = state.villains.filter((v) => String(v.id) !== trigger.dataset.id);
    return renderAll();
  }
  if (action === 'analyse') return readSpot();
  if (action === 'reset') {
    const fresh = blankSpot();
    addVillain(fresh);
    applySpot(fresh);
    history.replaceState(null, '', location.pathname);
    return;
  }
  if (action === 'load-example') {
    const example = EXAMPLES[exampleIndex % EXAMPLES.length];
    exampleIndex++;
    applySpot(structuredClone(example.spot));
    toast(example.name);
    return;
  }
  if (action === 'share') {
    const encoded = encodeSpot(state);
    history.replaceState(null, '', `#s=${encoded}`);
    const url = `${location.origin}${location.pathname}#s=${encoded}`;
    navigator.clipboard?.writeText(url).then(
      () => toast('Link copied — it carries the whole spot.'),
      () => toast('Copy blocked, but the address bar now holds the spot.')
    );
    return;
  }
  if (action === 'run-it-out') {
    if (!lastReport) return;
    renderRunout(runItOut(lastReport, lastSpot), lastSpot);
  }
}

document.addEventListener('click', onClick);
document.addEventListener('change', onFieldChange);
document.addEventListener('input', (event) => {
  if (event.target.matches('input[type="text"], input[type="number"]')) onFieldChange(event);
});

$('#card-grid').addEventListener('click', (event) => {
  const button = event.target.closest('[data-card]');
  if (!button || !pickerSlot) return;
  const [where, index] = pickerSlot.split(':');
  setSlot(pickerSlot, Number(button.dataset.card));
  $('#card-picker').close();
  // Filling the first hole card should lead straight on to the second.
  if (where === 'hero' && Number(index) === 0 && state.hero.cards.length === 1) openPicker('hero:1');
});

applySpot(load() ?? structuredClone(EXAMPLES[0].spot));
