// The dealer. Runs full No-Limit Hold'em hands from blinds to showdown:
// rotating positions, betting rounds, side pots, and opponents who act on
// their own cards the way their player type says they would.
//
// The UI drives it one event at a time through step(), so hands can play out
// at a human pace, and every hero decision is snapshotted for the coach.

import { handCode, cardName } from './cards.js';
import { evaluate, describe } from './evaluator.js';
import { RANGE_CUTOFF } from './data/preflop.js';
import { percentileOnBoard, drawsFor } from './handstrength.js';
import { archetypeById, settingById, positionById, seatsForTableSize, applyMood, moodById, hasMoods } from './players.js';
import { foldFrequency } from './engine.js';
import { maybeTell } from './tells.js';
import { mulberry32, randomSeed } from './rng.js';

/* ------------------------------------------------------------------ session */

/**
 * @param {object} config
 *   { setting, stage, currency, smallBlind, bigBlind, heroStack,
 *     villains: [{ type, stack }, ...] }
 */
export function createSession(config, seed = randomSeed()) {
  if (!config.villains || config.villains.length < 1) throw new Error('The table needs at least one opponent.');
  if (config.villains.length > 8) throw new Error('Nine seats is the most a hold\'em table takes.');
  return {
    config,
    seed,
    rotation: 0,
    handNumber: 0,
    net: 0,
    handsPlayed: 0,
    grades: { good: 0, ok: 0, mistake: 0 },
    // Stacks persist from hand to hand; busting means buying back in.
    stacks: [config.heroStack, ...config.villains.map((v) => v.stack)],
    invested: [config.heroStack, ...config.villains.map((v) => v.stack)],
    rebuys: new Array(config.villains.length + 1).fill(0),
    // Tilt: how much the last big loss is still steering each player, 0..1.
    tilt: new Array(config.villains.length + 1).fill(0),
    hand: null,
  };
}

/** How hard each type goes on tilt after losing a big pot. */
const TILT_PRONE = {
  recreational: 0.9,
  maniac: 0.85,
  station: 0.6,
  lag: 0.6,
  abc: 0.5,
  unknown: 0.5,
  tricky: 0.45,
  tag: 0.3,
  nit: 0.25,
};

/** Types that top their stack back up between hands instead of playing short. */
const TOPS_UP = new Set(['recreational', 'maniac', 'station']);

/* -------------------------------------------------------------------- hands */

export function startHand(session) {
  const cfg = session.config;
  session.handNumber += 1;
  const rng = mulberry32((session.seed + session.handNumber * 7919) >>> 0);

  const buyins = [cfg.heroStack, ...cfg.villains.map((v) => v.stack)];
  const players = buyins.map((buyin, i) => ({
    isHero: i === 0,
    type: i === 0 ? 'hero' : cfg.villains[i - 1].type,
    stackSize: session.stacks[i],
    buyin,
  }));
  const n = players.length;
  const positions = seatsForTableSize(n);

  // The button moves every hand: rotate which player sits where.
  const seats = players.map((p, i) => {
    const position = positions[(i + session.rotation) % n];
    return {
      id: i,
      isHero: p.isHero,
      type: p.type,
      position,
      startStack: p.stackSize,
      stack: p.stackSize,
      cards: [],
      folded: false,
      allIn: false,
      contributed: 0,
      streetPut: 0,
      preflopRole: null,
      lastAction: null,
      lastStreetActed: null,
      buyin: p.buyin,
      tilt: p.isHero ? 0 : session.tilt[i],
    };
  });
  session.rotation = (session.rotation + 1) % n;

  // Deal.
  const deck = [];
  for (let c = 0; c < 52; c++) deck.push(c);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  for (const seat of seats) seat.cards = [deck.pop(), deck.pop()];

  const hand = {
    number: session.handNumber,
    rng,
    seats,
    positions,
    deck,
    board: [],
    street: 'preflop',
    currentBet: 0,
    minRaise: cfg.bigBlind,
    needAction: new Set(),
    pointer: 0,
    raisesThisStreet: 0,
    log: [],
    decisions: [],
    finished: false,
    results: null,
  };
  session.hand = hand;

  log(hand, { kind: 'deal', text: `Hand #${hand.number}. Blinds ${cfg.smallBlind}/${cfg.bigBlind} posted.` });

  // Rebuys and top-ups happen between hands, before the blinds go out.
  const seatName = (seat) => (seat.isHero ? 'You' : `${positionById(seat.position).name} (${archetypeById(seat.type).name})`);
  for (const seat of seats) {
    const busted = seat.stack < cfg.bigBlind;
    const wantsTopUp = !seat.isHero && TOPS_UP.has(seat.type) && seat.stack < seat.buyin * 0.5;
    if (busted || wantsTopUp) {
      const added = seat.buyin - seat.stack;
      if (added > 0) {
        seat.stack = seat.buyin;
        session.invested[seat.id] += added;
        if (busted) session.rebuys[seat.id] += 1;
        session.stacks[seat.id] = seat.stack;
        log(hand, {
          kind: 'rebuy',
          seat: seat.id,
          text: busted
            ? `${seatName(seat)} ${seat.isHero ? 'rebuy' : 'rebuys'} for ${cfg.currency}${seat.buyin}.`
            : `${seatName(seat)} tops back up to ${cfg.currency}${seat.buyin}.`,
        });
      }
    }
    seat.startStack = seat.stack;
    if (!seat.isHero && seat.tilt >= 0.25) {
      log(hand, { kind: 'tilt', seat: seat.id, text: `${seatName(seat)} is still steaming from that last pot.` });
    }
  }

  const bySeat = (pos) => seats.find((s) => s.position === pos);
  const sb = bySeat('sb');
  const bb = bySeat('bb');
  putChips(hand, sb, Math.min(cfg.smallBlind, sb.stack));
  putChips(hand, bb, Math.min(cfg.bigBlind, bb.stack));
  hand.currentBet = cfg.bigBlind;

  openRound(hand, 'preflop', cfg.bigBlind);
  return hand;
}

