// Hold'em range notation: text in, weighted combos out.
//
// Understands: AA · AKs · AKo · AK (both) · 77+ · ATs+ · KJo+ · 77-44 ·
// AJs-A8s · T9s-65s · AKo:0.5 (weighted) · 22% or "top 22%" · any/random.

import { allHandCodes, combosOf, comboCount, rankIndex, RANKS, handCode } from './cards.js';
import { PREFLOP_ORDER, RANGE_CUTOFF } from './data/preflop.js';

const ALL_CODES = new Set(allHandCodes());
const isCode = (c) => ALL_CODES.has(c);

/** The strongest hands covering `share` (0..1) of all 1326 combos. */
export function topPercentCodes(share) {
  const target = Math.max(0, Math.min(1, share));
  if (target <= 0) return [];
  const out = [];
  for (const code of PREFLOP_ORDER) {
    out.push(code);
    if (RANGE_CUTOFF[code] >= target) break;
  }
  return out;
}

/** Where a hand sits in the ordering, as a percentile (0 = best). */
export function handPercentile(code) {
  const cutoff = RANGE_CUTOFF[code];
  return cutoff === undefined ? 1 : cutoff;
}

function normalise(token) {
  const m = token.match(/^([2-9tjqka])([2-9tjqka])([so])?$/i);
  if (!m) return null;
  let [, a, b, kind] = m;
  a = a.toUpperCase();
  b = b.toUpperCase();
  const ra = rankIndex(a);
  const rb = rankIndex(b);
  const hi = RANKS[Math.max(ra, rb)];
  const lo = RANKS[Math.min(ra, rb)];
  if (ra === rb) return kind ? null : [hi + lo];
  if (!kind) return [hi + lo + 's', hi + lo + 'o'];
  return [hi + lo + kind.toLowerCase()];
}

/** "77+" / "ATs+" — everything at least this strong along the same axis. */
function expandPlus(code) {
  const hi = rankIndex(code[0]);
  const lo = rankIndex(code[1]);
  const kind = code[2];
  const out = [];
  if (hi === lo) {
    for (let r = hi; r <= 12; r++) out.push(RANKS[r] + RANKS[r]);
  } else {
    for (let r = lo; r < hi; r++) out.push(RANKS[hi] + RANKS[r] + kind);
  }
  return out;
}

/** "77-44" / "AJs-A8s" / "T9s-65s" */
function expandDash(left, right) {
  const lHi = rankIndex(left[0]);
  const lLo = rankIndex(left[1]);
  const rHi = rankIndex(right[0]);
  const rLo = rankIndex(right[1]);
  const kind = left[2];
  if (kind !== right[2]) return null;

  if (lHi === lLo && rHi === rLo) {
    const [from, to] = lHi <= rHi ? [lHi, rHi] : [rHi, lHi];
    const out = [];
    for (let r = from; r <= to; r++) out.push(RANKS[r] + RANKS[r]);
    return out;
  }
  if (lHi === rHi) {
    // Same top card, kicker sweeps: AJs-A8s
    const [from, to] = lLo <= rLo ? [lLo, rLo] : [rLo, lLo];
    const out = [];
    for (let r = from; r <= to; r++) out.push(RANKS[lHi] + RANKS[r] + kind);
    return out;
  }
  if (lHi - lLo === rHi - rLo) {
    // Same gap, both cards slide: T9s-65s
    const [from, to] = lHi <= rHi ? [lHi, rHi] : [rHi, lHi];
    const gap = lHi - lLo;
    const out = [];
    for (let r = from; r <= to; r++) out.push(RANKS[r] + RANKS[r - gap] + kind);
    return out;
  }
  return null;
}

/**
 * Parse range text into a Map of hand code -> weight (0..1).
 * Unreadable pieces are collected in `warnings` rather than thrown.
 */
