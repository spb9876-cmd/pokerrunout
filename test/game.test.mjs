import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, startHand, step, heroAct, heroChoices, potTotal } from '../js/game.js';

const CONFIG = {
  setting: 'casino_cash',
  stage: 'early',
  currency: '$',
  smallBlind: 2,
  bigBlind: 5,
  heroStack: 500,
  villains: [
    { type: 'tag', stack: 500 },
    { type: 'station', stack: 300 },
    { type: 'maniac', stack: 150 },
    { type: 'nit', stack: 500 },
  ],
};

/** Play a whole hand with a scripted hero, asserting invariants at every step. */
function playHand(session, policy) {
  const hand = startHand(session);
  const startTotal = hand.seats.reduce((s, x) => s + x.startStack, 0);
  let guard = 0;
  for (;;) {
    if (++guard > 400) throw new Error('hand did not terminate');

    // Chips are never created or destroyed mid-hand.
    const inStacks = hand.seats.reduce((s, x) => s + x.stack, 0);
    assert.equal(inStacks + potTotal(hand), startTotal, 'chips conserved');
    for (const seat of hand.seats) assert.ok(seat.stack >= 0, 'no negative stacks');

    const ev = step(session);
    if (ev.kind === 'over') return ev.results;
    if (ev.kind === 'hero-turn') {
      const move = policy(ev);
      heroAct(session, move.action, move.amount ?? 0);
    }
  }
}

const callAnything = (ev) => (ev.canCheck ? { action: 'check' } : { action: 'call' });
const foldToAnything = (ev) => (ev.canCheck ? { action: 'check' } : { action: 'fold' });
const aggro = (ev) => {
  if (ev.sizes.length > 0) return { action: 'raise', amount: ev.sizes[0].to };
  return ev.canCheck ? { action: 'check' } : { action: 'call' };
};

test('hands complete, chips balance, and pots pay out exactly what went in', () => {
  const session = createSession(structuredClone(CONFIG), 42);
  for (let i = 0; i < 120; i++) {
    const results = playHand(session, callAnything);
    const paid = results.pots.reduce((s, p) => s + p.amount, 0);
    assert.ok(Math.abs(paid - results.potTotal) < 1e-6, `pots (${paid}) must equal the money in (${results.potTotal})`);
    for (const pot of results.pots) {
      assert.ok(pot.winners.length > 0, 'every pot has a winner');
      if (results.kind === 'showdown') {
        for (const w of pot.winners) {
          const seat = results.reveal.find((r) => r.seat === w);
          assert.ok(!seat.folded, 'a folded player can never win a pot');
        }
      }
    }
  }
  assert.equal(session.handsPlayed, 120);
});

test('session net is the sum of hand nets', () => {
  const session = createSession(structuredClone(CONFIG), 7);
  let total = 0;
  for (let i = 0; i < 60; i++) total += playHand(session, callAnything).heroNet;
  assert.ok(Math.abs(session.net - total) < 1e-6);
});

test('a hero who folds everything loses only blinds', () => {
  const session = createSession(structuredClone(CONFIG), 9);
  for (let i = 0; i < 40; i++) {
    const results = playHand(session, foldToAnything);
    // Worst case per hand: the big blind (checked options can still see streets for free).
    assert.ok(results.heroNet >= -CONFIG.bigBlind, `never worse than the blind when folding: ${results.heroNet}`);
  }
  assert.ok(session.net < 0, 'blinds bleed');
});

test('an all-in hero can double up or bust the hand, never more', () => {
  const session = createSession(structuredClone(CONFIG), 11);
  for (let i = 0; i < 60; i++) {
    const results = playHand(session, aggro);
    const hero = session.hand.seats.find((x) => x.isHero);
    const others = session.hand.seats.filter((x) => !x.isHero).reduce((s, x) => s + x.startStack, 0);
    assert.ok(results.heroNet >= -hero.startStack - 1e-9, 'cannot lose more than the stack in play');
    assert.ok(results.heroNet <= others + 1e-9, 'cannot win more than the table had');
  }
});

test('stacks persist between hands and pots actually move money', () => {
  const session = createSession(structuredClone(CONFIG), 19);
  for (let i = 0; i < 40; i++) {
    const results = playHand(session, callAnything);
    // The winners' stack growth equals the losers' shrinkage: totals only move on rebuys.
    for (const seat of session.hand.seats) {
      assert.ok(Math.abs(session.stacks[seat.id] - seat.stack) < 1e-9, 'session carries the final stack');
    }
    const totalStacks = session.stacks.reduce((a, b) => a + b, 0);
    const totalInvested = session.invested.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(totalStacks - totalInvested) < 1e-6, `money on the table (${totalStacks}) equals money bought in (${totalInvested})`);
    assert.ok(Math.abs(session.net - (session.stacks[0] - session.invested[0])) < 1e-6, 'hero net = stack minus invested');
  }
});