function putChips(hand, seat, amount) {
  const put = Math.min(amount, seat.stack);
  seat.stack -= put;
  seat.contributed += put;
  seat.streetPut += put;
  if (seat.stack === 0) seat.allIn = true;
  return put;
}

export const potTotal = (hand) => hand.seats.reduce((sum, s) => sum + s.contributed, 0);

const canAct = (s) => !s.folded && !s.allIn;

function streetOrder(hand, street) {
  const order = [...hand.positions];
  if (street !== 'preflop') {
    if (order.length === 2) return ['bb', 'sb']; // heads-up: the button acts last after the flop
    return [...order.slice(-2), ...order.slice(0, -2)]; // sb, bb, then the rest
  }
  return order; // utg first, blinds last (heads-up: sb first, which is the button)
}

function openRound(hand, street, bigBlind) {
  hand.street = street;
  hand.order = streetOrder(hand, street).map((pos) => hand.seats.find((s) => s.position === pos));
  hand.needAction = new Set(hand.seats.filter(canAct).map((s) => s.id));
  hand.pointer = 0;
  hand.raisesThisStreet = street === 'preflop' ? 1 : 0; // the blind counts as the first bet
  if (street !== 'preflop') {
    hand.currentBet = 0;
    hand.minRaise = bigBlind;
    for (const seat of hand.seats) seat.streetPut = 0;
  }
}

/* --------------------------------------------------------------- the loop */

/**
 * Advance the hand by exactly one event. Returns one of:
 *   { kind: 'action', ... }     a villain acted
 *   { kind: 'street', ... }     the next street was dealt
 *   { kind: 'hero-turn', ... }  waiting on the hero — call heroAct next
 *   { kind: 'over', results }   the hand is finished
 */
export function step(session) {
  const hand = session.hand;
  if (!hand || hand.finished) return { kind: 'over', results: hand?.results ?? null };

  // If everyone else has folded, the hand is over no matter whose turn it was.
  const standing = hand.seats.filter((s) => !s.folded);
  if (standing.length === 1) return finishUncontested(session, hand, standing[0]);

  if (hand.needAction.size > 0) {
    const seat = nextActor(hand);
    if (seat) {
      if (seat.isHero) return { kind: 'hero-turn', seat: seat.id, ...heroChoices(session) };
      return villainTurn(session, hand, seat);
    }
  }

  // Betting round complete.
  if (hand.street === 'river') return finishShowdown(session, hand);

  const next = { preflop: 'flop', flop: 'turn', turn: 'river' }[hand.street];
  const count = next === 'flop' ? 3 : 1;
  const dealt = [];
  for (let i = 0; i < count; i++) dealt.push(hand.deck.pop());
  hand.board.push(...dealt);
  openRound(hand, next, session.config.bigBlind);
  // Everyone already all-in: the round closes itself and the next step deals on.
  if (hand.seats.filter(canAct).length < 2) hand.needAction = new Set();
  const event = { kind: 'street', street: next, cards: dealt, board: [...hand.board], pot: potTotal(hand) };
  log(hand, { kind: 'street', street: next, text: `${next[0].toUpperCase()}${next.slice(1)}: ${dealt.map(cardName).join(' ')}`, cards: dealt });
  return event;
}