export function parseRange(text) {
  const weights = new Map();
  const warnings = [];
  const put = (code, w) => {
    if (!isCode(code)) return false;
    weights.set(code, Math.max(weights.get(code) ?? 0, w));
    return true;
  };

  const tokens = String(text || '')
    .split(/[,;\n]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  for (const raw of tokens) {
    let token = raw;
    let weight = 1;
    const weighted = token.match(/^(.*?):\s*([0-9]*\.?[0-9]+)%?$/);
    if (weighted) {
      token = weighted[1].trim();
      weight = parseFloat(weighted[2]);
      if (weight > 1) weight /= 100;
    }

    const asPercent = token.match(/^(?:top\s+)?([0-9]*\.?[0-9]+)\s*%$/i);
    if (asPercent) {
      for (const code of topPercentCodes(parseFloat(asPercent[1]) / 100)) put(code, weight);
      continue;
    }

    if (/^(any|all|random|any2|100%)$/i.test(token)) {
      for (const code of ALL_CODES) put(code, weight);
      continue;
    }

    if (token.includes('-')) {
      const [l, r] = token.split('-').map((s) => s.trim());
      const left = normalise(l);
      const right = normalise(r);
      if (left && right && left.length === right.length) {
        let ok = true;
        for (let i = 0; i < left.length; i++) {
          const span = expandDash(left[i], right[i]);
          if (!span) {
            ok = false;
            break;
          }
          for (const code of span) put(code, weight);
        }
        if (ok) continue;
      }
      warnings.push(`Could not read "${raw}"`);
      continue;
    }

    if (token.endsWith('+')) {
      const base = normalise(token.slice(0, -1).trim());
      if (base) {
        for (const code of base) for (const c of expandPlus(code)) put(c, weight);
        continue;
      }
      warnings.push(`Could not read "${raw}"`);
      continue;
    }

    const plain = normalise(token);
    if (plain) {
      for (const code of plain) put(code, weight);
      continue;
    }
    warnings.push(`Could not read "${raw}"`);
  }

  return { weights, warnings };
}

/** Total combos in a weighted range, weights included. */
export function rangeWeight(weights) {
  let total = 0;
  for (const [code, w] of weights) total += comboCount(code) * w;
  return total;
}

export const rangePercent = (weights) => rangeWeight(weights) / 1326;

/**
 * Expand to concrete combos, dropping anything blocked by known cards.
 * Returns a sampler-ready object: uniform `combos` plus a cumulative weight
 * table when the range is not flat.
 */
export function rangeToCombos(weights, dead = []) {
  const blocked = new Uint8Array(52);
  for (const c of dead) blocked[c] = 1;
  const combos = [];
  const ws = [];
  let flat = true;
  for (const [code, w] of weights) {
    if (w <= 0) continue;
    if (w !== 1) flat = false;
    for (const combo of combosOf(code)) {
      if (blocked[combo[0]] || blocked[combo[1]]) continue;
      combos.push(combo);
      ws.push(w);
    }
  }
  if (flat || combos.length === 0) return { combos, cumulative: null };
  const cumulative = new Float64Array(combos.length);
  let running = 0;
  for (let i = 0; i < ws.length; i++) {
    running += ws[i];
    cumulative[i] = running;
  }
  return { combos, cumulative };
}

/** Collapse a weight map back to compact text, e.g. "AA, KK, AKs, 99-77". */
export function rangeToText(weights) {
  const parts = [];
  const byWeight = new Map();
  for (const [code, w] of weights) {
    const key = Math.round(w * 100) / 100;
    if (!byWeight.has(key)) byWeight.set(key, []);
    byWeight.get(key).push(code);
  }
  for (const [w, codes] of [...byWeight].sort((a, b) => b[0] - a[0])) {
    codes.sort((a, b) => PREFLOP_ORDER.indexOf(a) - PREFLOP_ORDER.indexOf(b));
    const suffix = w === 1 ? '' : `:${w}`;
    parts.push(codes.map((c) => c + suffix).join(', '));
  }
  return parts.join(', ');
}

/** Weight this exact holding carries in a range (0 when it is not in there). */
export function weightOfHand(weights, cards) {
  return weights.get(handCode(cards[0], cards[1])) ?? 0;
}