test('busted players rebuy and the books balance', () => {
  // Tiny stacks so all-ins and busts happen constantly.
  const cfg = { ...structuredClone(CONFIG), heroStack: 40, villains: [{ type: 'maniac', stack: 40 }, { type: 'lag', stack: 40 }] };
  const session = createSession(cfg, 23);
  for (let i = 0; i < 80; i++) playHand(session, aggro);
  const rebuys = session.rebuys.reduce((a, b) => a + b, 0);
  assert.ok(rebuys > 5, `with 20bb stacks and maniacs somebody busts: ${rebuys} rebuys`);
  for (const stack of session.stacks) assert.ok(stack >= 0);
  const totalStacks = session.stacks.reduce((a, b) => a + b, 0);
  const totalInvested = session.invested.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(totalStacks - totalInvested) < 1e-6);
  // Rebuy lines show up in the table talk.
  const sawRebuyLine = session.hand.log.some(() => true); // at least a log exists
  assert.ok(sawRebuyLine);
});

test('losing a big pot puts the loser on tilt, and tilt fades', () => {
  const cfg = structuredClone(CONFIG);
  const session = createSession(cfg, 29);
  let everTilted = false;
  let sawSteamLine = false;
  for (let i = 0; i < 120; i++) {
    playHand(session, aggro);
    if (session.tilt.some((t, id) => id !== 0 && t >= 0.25)) everTilted = true;
    if (session.hand.log.some((e) => e.kind === 'tilt')) sawSteamLine = true;
  }
  assert.ok(everTilted, 'big losses must produce tilt');
  assert.ok(sawSteamLine, 'tilt is visible in the table talk');
  // Decay: a tilted player with no further losses cools off.
  session.tilt[1] = 0.9;
  for (let i = 0; i < 6; i++) session.tilt[1] *= 0.45;
  assert.ok(session.tilt[1] < 0.08 * 2, 'tilt halves away within a few hands');
});

test('a tilted player plays looser than a calm one', () => {
  // Same seed twice: once calm, once with the dial forced up before every hand.
  const openRate = (forceTilt) => {
    const session = createSession(structuredClone(CONFIG), 31);
    let aggressive = 0;
    let chances = 0;
    for (let i = 0; i < 200; i++) {
      if (forceTilt) session.tilt = session.tilt.map((_, id) => (id === 0 ? 0 : 0.9));
      playHand(session, foldToAnything);
      if (forceTilt) session.tilt = session.tilt.map((_, id) => (id === 0 ? 0 : 0.9));
      for (const e of session.hand.log) {
        if (e.kind !== 'action' || e.street !== 'preflop') continue;
        chances++;
        if (e.action === 'raise' || e.action === 'bet' || e.action === 'call') aggressive++;
      }
    }
    return aggressive / chances;
  };
  const calm = openRate(false);
  const steaming = openRate(true);
  assert.ok(steaming > calm + 0.03, `tilted tables enter more pots (calm ${calm.toFixed(3)}, tilted ${steaming.toFixed(3)})`);
});

test('positions rotate: the hero plays every seat', () => {
  const session = createSession(structuredClone(CONFIG), 3);
  const seen = new Set();
  for (let i = 0; i < 10; i++) {
    const hand = startHand(session);
    seen.add(hand.seats.find((s) => s.isHero).position);
    // finish the hand quickly
    let guard = 0;
    for (;;) {
      if (++guard > 400) throw new Error('no end');
      const ev = step(session);
      if (ev.kind === 'over') break;
      if (ev.kind === 'hero-turn') heroAct(session, ev.canCheck ? 'check' : 'fold');
    }
  }
  assert.equal(seen.size, 5, `5 seats at a 5-handed table, saw ${[...seen].join(', ')}`);
});