function nextActor(hand) {
  for (let i = 0; i < hand.order.length; i++) {
    const seat = hand.order[(hand.pointer + i) % hand.order.length];
    if (hand.needAction.has(seat.id) && canAct(seat)) {
      hand.pointer = (hand.pointer + i) % hand.order.length;
      return seat;
    }
    hand.needAction.delete(seat.id); // folded or all-in seats owe nothing
  }
  hand.needAction.clear();
  return null;
}

/* --------------------------------------------------------- applying actions */

function applyAction(session, hand, seat, action, amount = 0) {
  const cfg = session.config;
  const toCall = hand.currentBet - seat.streetPut;

  if (action === 'fold') {
    seat.folded = true;
    hand.needAction.delete(seat.id);
  } else if (action === 'check') {
    if (toCall > 0) throw new Error('Cannot check facing a bet');
    hand.needAction.delete(seat.id);
  } else if (action === 'call') {
    putChips(hand, seat, toCall);
    hand.needAction.delete(seat.id);
  } else if (action === 'bet' || action === 'raise') {
    const target = Math.min(amount, seat.streetPut + seat.stack); // "raise to" amount
    const increment = target - hand.currentBet;
    const isAllIn = target === seat.streetPut + seat.stack;
    if (increment < hand.minRaise && !isAllIn) throw new Error('Raise is below the minimum');
    putChips(hand, seat, target - seat.streetPut);
    hand.currentBet = target;
    hand.raisesThisStreet += 1;
    // A short all-in raise does not reopen the betting for players already done.
    if (increment >= hand.minRaise) {
      hand.minRaise = increment;
      hand.needAction = new Set(hand.seats.filter((s) => canAct(s) && s.id !== seat.id).map((s) => s.id));
    } else {
      hand.needAction.delete(seat.id);
    }
  }

  seat.lastAction = action;
  seat.lastStreetActed = hand.street;
  if (hand.street === 'preflop') notePreflopRole(hand, seat, action, toCall, cfg);
  hand.pointer = (hand.order.indexOf(seat) + 1) % hand.order.length;
}

function notePreflopRole(hand, seat, action, toCall, cfg) {
  if (action === 'fold') return;
  const isBlind = seat.position === 'sb' || seat.position === 'bb';
  if (action === 'bet' || action === 'raise') {
    seat.preflopRole = hand.raisesThisStreet >= 3 ? '3bet' : 'raised';
  } else if (action === 'call') {
    if (hand.currentBet > cfg.bigBlind) seat.preflopRole = isBlind ? 'blind' : 'called';
    else seat.preflopRole = isBlind ? 'blind' : 'limped';
  } else if (action === 'check') {
    seat.preflopRole = 'blind';
  }
}

/* -------------------------------------------------------------- villain AI */

function villainTurn(session, hand, seat) {
  const decision = decideVillain(session, hand, seat);
  applyAction(session, hand, seat, decision.action, decision.amount);

  let tell = null;
  if (decision.action !== 'fold' && decision.action !== 'check') {
    tell = maybeTell({
      typeId: seat.type,
      settingId: session.config.setting,
      strong: decision.strongHint,
      aggressive: decision.action === 'bet' || decision.action === 'raise',
      headsUp: hand.seats.filter((x) => !x.folded).length <= 2,
      rng: hand.rng,
    });
  }

  const event = {
    kind: 'action',
    seat: seat.id,
    position: seat.position,
    type: seat.type,
    action: decision.action,
    amount: decision.action === 'call' ? hand.currentBet : decision.amount ?? 0,
    allIn: seat.allIn,
    pot: potTotal(hand),
    tell,
    text: actionText(session, hand, seat, decision, tell),
  };
  log(hand, { ...event, hiddenStrength: decision.strength });
  return event;
}

