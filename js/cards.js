// Card primitives. A card is an integer 0..51: rank = c >> 2 (0='2' .. 12='A'), suit = c & 3.

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
export const SUITS = ['s', 'h', 'd', 'c'];
export const SUIT_SYMBOLS = ['♠', '♥', '♦', '♣'];
export const SUIT_NAMES = ['spades', 'hearts', 'diamonds', 'clubs'];

export const rankOf = (card) => card >> 2;
export const suitOf = (card) => card & 3;
export const makeCard = (rank, suit) => (rank << 2) | suit;

export const rankIndex = (ch) => RANKS.indexOf(ch.toUpperCase());
export const suitIndex = (ch) => SUITS.indexOf(ch.toLowerCase());

/** "As" -> 51. Returns -1 when the text is not a card. */
export function parseCard(text) {
  if (typeof text !== 'string' || text.length !== 2) return -1;
  const r = rankIndex(text[0]);
  const s = suitIndex(text[1]);
  if (r < 0 || s < 0) return -1;
  return makeCard(r, s);
}

/** "AsKd" or "As Kd" -> [51, 46]. Throws on anything unparseable. */
export function parseCards(text) {
  const tokens = String(text || '').match(/[2-9TJQKAtjqka][shdcSHDC]/g) || [];
  const cards = tokens.map(parseCard);
  if (cards.some((c) => c < 0)) throw new Error(`Cannot read cards from "${text}"`);
  const seen = new Set(cards);
  if (seen.size !== cards.length) throw new Error(`Duplicate card in "${text}"`);
  return cards;
}

export const cardName = (card) => RANKS[rankOf(card)] + SUITS[suitOf(card)];
export const cardLabel = (card) => RANKS[rankOf(card)] + SUIT_SYMBOLS[suitOf(card)];
export const cardsName = (cards) => cards.map(cardName).join(' ');

export const FULL_DECK = Array.from({ length: 52 }, (_, i) => i);

/** Every card not present in `used` (an array or Set of card ints). */
export function deckWithout(used) {
  const blocked = used instanceof Set ? used : new Set(used);
  const deck = [];
  for (let c = 0; c < 52; c++) if (!blocked.has(c)) deck.push(c);
  return deck;
}

/** In-place Fisher-Yates over the first `count` slots. */
export function partialShuffle(deck, count, rng = Math.random) {
  const n = deck.length;
  for (let i = 0; i < count && i < n - 1; i++) {
    const j = i + Math.floor(rng() * (n - i));
    const tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
  }
  return deck;
}

/**
 * Canonical 169-hand code for two cards: "AA", "AKs", "AKo".
 */
export function handCode(a, b) {
  const ra = rankOf(a);
  const rb = rankOf(b);
  const hi = Math.max(ra, rb);
  const lo = Math.min(ra, rb);
  if (ra === rb) return RANKS[hi] + RANKS[lo];
  return RANKS[hi] + RANKS[lo] + (suitOf(a) === suitOf(b) ? 's' : 'o');
}

/** All 169 hand codes, ordered high to low by top card then kicker. */
export function allHandCodes() {
  const codes = [];
  for (let hi = 12; hi >= 0; hi--) {
    for (let lo = hi; lo >= 0; lo--) {
      if (hi === lo) codes.push(RANKS[hi] + RANKS[lo]);
      else codes.push(RANKS[hi] + RANKS[lo] + 's', RANKS[hi] + RANKS[lo] + 'o');
    }
  }
  return codes;
}

/** Expand a hand code into its concrete two-card combos. */
export function combosOf(code) {
  const hi = rankIndex(code[0]);
  const lo = rankIndex(code[1]);
  const kind = code[2];
  const out = [];
  if (hi === lo) {
    for (let s1 = 0; s1 < 4; s1++) {
      for (let s2 = s1 + 1; s2 < 4; s2++) out.push([makeCard(hi, s1), makeCard(lo, s2)]);
    }
  } else if (kind === 's') {
    for (let s = 0; s < 4; s++) out.push([makeCard(hi, s), makeCard(lo, s)]);
  } else {
    for (let s1 = 0; s1 < 4; s1++) {
      for (let s2 = 0; s2 < 4; s2++) if (s1 !== s2) out.push([makeCard(hi, s1), makeCard(lo, s2)]);
    }
  }
  return out;
}

export const comboCount = (code) => (code.length === 2 ? 6 : code[2] === 's' ? 4 : 12);