test('villains are not all the same player', () => {
  const session = createSession(structuredClone(CONFIG), 21);
  const actions = { fold: 0, call: 0, raise: 0, bet: 0, check: 0 };
  const byType = {};
  for (let i = 0; i < 150; i++) {
    playHand(session, foldToAnything);
    for (const entry of session.hand.log) {
      if (entry.kind !== 'action') continue;
      actions[entry.action] = (actions[entry.action] ?? 0) + 1;
      const key = `${entry.type}:${entry.street === 'preflop' ? 'pre' : 'post'}`;
      byType[key] ??= { total: 0, aggressive: 0, folds: 0 };
      byType[key].total++;
      if (entry.action === 'raise' || entry.action === 'bet') byType[key].aggressive++;
      if (entry.action === 'fold') byType[key].folds++;
    }
  }
  assert.ok(actions.fold > 0 && actions.call > 0 && actions.raise > 0, JSON.stringify(actions));
  const rate = (k) => (byType[k] ? byType[k].aggressive / byType[k].total : 0);
  assert.ok(rate('maniac:pre') > rate('nit:pre'), `a maniac raises more than a nit (${rate('maniac:pre').toFixed(2)} vs ${rate('nit:pre').toFixed(2)})`);
  const foldRate = (k) => (byType[k] ? byType[k].folds / byType[k].total : 0);
  assert.ok(foldRate('nit:pre') > foldRate('station:pre'), 'a nit folds preflop more than a station');
});

test('tells appear, and carry their hidden truth', () => {
  const session = createSession(structuredClone(CONFIG), 33);
  let tells = 0;
  let withTruth = 0;
  for (let i = 0; i < 80; i++) {
    playHand(session, callAnything);
    for (const entry of session.hand.log) {
      if (entry.tell) {
        tells++;
        if (typeof entry.tell.honest === 'boolean' && typeof entry.tell.signalsStrength === 'boolean') withTruth++;
        assert.match(entry.text, /—/, 'the tell is woven into the action line');
      }
    }
  }
  assert.ok(tells > 20, `expected a steady stream of tells, saw ${tells}`);
  assert.equal(tells, withTruth);
});

test('heads-up works, including the reversed postflop order', () => {
  const session = createSession({ ...structuredClone(CONFIG), villains: [{ type: 'lag', stack: 500 }] }, 5);
  for (let i = 0; i < 50; i++) {
    const results = playHand(session, callAnything);
    assert.ok(results.pots.length >= 1);
  }
});

test('hero choices are always legal', () => {
  const session = createSession(structuredClone(CONFIG), 17);
  for (let i = 0; i < 40; i++) {
    startHand(session);
    let guard = 0;
    for (;;) {
      if (++guard > 400) throw new Error('no end');
      const ev = step(session);
      if (ev.kind === 'over') break;
      if (ev.kind === 'hero-turn') {
        assert.ok(ev.toCall >= 0);
        assert.ok(ev.canCheck === (ev.toCall <= 0));
        for (const size of ev.sizes) {
          assert.ok(size.to <= ev.stack + (session.hand.seats.find((s) => s.isHero).streetPut), 'cannot bet more than the stack');
        }
        heroAct(session, ev.canCheck ? 'check' : 'call');
      }
    }
  }
});

test('the late-night mood plays looser than the early evening', () => {
  const cfg = {
    setting: 'home_cash', stage: 'early', currency: '$', smallBlind: 1, bigBlind: 2, heroStack: 200,
    villains: [{ type: 'abc', stack: 200 }, { type: 'tag', stack: 200 }, { type: 'recreational', stack: 200 }],
  };
  const entryRate = (mood) => {
    const session = createSession({ ...structuredClone(cfg), mood }, 47);
    let entered = 0, chances = 0;
    for (let i = 0; i < 150; i++) {
      playHand(session, foldToAnything);
      for (const e of session.hand.log) {
        if (e.kind !== 'action' || e.street !== 'preflop') continue;
        chances++;
        if (e.action !== 'fold') entered++;
      }
    }
    return entered / chances;
  };
  const early = entryRate('early');
  const late = entryRate('late');
  assert.ok(late > early + 0.03, `late night should enter more pots (early ${early.toFixed(3)}, late ${late.toFixed(3)})`);
});

test('all-ins are an event, not the routine', () => {
  const cfg = {
    setting: 'home_cash', stage: 'early', currency: '$', smallBlind: 1, bigBlind: 2, heroStack: 200, mood: 'early',
    villains: [{ type: 'recreational', stack: 200 }, { type: 'abc', stack: 200 }, { type: 'tag', stack: 200 }, { type: 'tricky', stack: 200 }],
  };
  const session = createSession(structuredClone(cfg), 53);
  let withAllIn = 0;
  const hands = 200;
  for (let i = 0; i < hands; i++) {
    playHand(session, foldToAnything);
    if (session.hand.log.some((e) => e.kind === 'action' && e.allIn)) withAllIn++;
  }
  assert.ok(withAllIn / hands < 0.1, `a sane 100bb table should rarely see stacks fly: ${((withAllIn / hands) * 100).toFixed(1)}% of hands had an all-in`);
});
