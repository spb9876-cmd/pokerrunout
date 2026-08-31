import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCards } from '../js/cards.js';
import { readHand, drawsFor, strengthOnBoard } from '../js/handstrength.js';

const read = (hole, board) => readHand(parseCards(hole), parseCards(board));
const draws = (hole, board) => drawsFor(parseCards(hole), parseCards(board));

test('names made hands the way players do', () => {
  assert.equal(read('Ah Kd', 'Ks 8d 3c').made, 'top pair, top kicker');
  assert.equal(read('Kh 4d', 'Ks 8d 3c').made, 'top pair, weak kicker');
  assert.equal(read('8h 7d', 'Ks 8d 3c').made, 'second pair, weak kicker');
  assert.equal(read('8h Td', 'Ks 8d 3c').made, 'second pair, medium kicker');
  assert.equal(read('Kh Jd', 'Ks 8d 3c').made, 'top pair, good kicker');
  assert.equal(read('Ah Ad', 'Ks 8d 3c').made, 'an overpair');
  assert.match(read('7h 7d', 'Ks 8d 3c').made, /underpair/);
  assert.equal(read('8h 8s', 'Ks 8d 3c').made, 'a set');
  assert.equal(read('Ah 8s', 'Ks 8d 8c').made, 'trips');
  assert.equal(read('Kh 8d', 'Ks 8c 3c').made, 'two pair, top and eights');
  assert.equal(read('Qh Jd', 'Ks 8d 3c').made, 'no pair');
  assert.equal(read('Ah Qd', 'Ks 8d 3c').made, 'A high, no pair');
});

test('spots draws, and only the ones the hole cards are in', () => {
  assert.equal(draws('Ah 5h', 'Kh 8h 3c').flushDraw, true);
  assert.equal(draws('Ac 5d', 'Kh 8h 3h').flushDraw, false, 'a board flush draw is not our draw');
  assert.equal(draws('Th 9h', 'Js 8d 3c').openEnded, true);
  assert.equal(draws('Th 9h', 'Js 7d 3c').gutshot, true);
  assert.equal(draws('Ah Kh', '9h 4h 2c').flushDraw, true);
  assert.equal(draws('Ah Kd', 'Qs Jd Tc').openEnded, false, 'already a straight, not a draw');
  assert.equal(draws('Ah Kd', '9s 4d 2c').overcards, 2);
  assert.equal(draws('Ah 5h', 'Kh 8h 3c 2d 7s').flushDraw, false, 'no draws once the board is complete');
});

test('reads a combo draw as both draws at once', () => {
  const r = read('Th 9h', 'Jh 8h 3c');
  assert.match(r.drawText, /flush draw/);
  assert.match(r.drawText, /open-ended/);
});

test('strength ranks holdings sensibly on a board', () => {
  const board = 'Ks 8h 3h';
  const rank = (hole) => strengthOnBoard(parseCards(hole), parseCards(board));
  assert.ok(rank('8s 8d') > rank('Ah Kd'), 'a set beats top pair');
  assert.ok(rank('Ah Kd') > rank('Kc 4d'), 'kickers matter');
  assert.ok(rank('Ah Qh') > rank('Ac Qd'), 'a flush draw is worth more than the same hand without it');
  assert.ok(rank('Ah Qh') > rank('7c 7d'), 'nut flush draw outranks a weak underpair');
  assert.ok(rank('Qc Jd') < rank('3c 4d'), 'bottom pair beats two overcards');
});