function actionText(session, hand, seat, decision, tell) {
  const cfg = session.config;
  const name = `${positionById(seat.position).name} (${archetypeById(seat.type).name})`;
  const money = (n) => `${cfg.currency}${Math.round(n * 100) / 100}`;
  let base;
  switch (decision.action) {
    case 'fold':
      base = `${name} folds`;
      break;
    case 'check':
      base = `${name} checks`;
      break;
    case 'call':
      base = `${name} calls ${money(seat.streetPut)}${seat.allIn ? ' — all in' : ''}`;
      break;
    case 'bet':
      base = `${name} bets ${money(decision.amount)}${seat.allIn ? ' — all in' : ''}`;
      break;
    case 'raise':
      base = `${name} raises to ${money(decision.amount)}${seat.allIn ? ' — all in' : ''}`;
      break;
    default:
      base = `${name} ${decision.action}`;
  }
  return tell ? `${base} — ${tell.text}` : base;
}

/** Money amounts snap to something a person would actually bet. */
function snap(amount, cfg) {
  const unit = cfg.smallBlind >= 1 ? cfg.smallBlind : 0.5;
  return Math.max(cfg.bigBlind, Math.round(amount / unit) * unit);
}

function decideVillain(session, hand, seat) {
  const cfg = session.config;
  const baseSetting = settingById(cfg.setting);
  const setting = applyMood(baseSetting, cfg.mood);
  const arch = archetypeById(seat.type);
  const rng = hand.rng;
  const toCall = hand.currentBet - seat.streetPut;
  const pot = potTotal(hand);
  // Late-night heat rides the same dial as tilt: the whole table plays angrier.
  const heat = hasMoods(baseSetting) ? moodById(cfg.mood).heat : 0;
  const tilt = Math.min(1, (seat.tilt ?? 0) + heat);

  if (hand.street === 'preflop') return decidePreflop(session, hand, seat, { setting, arch, rng, toCall, pot, tilt });

  const s = percentileOnBoard(seat.cards, hand.board, rng);
  const draws = drawsFor(seat.cards, hand.board);
  const bigDraw = draws.flushDraw || draws.openEnded;
  const strongHint = s >= 0.72;

  // Tilt makes everything angrier: more bets, bigger bets, fewer folds.
  // The commit guard keeps a merely-good hand from torching the whole stack:
  // nobody bets two-thirds of what they have behind with second pair.
  const size = () => {
    let amount = betSize(arch, pot, rng) * (1 + tilt * 0.35);
    if (amount > seat.stack * 0.55 && s < 0.9) amount = Math.min(amount, pot * 0.5);
    return amount;
  };

  if (toCall <= 0) {
    // Can check or bet. Betting standards go up a notch on each later street —
    // firing three barrels needs a real hand, not a constant threshold.
    const streetBar = hand.street === 'river' ? 0.07 : hand.street === 'turn' ? 0.035 : 0;
    const valueLine = 0.78 - (arch.cbet - 0.5) * 0.35 - tilt * 0.1 + streetBar;
    if (s >= valueLine) {
      const amount = snap(hand.currentBet + size(), cfg);
      return { action: hand.currentBet > 0 ? 'raise' : 'bet', amount, strength: s, strongHint };
    }
    if (bigDraw && rng() < arch.cbet * 0.55 * (1 + tilt)) {
      return { action: 'bet', amount: snap(size(), cfg), strength: s, strongHint: true };
    }
    if (s <= 0.3 && rng() < arch.bluffShare * 0.4 * (1 + tilt * 1.5)) {
      return { action: 'bet', amount: snap(size() * 0.85, cfg), strength: s, strongHint: false };
    }
    return { action: 'check', strength: s, strongHint };
  }

  // Facing a bet.
  const ratio = toCall / Math.max(pot - toCall, cfg.bigBlind);
  const foldLine = foldFrequency(arch, setting, ratio, hand.street) * (1 - tilt * 0.5);
  const forStack = toCall >= seat.stack;

  if (forStack) {
    const commit = 0.68 + Math.min(ratio, 1.5) * 0.08 - (arch.calldown - 0.5) * 0.3;
    if (s >= commit || (bigDraw && hand.street === 'flop' && rng() < 0.3)) {
      return { action: 'call', strength: s, strongHint };
    }
    return { action: 'fold', strength: s, strongHint: false };
  }

  const warDampener = hand.raisesThisStreet >= 2 ? 0.3 : 1; // re-re-raises should be rare, not routine
  if (s >= 0.93 && rng() < (0.22 + arch.raiseBluff * 0.3) * warDampener) {
    const amount = snap(Math.max(hand.currentBet + hand.minRaise, hand.currentBet * 2.2 + pot * 0.22), cfg);
    return { action: 'raise', amount, strength: s, strongHint: true };
  }
  if (s < foldLine && !bigDraw) {
    if (rng() < arch.raiseBluff * 0.15 * (1 + tilt) && hand.street !== 'river' && hand.raisesThisStreet < 2) {
      const amount = snap(Math.max(hand.currentBet + hand.minRaise, hand.currentBet * 2.2 + pot * 0.2), cfg);
      return { action: 'raise', amount, strength: s, strongHint: false };
    }
    return { action: 'fold', strength: s, strongHint: false };
  }
  if (bigDraw && hand.street !== 'river' && hand.raisesThisStreet < 2 && rng() < arch.raiseBluff * 0.22) {
    const amount = snap(Math.max(hand.currentBet + hand.minRaise, hand.currentBet * 2.2 + pot * 0.2), cfg);
    return { action: 'raise', amount, strength: s, strongHint: true };
  }
  return { action: 'call', strength: s, strongHint };
}

