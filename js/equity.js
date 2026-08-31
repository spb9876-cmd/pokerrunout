// Monte Carlo equity for No-Limit Hold'em: one known hero hand against
// one or more villains whose holdings are only known as a range.

import { evaluate } from './evaluator.js';
import { mulberry32 } from './rng.js';

const MAX_PLAYERS = 10;

/** Index of a combo drawn from a range, honouring weights when present. */
function pick(combos, cumulative, rng) {
  if (!cumulative) return (rng() * combos.length) | 0;
  const target = rng() * cumulative[cumulative.length - 1];
  let lo = 0;
  let hi = cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}


/**
 * @param {object} spec
 * @param {number[]} spec.hero      two card ints
 * @param {number[]} spec.board     0, 3, 4 or 5 card ints
 * @param {object[]} spec.villains  each { combos: [[c,c], ...] } — the combos it can hold
 * @param {number} [spec.trials]
 * @param {number} [spec.seed]
 * @returns {{equity:number, win:number, tie:number, lose:number, trials:number,
 *            stdError:number, villains:{equity:number}[], skipped:number}}
 */
export function equityVsRanges({ hero, board, villains, trials = 20000, seed = 1 }) {
  if (!hero || hero.length !== 2) throw new Error('Hero needs exactly two cards');
  if (board.length > 5) throw new Error('A board holds at most five cards');
  if (villains.length === 0) throw new Error('Add at least one opponent');
  if (villains.length + 1 > MAX_PLAYERS) throw new Error('Too many players');
  for (const v of villains) {
    if (!v.combos || v.combos.length === 0) throw new Error('An opponent range is empty');
  }

  const rng = mulberry32(seed);
  const used = new Uint8Array(52);
  const baseUsed = new Uint8Array(52);
  for (const c of hero) baseUsed[c] = 1;
  for (const c of board) baseUsed[c] = 1;
  if (hero.some((c) => board.includes(c))) throw new Error('A card is in two places at once');

  const nv = villains.length;
  const hands = new Int32Array(nv * 2);
  const seven = new Int32Array(7);
  const boardCards = new Int32Array(5);
  for (let i = 0; i < board.length; i++) boardCards[i] = board[i];
  const toDeal = 5 - board.length;

  let heroPoints = 0;
  let wins = 0;
  let ties = 0;
  let losses = 0;
  let skipped = 0;
  let played = 0;
  const villainPoints = new Float64Array(nv);
  let sumSq = 0;

  outer: for (let t = 0; t < trials; t++) {
    used.set(baseUsed);

    // Deal every villain a combo from their own range, retrying on card clashes.
    for (let v = 0; v < nv; v++) {
      const { combos, cumulative } = villains[v];
      let placed = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const combo = combos[pick(combos, cumulative, rng)];
        if (used[combo[0]] || used[combo[1]]) continue;
        used[combo[0]] = 1;
        used[combo[1]] = 1;
        hands[v * 2] = combo[0];
        hands[v * 2 + 1] = combo[1];
        placed = true;
        break;
      }
      if (!placed) {
        skipped++;
        continue outer;
      }
    }

    // Run out the rest of the board.
    for (let i = 0; i < toDeal; i++) {
      let c;
      do {
        c = (rng() * 52) | 0;
      } while (used[c]);
      used[c] = 1;
      boardCards[board.length + i] = c;
    }

    seven[0] = hero[0];
    seven[1] = hero[1];
    for (let i = 0; i < 5; i++) seven[2 + i] = boardCards[i];
    const heroScore = evaluate(seven, 7);

    let best = heroScore;
    let winners = 1;
    let heroInTie = true;
    for (let v = 0; v < nv; v++) {
      seven[0] = hands[v * 2];
      seven[1] = hands[v * 2 + 1];
      const s = evaluate(seven, 7);
      if (s > best) {
        best = s;
        winners = 1;
        heroInTie = false;
      } else if (s === best) {
        winners++;
      }
    }

    played++;
    const share = heroInTie && heroScore === best ? 1 / winners : 0;
    heroPoints += share;
    sumSq += share * share;
    if (share === 1) wins++;
    else if (share > 0) ties++;
    else losses++;

    // Villain shares, for the "who is this board good for" readout.
    for (let v = 0; v < nv; v++) {
      seven[0] = hands[v * 2];
      seven[1] = hands[v * 2 + 1];
      if (evaluate(seven, 7) === best) villainPoints[v] += 1 / winners;
    }
  }

  const n = Math.max(played, 1);
  const equity = heroPoints / n;
  const variance = Math.max(sumSq / n - equity * equity, 0);
  return {
    equity,
    win: wins / n,
    tie: ties / n,
    lose: losses / n,
    trials: played,
    skipped,
    stdError: Math.sqrt(variance / n),
    villains: Array.from(villainPoints, (p) => ({ equity: p / n })),
  };
}

/** Equity recomputed at each street the hand still has to come. */
export function equityByStreet(spec) {
  const streets = [];
  const names = ['preflop', 'flop', 'turn', 'river'];
  const sizes = [0, 3, 4, 5];
  for (let i = 0; i < sizes.length; i++) {
    if (spec.board.length < sizes[i]) break;
    const board = spec.board.slice(0, sizes[i]);
    streets.push({
      street: names[i],
      board,
      ...equityVsRanges({ ...spec, board, trials: spec.trials ?? 8000 }),
    });
  }
  return streets;
}

/**
 * Exact equity by enumerating every remaining board. Only valid when every
 * opponent's holding is known exactly (one combo each) — used to check the
 * Monte Carlo sampler and to settle spots where all cards are on their backs.
 */
export function exactEquity({ hero, board, villains }) {
  const hands = villains.map((v) => {
    if (!v.combos || v.combos.length !== 1) throw new Error('exactEquity needs one known combo per opponent');
    return v.combos[0];
  });
  const used = new Uint8Array(52);
  for (const c of [...hero, ...board, ...hands.flat()]) {
    if (used[c]) throw new Error('A card is in two places at once');
    used[c] = 1;
  }
  const deck = [];
  for (let c = 0; c < 52; c++) if (!used[c]) deck.push(c);

  const toDeal = 5 - board.length;
  const full = new Int32Array(5);
  for (let i = 0; i < board.length; i++) full[i] = board[i];
  const seven = new Int32Array(7);
  const points = new Float64Array(hands.length + 1);
  let boards = 0;

  const settle = () => {
    boards++;
    let best = -1;
    let winners = 0;
    const scores = new Array(hands.length + 1);
    for (let p = 0; p <= hands.length; p++) {
      const hole = p === 0 ? hero : hands[p - 1];
      seven[0] = hole[0];
      seven[1] = hole[1];
      for (let i = 0; i < 5; i++) seven[2 + i] = full[i];
      const s = evaluate(seven, 7);
      scores[p] = s;
      if (s > best) {
        best = s;
        winners = 1;
      } else if (s === best) winners++;
    }
    for (let p = 0; p <= hands.length; p++) if (scores[p] === best) points[p] += 1 / winners;
  };

  const recurse = (start, depth) => {
    if (depth === toDeal) return settle();
    for (let i = start; i <= deck.length - (toDeal - depth); i++) {
      full[board.length + depth] = deck[i];
      recurse(i + 1, depth + 1);
    }
  };
  recurse(0, 0);

  return {
    equity: points[0] / boards,
    boards,
    villains: Array.from(hands, (_, i) => ({ equity: points[i + 1] / boards })),
  };
}
