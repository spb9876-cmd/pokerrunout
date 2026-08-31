// Seven-card hand evaluator. Returns a comparable integer: bigger is better.
// Score layout (base 13): category * 13^5 + k1*13^4 + k2*13^3 + k3*13^2 + k4*13 + k5

export const CATEGORY = {
  HIGH_CARD: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  TRIPS: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  QUADS: 7,
  STRAIGHT_FLUSH: 8,
};

export const CATEGORY_NAMES = [
  'high card',
  'pair',
  'two pair',
  'three of a kind',
  'straight',
  'flush',
  'full house',
  'four of a kind',
  'straight flush',
];

const B = 13;
const CAT_UNIT = B * B * B * B * B;

const score = (cat, k1 = 0, k2 = 0, k3 = 0, k4 = 0, k5 = 0) =>
  cat * CAT_UNIT + k1 * B * B * B * B + k2 * B * B * B + k3 * B * B + k4 * B + k5;

export const categoryOf = (s) => Math.floor(s / CAT_UNIT);

// Scratch buffers, reused so the hot loop never allocates.
const rankCounts = new Int32Array(13);
const suitCounts = new Int32Array(4);
const suitMasks = new Int32Array(4);

/**
 * Highest straight contained in a 13-bit rank mask.
 * Returns the straight's high rank (0..12) or -1. Handles the wheel.
 */
export function straightHigh(rankMask) {
  // Shift into a 14-bit space where bit 0 is the ace playing low.
  const m = ((rankMask << 1) | ((rankMask >> 12) & 1)) & 0x3fff;
  for (let h = 13; h >= 4; h--) {
    if (((m >> (h - 4)) & 0b11111) === 0b11111) return h - 1;
  }
  return -1;
}

function topRanks(mask, howMany, out) {
  let found = 0;
  for (let r = 12; r >= 0 && found < howMany; r--) {
    if ((mask >> r) & 1) out[found++] = r;
  }
  while (found < howMany) out[found++] = 0;
  return out;
}

const kickerBuf = new Int32Array(5);

/** Evaluate 5, 6 or 7 cards. `cards` may be any array-like of card ints. */
export function evaluate(cards, n = cards.length) {
  rankCounts.fill(0);
  suitCounts.fill(0);
  suitMasks.fill(0);
  let rankMask = 0;

  for (let i = 0; i < n; i++) {
    const c = cards[i];
    const r = c >> 2;
    const s = c & 3;
    rankCounts[r]++;
    suitCounts[s]++;
    suitMasks[s] |= 1 << r;
    rankMask |= 1 << r;
  }

  let flushSuit = -1;
  for (let s = 0; s < 4; s++) if (suitCounts[s] >= 5) flushSuit = s;

  if (flushSuit >= 0) {
    const sfHigh = straightHigh(suitMasks[flushSuit]);
    if (sfHigh >= 0) return score(CATEGORY.STRAIGHT_FLUSH, sfHigh);
  }

  // Rank multiplicities, high to low.
  let quad = -1;
  let trips1 = -1;
  let trips2 = -1;
  let pair1 = -1;
  let pair2 = -1;
  for (let r = 12; r >= 0; r--) {
    const c = rankCounts[r];
    if (c === 4) {
      if (quad < 0) quad = r;
    } else if (c === 3) {
      if (trips1 < 0) trips1 = r;
      else if (trips2 < 0) trips2 = r;
    } else if (c === 2) {
      if (pair1 < 0) pair1 = r;
      else if (pair2 < 0) pair2 = r;
    }
  }

  if (quad >= 0) {
    const kicker = topRanks(rankMask & ~(1 << quad), 1, kickerBuf)[0];
    return score(CATEGORY.QUADS, quad, kicker);
  }

  if (trips1 >= 0 && (trips2 >= 0 || pair1 >= 0)) {
    const pair = trips2 >= 0 ? Math.max(trips2, pair1) : pair1;
    return score(CATEGORY.FULL_HOUSE, trips1, pair);
  }

  if (flushSuit >= 0) {
    const k = topRanks(suitMasks[flushSuit], 5, kickerBuf);
    return score(CATEGORY.FLUSH, k[0], k[1], k[2], k[3], k[4]);
  }

  const sHigh = straightHigh(rankMask);
  if (sHigh >= 0) return score(CATEGORY.STRAIGHT, sHigh);

  if (trips1 >= 0) {
    const k = topRanks(rankMask & ~(1 << trips1), 2, kickerBuf);
    return score(CATEGORY.TRIPS, trips1, k[0], k[1]);
  }

  if (pair2 >= 0) {
    const kicker = topRanks(rankMask & ~(1 << pair1) & ~(1 << pair2), 1, kickerBuf)[0];
    return score(CATEGORY.TWO_PAIR, pair1, pair2, kicker);
  }

  if (pair1 >= 0) {
    const k = topRanks(rankMask & ~(1 << pair1), 3, kickerBuf);
    return score(CATEGORY.PAIR, pair1, k[0], k[1], k[2]);
  }

  const k = topRanks(rankMask, 5, kickerBuf);
  return score(CATEGORY.HIGH_CARD, k[0], k[1], k[2], k[3], k[4]);
}

const RANK_WORDS = ['deuce', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'jack', 'queen', 'king', 'ace'];
const plural = (r) => (r === 4 ? 'sixes' : RANK_WORDS[r] + 's');

/** Human-readable name for a score, e.g. "two pair, aces and fives". */
export function describe(s) {
  const cat = categoryOf(s);
  const digits = [];
  let rest = s - cat * CAT_UNIT;
  for (let p = 4; p >= 0; p--) {
    const unit = B ** p;
    digits.push(Math.floor(rest / unit));
    rest %= unit;
  }
  const [k1, k2] = digits;
  switch (cat) {
    case CATEGORY.STRAIGHT_FLUSH:
      return k1 === 12 ? 'royal flush' : `straight flush, ${RANK_WORDS[k1]} high`;
    case CATEGORY.QUADS:
      return `four ${plural(k1)}`;
    case CATEGORY.FULL_HOUSE:
      return `${plural(k1)} full of ${plural(k2)}`;
    case CATEGORY.FLUSH:
      return `flush, ${RANK_WORDS[k1]} high`;
    case CATEGORY.STRAIGHT:
      return `straight, ${RANK_WORDS[k1]} high`;
    case CATEGORY.TRIPS:
      return `three ${plural(k1)}`;
    case CATEGORY.TWO_PAIR:
      return `two pair, ${plural(k1)} and ${plural(k2)}`;
    case CATEGORY.PAIR:
      return `pair of ${plural(k1)}`;
    default:
      return `${RANK_WORDS[k1]} high`;
  }
}