function decidePreflop(session, hand, seat, { setting, arch, rng, toCall, pot, tilt = 0 }) {
  const cfg = session.config;
  const p = RANGE_CUTOFF[handCode(seat.cards[0], seat.cards[1])] ?? 1;
  const group = positionById(seat.position).group;
  const widen = (1 + setting.loosen * 2) * (1 + tilt * 0.5);
  const strongHint = p <= 0.1;
  const strength = 1 - p;

  const unraised = hand.raisesThisStreet <= 1; // only the blind so far
  if (unraised) {
    if (toCall <= 0) {
      // Big blind option.
      if (p <= arch.openBy[group] * 0.55) {
        return { action: 'raise', amount: snap(cfg.bigBlind * openMultiple(arch, rng) + limperCount(hand) * cfg.bigBlind, cfg), strength, strongHint };
      }
      return { action: 'check', strength, strongHint };
    }
    const passive = arch.limp >= 0.15;
    const openWidth = arch.openBy[group] * widen;
    if (p <= openWidth * (passive ? 0.35 : 1)) {
      return { action: 'raise', amount: snap(cfg.bigBlind * openMultiple(arch, rng) + limperCount(hand) * cfg.bigBlind, cfg), strength, strongHint };
    }
    if (passive && p <= Math.max(arch.limp, openWidth) * widen) {
      return { action: 'call', strength, strongHint };
    }
    if (seat.position === 'sb' && p <= (arch.callVsOpen + 0.15) * widen) {
      return { action: 'call', strength, strongHint }; // completing the small blind is cheap
    }
    return { action: 'fold', strength, strongHint: false };
  }

  // Facing a raise (or more).
  const reraises = hand.raisesThisStreet - 1;
  const threeBetWidth = arch.threeBet * (reraises >= 2 ? 0.35 : 1) * (1 + tilt * 0.8);
  const callWidth = arch.callVsOpen * widen * (reraises >= 2 ? 0.4 : 1);
  const forBigChunk = toCall >= seat.stack * 0.55;

  if (forBigChunk) {
    const width = Math.min(Math.max(threeBetWidth * 0.8, 0.03) * (arch.calldown > 0.7 ? 1.7 : 1), 0.12);
    return p <= width ? { action: 'call', strength, strongHint } : { action: 'fold', strength, strongHint: false };
  }
  const bluffReraise = reraises < 2 && rng() < arch.raiseBluff * 0.12 * (1 + tilt * 2) && p > 0.2 && p < 0.45;
  if (p <= threeBetWidth || bluffReraise) {
    const multiple = reraises >= 2 ? 2.1 + rng() * 0.4 : 2.6 + rng() * 0.8;
    const amount = snap(hand.currentBet * multiple + potDead(hand, seat), cfg);
    return { action: 'raise', amount, strength, strongHint: p <= threeBetWidth };
  }
  if (p <= callWidth || (seat.position === 'bb' && p <= (callWidth + 0.12) * widen)) {
    return { action: 'call', strength, strongHint };
  }
  return { action: 'fold', strength, strongHint: false };
}

const openMultiple = (arch, rng) => {
  const base = arch.id === 'maniac' ? 4.2 : arch.id === 'nit' ? 2.4 : arch.id === 'lag' ? 3.2 : 2.8;
  return base + rng() * 0.6;
};

