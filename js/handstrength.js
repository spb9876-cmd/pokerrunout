// What a holding actually is on a given board: the made hand in the terms
// players use ("top pair, weak kicker"), plus the draws it carries.

import { evaluate, categoryOf, CATEGORY, describe } from './evaluator.js';
import { rankOf, suitOf, RANKS } from './cards.js';

const CAT_UNIT = 13 ** 5;

// Draw value expressed in category units, so a hand with a flush draw sorts
// roughly one made-hand class above where its current showdown value puts it.
const DRAW_VALUE = {
  flushDraw: 1.15,
  openEnded: 0.95,
  gutshot: 0.4,
  backdoorFlush: 0.12,
  overcards: 0.18,
};

/** Which ranks would complete a straight if they arrived. */
function straightOuts(ranks) {
  const present = new Set(ranks);
  const outs = [];
  for (let r = 0; r < 13; r++) {
    if (present.has(r)) continue;
    const withCard = new Set(present);
    withCard.add(r);
    let mask = 0;
    for (const x of withCard) mask |= 1 << x;
    const m = ((mask << 1) | ((mask >> 12) & 1)) & 0x3fff;
    let made = false;
    for (let h = 13; h >= 4; h--) {
      if (((m >> (h - 4)) & 0b11111) === 0b11111) {
        made = true;
        break;
      }
    }
    if (made) outs.push(r);
  }
  return outs;
}

/** Draws available to `hole` on `board`, counting only draws the hole cards are part of. */
export function drawsFor(hole, board) {
  const all = [...hole, ...board];
  const draws = { flushDraw: false, backdoorFlush: false, openEnded: false, gutshot: false, overcards: 0, straightOuts: 0, flushOuts: 0 };
  if (board.length >= 5) return draws; // nothing left to come

  const suitCounts = [0, 0, 0, 0];
  for (const c of all) suitCounts[suitOf(c)]++;
  for (let s = 0; s < 4; s++) {
    const heroHasSuit = hole.some((c) => suitOf(c) === s);
    if (!heroHasSuit) continue;
    if (suitCounts[s] === 4) {
      draws.flushDraw = true;
      draws.flushOuts = 13 - 4;
    } else if (suitCounts[s] === 3 && board.length === 3) {
      draws.backdoorFlush = true;
    }
  }

  const madeCat = categoryOf(evaluate(all, all.length));
  if (madeCat < CATEGORY.STRAIGHT) {
    const outs = straightOuts(all.map(rankOf));
    // Only count it if the hole cards are contributing to the draw.
    const boardOnlyOuts = straightOuts(board.map(rankOf));
    const added = outs.filter((r) => !boardOnlyOuts.includes(r));
    draws.straightOuts = added.length;
    if (added.length >= 2) draws.openEnded = true;
    else if (added.length === 1) draws.gutshot = true;
  }

  const highBoard = board.length ? Math.max(...board.map(rankOf)) : -1;
  draws.overcards = hole.filter((c) => rankOf(c) > highBoard).length;
  return draws;
}

const PAIR_NAMES = ['top pair', 'second pair', 'third pair', 'fourth pair', 'bottom pair'];

/** Plain-language label for the made hand, e.g. "top pair, weak kicker". */
export function labelMadeHand(hole, board) {
  const score = evaluate([...hole, ...board], hole.length + board.length);
  const cat = categoryOf(score);
  if (board.length === 0) {
    const [a, b] = hole;
    if (rankOf(a) === rankOf(b)) return `pocket ${RANKS[rankOf(a)]}s`;
    const hi = Math.max(rankOf(a), rankOf(b));
    const lo = Math.min(rankOf(a), rankOf(b));
    return `${RANKS[hi]}${RANKS[lo]}${suitOf(a) === suitOf(b) ? ' suited' : ' offsuit'}`;
  }

  const boardRanks = [...new Set(board.map(rankOf))].sort((a, b) => b - a);
  const holeRanks = hole.map(rankOf);
  const pocketPair = holeRanks[0] === holeRanks[1];

  if (cat > CATEGORY.PAIR) {
    const base = describe(score);
    if (cat === CATEGORY.TWO_PAIR && !pocketPair && holeRanks.every((r) => boardRanks.includes(r))) {
      return holeRanks.includes(boardRanks[0]) ? `two pair, top and ${base.split(' and ')[1]}` : base;
    }
    if (cat === CATEGORY.TRIPS) {
      const boardCount = (r) => board.filter((c) => rankOf(c) === r).length;
      if (pocketPair && boardCount(holeRanks[0]) === 1) return 'a set';
      if (holeRanks.some((r) => boardCount(r) === 2)) return 'trips';
      return `${base} on the board`;
    }
    return base;
  }

  if (cat === CATEGORY.PAIR) {
    if (pocketPair && !boardRanks.includes(holeRanks[0])) {
      return holeRanks[0] > boardRanks[0] ? 'an overpair' : `an underpair (${RANKS[holeRanks[0]]}s below the ${RANKS[boardRanks[0]]})`;
    }
    const paired = holeRanks.find((r) => boardRanks.includes(r));
    if (paired === undefined) return 'a pair on the board';
    const idx = boardRanks.indexOf(paired);
    const name = PAIR_NAMES[Math.min(idx, PAIR_NAMES.length - 1)] ?? 'a pair';
    const kickerRank = holeRanks.find((r) => r !== paired);
    if (kickerRank === undefined) return name;
    const kicker = kickerRank >= 11 ? 'top kicker' : kickerRank >= 9 ? 'good kicker' : kickerRank >= 6 ? 'medium kicker' : 'weak kicker';
    return `${name}, ${kicker}`;
  }

  const high = Math.max(...holeRanks);
  return high > (boardRanks[0] ?? -1) ? `${RANKS[high]} high, no pair` : 'no pair';
}

/**
 * A single comparable number for how good a holding is on this board,
 * counting both made strength and the draws it is carrying. Used to rank
 * combos inside a range when working out which ones an opponent continues with.
 */
export function strengthOnBoard(hole, board) {
  const cards = [...hole, ...board];
  let value = evaluate(cards, cards.length);
  const draws = drawsFor(hole, board);
  let bonus = 0;
  if (draws.flushDraw) bonus += DRAW_VALUE.flushDraw;
  else if (draws.backdoorFlush) bonus += DRAW_VALUE.backdoorFlush;
  if (draws.openEnded) bonus += DRAW_VALUE.openEnded;
  else if (draws.gutshot) bonus += DRAW_VALUE.gutshot;
  if (categoryOf(value) === CATEGORY.HIGH_CARD) bonus += (draws.overcards / 2) * DRAW_VALUE.overcards;
  return value + bonus * CAT_UNIT;
}

/** Everything about a holding on a board, for display. */
export function readHand(hole, board) {
  const draws = drawsFor(hole, board);
  const parts = [];
  if (draws.flushDraw) parts.push('flush draw');
  if (draws.openEnded) parts.push('open-ended straight draw');
  else if (draws.gutshot) parts.push('gutshot');
  if (!draws.flushDraw && draws.backdoorFlush) parts.push('backdoor flush');
  return {
    made: labelMadeHand(hole, board),
    draws,
    drawText: parts.join(' + '),
    strength: strengthOnBoard(hole, board),
    score: evaluate([...hole, ...board], hole.length + board.length),
  };
}
