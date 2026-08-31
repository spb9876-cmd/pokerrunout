import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRange, rangeToCombos, rangeWeight, rangePercent, topPercentCodes, rangeToText } from '../js/ranges.js';
import { parseCards } from '../js/cards.js';
import { PREFLOP_ORDER, RANGE_CUTOFF } from '../js/data/preflop.js';

const codes = (text) => [...parseRange(text).weights.keys()].sort();

test('reads single hands', () => {
  assert.deepEqual(codes('AA'), ['AA']);
  assert.deepEqual(codes('AKs'), ['AKs']);
  assert.deepEqual(codes('kqo'), ['KQo']);
  assert.deepEqual(codes('AK'), ['AKo', 'AKs']);
  assert.deepEqual(codes('ka'), ['AKo', 'AKs']); // order of the two cards does not matter
});

test('reads plus ranges', () => {
  assert.deepEqual(codes('TT+'), ['AA', 'JJ', 'KK', 'QQ', 'TT']);
  assert.deepEqual(codes('AJs+'), ['AJs', 'AKs', 'AQs']);
  assert.deepEqual(codes('KTo+'), ['KJo', 'KQo', 'KTo']);
});

test('reads dash ranges', () => {
  assert.deepEqual(codes('77-44'), ['44', '55', '66', '77']);
  assert.deepEqual(codes('AJs-A8s'), ['A8s', 'A9s', 'AJs', 'ATs']);
  assert.deepEqual(codes('T9s-65s'), ['65s', '76s', '87s', '98s', 'T9s']);
});

test('reads lists, weights and percentages', () => {
  assert.deepEqual(codes('AA, KK, AKs'), ['AA', 'AKs', 'KK']);
  const { weights } = parseRange('AA, AKo:0.5, QQ:50%');
  assert.equal(weights.get('AA'), 1);
  assert.equal(weights.get('AKo'), 0.5);
  assert.equal(weights.get('QQ'), 0.5);

  const top10 = parseRange('top 10%');
  assert.ok(Math.abs(rangePercent(top10.weights) - 0.1) < 0.02, rangePercent(top10.weights));
  assert.ok(top10.weights.has('AA') && top10.weights.has('AKs'));
  assert.ok(!top10.weights.has('72o'));

  assert.equal(rangeWeight(parseRange('any').weights), 1326);
});

test('flags text it cannot read instead of throwing', () => {
  const { weights, warnings } = parseRange('AA, banana, KK');
  assert.deepEqual([...weights.keys()].sort(), ['AA', 'KK']);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /banana/);
});

test('expands to combos and removes blocked cards', () => {
  const { weights } = parseRange('AA');
  assert.equal(rangeToCombos(weights).combos.length, 6);
  // Holding one ace leaves three combos of aces.
  assert.equal(rangeToCombos(weights, parseCards('As')).combos.length, 3);
  assert.equal(rangeToCombos(weights, parseCards('As Ah')).combos.length, 1);

  const suited = parseRange('AKs').weights;
  assert.equal(rangeToCombos(suited).combos.length, 4);
  assert.equal(rangeToCombos(parseRange('AKo').weights).combos.length, 12);
});

test('weighted ranges build a cumulative table, flat ones do not', () => {
  assert.equal(rangeToCombos(parseRange('AA, KK').weights).cumulative, null);
  const w = rangeToCombos(parseRange('AA, KK:0.5').weights);
  assert.ok(w.cumulative instanceof Float64Array);
  assert.equal(w.cumulative[w.cumulative.length - 1], 6 * 1 + 6 * 0.5);
});

test('the hand ordering is complete and monotonic', () => {
  assert.equal(PREFLOP_ORDER.length, 169);
  assert.equal(new Set(PREFLOP_ORDER).size, 169);
  assert.equal(PREFLOP_ORDER[0], 'AA');
  let last = 0;
  for (const code of PREFLOP_ORDER) {
    assert.ok(RANGE_CUTOFF[code] > last, `cutoffs must increase at ${code}`);
    last = RANGE_CUTOFF[code];
  }
  assert.ok(Math.abs(last - 1) < 1e-6, `cutoffs must reach 1, got ${last}`);
});

test('the ordering agrees with how hold\'em hands actually rank', () => {
  const rank = (c) => PREFLOP_ORDER.indexOf(c);
  const beats = [
    ['AA', 'KK'], ['KK', 'QQ'], ['QQ', 'JJ'],
    ['AKs', 'AKo'], ['AKs', 'JJ'], ['AKo', 'ATs'],
    ['AQs', 'AQo'], ['KQs', 'KQo'], ['TT', '99'],
    ['JTs', 'J9s'], ['87s', '86s'], ['A5s', 'A5o'], ['22', '32o'],
  ];
  for (const [better, worse] of beats) {
    assert.ok(rank(better) < rank(worse), `${better} should rank above ${worse}`);
  }
  assert.equal(topPercentCodes(0.01)[0], 'AA');
});

test('renders a range back to text', () => {
  const text = rangeToText(parseRange('AA, KK, AKs').weights);
  assert.equal(text, 'AA, KK, AKs');
});
