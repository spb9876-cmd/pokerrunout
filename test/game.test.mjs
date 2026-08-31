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
    assert.ok(results.heroNet >= -CONFIG.heroStack - 1e-9, 'cannot lose more than the stack');
    const others = CONFIG.villains.reduce((s, v) => s + v.stack, 0);
    assert.ok(results.heroNet <= others + 1e-9, 'cannot win more than the table has');
  }
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
