import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCards, combosOf } from '../js/cards.js';
import { equityVsRanges, exactEquity } from '../js/equity.js';

const fixed = (hand) => ({ combos: [parseCards(hand)] });
const close = (actual, expected, tol, label) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: got ${actual.toFixed(4)}, wanted ~${expected} (±${tol})`);

test('exact enumeration reproduces published all-in equities', () => {
  // Suits are chosen to match the standard quoted matchups.
  const cases = [
    ['As Ah', 'Ks Kd', 0.8, 0.83], // overpair vs underpair
    ['As Ks', 'Qh Qd', 0.45, 0.47], // suited overcards vs pair
    ['Ah Kd', 'Qh Qd', 0.42, 0.45], // offsuit overcards vs pair
    ['As Ah', '7c 2d', 0.86, 0.89], // best vs worst
    ['9h 8h', 'Ac Kd', 0.38, 0.42], // suited connector vs two overs
  ];
  for (const [hero, villain, lo, hi] of cases) {
    const { equity } = exactEquity({ hero: parseCards(hero), board: [], villains: [fixed(villain)] });
    assert.ok(equity >= lo && equity <= hi, `${hero} vs ${villain}: got ${equity.toFixed(4)}, wanted ${lo}..${hi}`);
  }
});

test('monte carlo agrees with exact enumeration', () => {
  const spots = [
    { hero: 'As Ks', board: '', villain: 'Qh Qd' },
    { hero: 'Jc Th', board: '9s 8d 2c', villain: 'Ah Ad' },
    { hero: '7c 7d', board: 'Ks 9h 4c 2d', villain: 'Ah Kd' },
  ];
  for (const s of spots) {
    const spec = { hero: parseCards(s.hero), board: s.board ? parseCards(s.board) : [], villains: [fixed(s.villain)] };
    const truth = exactEquity(spec).equity;
    const mc = equityVsRanges({ ...spec, trials: 60000, seed: 7 }).equity;
    close(mc, truth, 0.01, `${s.hero} on ${s.board || 'preflop'}`);
  }
});

test('equity shares sum to one across the table', () => {
  const r = equityVsRanges({
    hero: parseCards('As Ks'),
    board: parseCards('Qs Jd 4c'),
    villains: [fixed('Qh Jh'), fixed('7c 7d')],
    trials: 20000,
    seed: 11,
  });
  const total = r.equity + r.villains.reduce((s, v) => s + v.equity, 0);
  close(total, 1, 1e-9, 'total equity');
});

test('the nuts is 100% and a dead hand is 0%', () => {
  const locked = equityVsRanges({
    hero: parseCards('As Ks'),
    board: parseCards('Qs Js Ts'),
    villains: [fixed('Ac Ad')],
    trials: 3000,
    seed: 3,
  });
  assert.equal(locked.equity, 1);

  const dead = equityVsRanges({
    hero: parseCards('2c 3d'),
    board: parseCards('As Kd Qh Js 4c'),
    villains: [fixed('Th 9h')],
    trials: 500,
    seed: 3,
  });
  assert.equal(dead.equity, 0);
});

test('a board that plays itself splits the pot', () => {
  const r = equityVsRanges({
    hero: parseCards('2c 3d'),
    board: parseCards('As Ks Qs Js Ts'),
    villains: [fixed('4c 5d')],
    trials: 500,
    seed: 3,
  });
  assert.equal(r.equity, 0.5);
  assert.equal(r.tie, 1);
});

test('equity against a range sits between its best and worst members', () => {
  const range = { combos: [...combosOf('AA'), ...combosOf('72o')] };
  const r = equityVsRanges({ hero: parseCards('Kh Kd'), board: [], villains: [range], trials: 40000, seed: 5 });
  assert.ok(r.equity > 0.3 && r.equity < 0.9, `got ${r.equity}`);
});