const limperCount = (hand) => hand.seats.filter((s) => !s.folded && s.preflopRole === 'limped').length;
const potDead = (hand, seat) => hand.seats.reduce((sum, s) => (s === seat ? sum : sum + s.streetPut), 0) * 0.2;

function betSize(arch, pot, rng) {
  const base = { nit: 0.5, tag: 0.6, lag: 0.68, station: 0.4, maniac: 0.82, recreational: 0.52, abc: 0.52, tricky: 0.62, unknown: 0.58 }[arch.id] ?? 0.58;
  return pot * base * (0.88 + rng() * 0.28);
}

/* ------------------------------------------------------------- hero actions */

/** What the hero may legally do right now, with concrete amounts. */
export function heroChoices(session) {
  const hand = session.hand;
  const cfg = session.config;
  const hero = hand.seats.find((s) => s.isHero);
  const toCall = Math.min(hand.currentBet - hero.streetPut, hero.stack);
  const pot = potTotal(hand);
  const maxTo = hero.streetPut + hero.stack;
  const minTo = Math.min(hand.currentBet + hand.minRaise, maxTo);

  const sizes = [];
  const addSize = (label, to) => {
    to = Math.min(snap(to, cfg), maxTo);
    if (to < minTo && to !== maxTo) return;
    if (sizes.some((s) => s.to === to)) return;
    sizes.push({ label, to });
  };
  if (hero.stack > toCall) {
    if (hand.currentBet === 0) {
      addSize('⅓ pot', pot / 3);
      addSize('½ pot', pot / 2);
      addSize('¾ pot', pot * 0.75);
      addSize('Pot', pot);
    } else {
      addSize('Min', minTo);
      addSize('2.5×', hand.currentBet * 2.5);
      addSize('Pot', hand.currentBet + pot);
    }
    addSize('All-in', maxTo);
  }

  return {
    toCall,
    pot,
    canCheck: toCall <= 0,
    canFold: toCall > 0,
    call: toCall,
    sizes,
    minRaiseTo: minTo,
    maxTo,
    street: hand.street,
    board: [...hand.board],
    heroCards: [...hero.cards],
    stack: hero.stack,
  };
}

/** Apply the hero's decision. Records the snapshot the coach grades later. */
export function heroAct(session, action, amount = 0) {
  const hand = session.hand;
  const hero = hand.seats.find((s) => s.isHero);
  const toCall = hand.currentBet - hero.streetPut;

  hand.decisions.push({
    street: hand.street,
    board: [...hand.board],
    pot: potTotal(hand),
    toCall: Math.max(toCall, 0),
    heroStack: hero.stack,
    heroPosition: hero.position,
    action,
    amount,
    // Preflop, a player who has not acted yet is not in the pot — they fold
    // most hands, and counting them as live opposition wrecks the price math.
    // After the flop everyone still seated has a real range, acted or not.
    villains: hand.seats
      .filter((s) => !s.isHero && !s.folded && (hand.street !== 'preflop' || s.lastAction !== null))
      .map((s) => ({
        position: s.position,
        type: s.type,
        stack: s.stack,
        role: s.preflopRole ?? 'blind',
        streetAction: s.lastStreetActed === hand.street ? mapStreetAction(s.lastAction) : 'checked',
        cards: [...s.cards],
      })),
  });

  applyAction(session, hand, hero, action, amount);
  const cfg = session.config;
  const money = (n) => `${cfg.currency}${Math.round(n * 100) / 100}`;
  const text =
    action === 'fold' ? 'You fold' :
    action === 'check' ? 'You check' :
    action === 'call' ? `You call ${money(hero.streetPut)}${hero.allIn ? ' — all in' : ''}` :
    `You ${hand.raisesThisStreet > 1 ? 'raise to' : 'bet'} ${money(hero.streetPut)}${hero.allIn ? ' — all in' : ''}`;
  log(hand, { kind: 'hero', action, amount: hero.streetPut, pot: potTotal(hand), text });
  return { kind: 'hero-acted', action, pot: potTotal(hand), text };
}

const mapStreetAction = (a) => (a === 'bet' ? 'bet' : a === 'raise' ? 'raised' : a === 'call' ? 'called' : 'checked');

/* ----------------------------------------------------------------- endings */

