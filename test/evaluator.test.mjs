import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCards } from '../js/cards.js';
import { evaluate, categoryOf, describe, CATEGORY } from '../js/evaluator.js';

const cat = (s) => categoryOf(evaluate(parseCards(s)));
const val = (s) => evaluate(parseCards(s));

test('classifies five-card hands', () => {
  assert.equal(cat('As Ks Qs Js Ts'), CATEGORY.STRAIGHT_FLUSH);
  assert.equal(cat('5s 4s 3s 2s As'), CATEGORY.STRAIGHT_FLUSH);
  assert.equal(cat('9c 9d 9h 9s 2c'), CATEGORY.QUADS);
  assert.equal(cat('9c 9d 9h 2s 2c'), CATEGORY.FULL_HOUSE);
  assert.equal(cat('Ac Jc 8c 5c 2c'), CATEGORY.FLUSH);
  assert.equal(cat('5c 4d 3h 2s Ac'), CATEGORY.STRAIGHT);
  assert.equal(cat('Ac Ad Ah 5s 2c'), CATEGORY.TRIPS);
  assert.equal(cat('Ac Ad 5h 5s 2c'), CATEGORY.TWO_PAIR);
  assert.equal(cat('Ac Ad 9h 5s 2c'), CATEGORY.PAIR);
  assert.equal(cat('Ac Jd 9h 5s 2c'), CATEGORY.HIGH_CARD);
});

test('picks the best five out of seven', () => {
  // Board pairs the turn; hero plays trips, not two pair.
  assert.equal(cat('Ac Ad Kh Qs 2c 2d 2h'), CATEGORY.FULL_HOUSE);
  // Six to a flush.
  assert.equal(cat('Ac Jc 8c 5c 2c Kd Qh'), CATEGORY.FLUSH);
  // Straight using exactly one hole card.
  assert.equal(cat('9h 2c 8d 7s 6h 5c Ad'), CATEGORY.STRAIGHT);
});

test('orders hands within a category', () => {
  assert.ok(val('Ah Ad Ac Ks Kd') > val('Ah Ad Ac Qs Qd'), 'aces full beats aces full of queens');
  assert.ok(val('Ac Kc Qc Jc 9c') > val('Ac Kc Qc Tc 9c'), 'flush kickers compare in order');
  assert.ok(val('Ac Ad Kh Qs Jc') > val('Ac Ad Kh Qs Tc'), 'pair kickers compare in order');
  assert.ok(val('6s 5s 4s 3s 2s') > val('Ac Ad Ah As Kc'), 'straight flush beats quads');
  assert.ok(val('Ah Kh Qh Jh Th') > val('6s 5s 4s 3s 2s'), 'royal is the top straight flush');
});

test('ties are exactly equal', () => {
  assert.equal(val('Ac Ad Kh Qs Jc'), val('As Ah Kd Qc Jd'));
  assert.equal(val('5s 4s 3s 2s As Kh Qd'), val('5c 4c 3c 2c Ac Kd Qs'));
});

test('every five-card hand lands in the right category', () => {
  const counts = new Array(9).fill(0);
  const hand = new Int32Array(5);
  for (let a = 0; a < 52; a++) {
    hand[0] = a;
    for (let b = a + 1; b < 52; b++) {
      hand[1] = b;
      for (let c = b + 1; c < 52; c++) {
        hand[2] = c;
        for (let d = c + 1; d < 52; d++) {
          hand[3] = d;
          for (let e = d + 1; e < 52; e++) {
            hand[4] = e;
            counts[categoryOf(evaluate(hand, 5))]++;
          }
        }
      }
    }
  }
  assert.deepEqual(counts, [1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40]);
});

test('describes hands in words', () => {
  assert.equal(describe(val('Ah Kh Qh Jh Th')), 'royal flush');
  assert.equal(describe(val('Ac Ad 5h 5s 2c')), 'two pair, aces and fives');
  assert.equal(describe(val('7c 7d 7h 2s 2c')), 'sevens full of deuces');
  assert.equal(describe(val('6c 6d 6h 6s 2c')), 'four sixes');
});