function finishUncontested(session, hand, winner) {
  const total = potTotal(hand);
  const won = new Map([[winner.id, total]]);
  const results = {
    kind: 'uncontested',
    pots: [{ amount: total, winners: [winner.id] }],
    winnersText: winner.isHero ? 'You take it down uncontested.' : `${positionById(winner.position).name} takes it uncontested.`,
    reveal: revealAll(hand),
    heroNet: heroNet(hand, won),
    potTotal: total,
    board: [...hand.board],
  };
  return conclude(session, hand, results, won);
}

function finishShowdown(session, hand) {
  const contenders = hand.seats.filter((s) => !s.folded);
  const scores = new Map(contenders.map((s) => [s.id, evaluate([...s.cards, ...hand.board], 7)]));

  // Side pots from contribution levels.
  const remaining = new Map(hand.seats.map((s) => [s.id, s.contributed]));
  const pots = [];
  for (;;) {
    const live = contenders.filter((s) => remaining.get(s.id) > 0);
    if (live.length === 0) {
      const residue = [...remaining.values()].reduce((a, b) => a + b, 0);
      if (residue > 0 && pots.length > 0) pots[pots.length - 1].amount += residue;
      break;
    }
    const level = Math.min(...live.map((s) => remaining.get(s.id)));
    let amount = 0;
    for (const seat of hand.seats) {
      const take = Math.min(remaining.get(seat.id), level);
      remaining.set(seat.id, remaining.get(seat.id) - take);
      amount += take;
    }
    const eligible = live.map((s) => s.id);
    const best = Math.max(...eligible.map((id) => scores.get(id)));
    pots.push({ amount, eligible, winners: eligible.filter((id) => scores.get(id) === best) });
  }

  const won = new Map();
  for (const pot of pots) {
    for (const id of pot.winners) won.set(id, (won.get(id) ?? 0) + pot.amount / pot.winners.length);
  }

  const hero = hand.seats.find((s) => s.isHero);
  const heroWon = won.get(hero.id) ?? 0;
  const winnerNames = [...won.keys()].map((id) => {
    const seat = hand.seats.find((s) => s.id === id);
    return seat.isHero ? 'you' : positionById(seat.position).name;
  });

  const results = {
    kind: 'showdown',
    pots,
    scores: Object.fromEntries(scores),
    winnersText:
      heroWon > 0
        ? won.size > 1
          ? `Split pot between ${winnerNames.join(' and ')}.`
          : `You win it with ${describe(scores.get(hero.id))}.`
        : `${winnerNames.join(' and ')} wins with ${describe(Math.max(...scores.values()))}.`,
    reveal: revealAll(hand),
    heroNet: heroNet(hand, won),
    potTotal: potTotal(hand),
    board: [...hand.board],
  };
  return conclude(session, hand, results, won);
}

function heroNet(hand, won) {
  const hero = hand.seats.find((s) => s.isHero);
  return (won.get(hero.id) ?? 0) - hero.contributed;
}

function revealAll(hand) {
  return hand.seats.map((s) => ({
    seat: s.id,
    isHero: s.isHero,
    position: s.position,
    type: s.type,
    cards: [...s.cards],
    folded: s.folded,
    tilt: s.tilt ?? 0,
    handName: hand.board.length >= 3 ? describe(evaluate([...s.cards, ...hand.board.slice(0, 5)], 2 + Math.min(hand.board.length, 5))) : null,
    showedDown: !s.folded && hand.street === 'river',
  }));
}

function conclude(session, hand, results, won) {
  hand.finished = true;
  hand.results = results;
  session.handsPlayed += 1;
  session.net += results.heroNet;

  // Pay the pots out into the stacks, and carry every stack to the next hand.
  for (const [id, amount] of won) hand.seats.find((s) => s.id === id).stack += amount;
  for (const seat of hand.seats) {
    session.stacks[seat.id] = seat.stack;
    if (seat.isHero) continue;
    // Losing a big pot leaves a mark; it fades over the next few hands.
    const net = seat.stack - seat.startStack;
    const stinger = Math.max(20 * session.config.bigBlind, seat.startStack * 0.33);
    session.tilt[seat.id] *= 0.45;
    if (net <= -stinger) session.tilt[seat.id] = Math.max(session.tilt[seat.id], TILT_PRONE[seat.type] ?? 0.5);
    if (session.tilt[seat.id] < 0.08) session.tilt[seat.id] = 0;
  }

  log(hand, { kind: 'result', text: results.winnersText });
  return { kind: 'over', results };
}

function log(hand, entry) {
  hand.log.push({ street: hand.street, ...entry });
}
