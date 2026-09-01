// The runout engine.
//
// Takes a spot — the setting, the stacks, who is in the pot and what kind of
// player each one is — and works out what the hand is worth and what to do
// with it. Everything here is a model, and the model is stated out loud in the
// reasons it hands back, so you can disagree with it on purpose.

import { combosOf, comboCount } from './cards.js';
import { equityVsRanges, exactEquity } from './equity.js';
import { topPercentCodes, parseRange, rangeToCombos } from './ranges.js';
import { RANGE_CUTOFF, PREFLOP_ORDER } from './data/preflop.js';
import { strengthOnBoard, readHand } from './handstrength.js';
import { archetypeById, settingById, stageById, positionById, hasPositionOn, applyMood } from './players.js';

export const STREETS = ['preflop', 'flop', 'turn', 'river'];
export const streetOf = (board) => STREETS[[0, 0, 0, 1, 2, 3][board.length]] ?? 'preflop';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/** Hand codes whose share of all combos falls between `from` and `to`. */
export function bandCodes(from, to) {
  return PREFLOP_ORDER.filter((code) => RANGE_CUTOFF[code] > from && RANGE_CUTOFF[code] <= to);
}

/**
 * What an opponent's preflop range looks like, given who they are, where they
 * sit, what they did, and where the game is being played.
 */
export function preflopRange(villain, setting) {
  const arch = archetypeById(villain.type);
  const group = positionById(villain.position).group;
  const loosen = setting.loosen;
  const weights = new Map();
  const add = (codes, w = 1) => {
    for (const code of codes) weights.set(code, Math.max(weights.get(code) ?? 0, w));
  };

  const widen = (base, factor = 1) => clamp(base * (1 + loosen * 2 * factor), 0.01, 1);

  switch (villain.role) {
    case 'raised': {
      add(topPercentCodes(widen(arch.openBy[group])));
      break;
    }
    case '3bet': {
      // Value-heavy, with a bluff tail that only aggressive players actually have.
      add(topPercentCodes(arch.threeBet));
      const bluffTail = arch.raiseBluff * 0.5;
      if (bluffTail > 0.02) add(bandCodes(arch.threeBet + 0.1, arch.threeBet + 0.1 + bluffTail), 0.5);
      break;
    }
    case 'called': {
      // Capped: the top of their range would have raised instead of calling.
      const cap = arch.threeBet * 0.7;
      add(bandCodes(cap, widen(arch.callVsOpen)));
      if (arch.calldown > 0.7) add(topPercentCodes(cap), 0.35); // passive players flat their monsters too
      break;
    }
    case 'limped': {
      const cap = arch.openBy[group] * 0.55;
      add(bandCodes(cap, widen(arch.limp || 0.2)));
      if (arch.calldown > 0.7) add(topPercentCodes(cap), 0.3);
      break;
    }
    case 'blind':
    default: {
      // Defended their blind: wide, weighted towards playable hands.
      const width = clamp((arch.callVsOpen + 0.18) * (1 + loosen), 0.05, 0.75);
      add(bandCodes(arch.threeBet * 0.6, width));
      add(topPercentCodes(arch.threeBet * 0.6), 0.4);
      break;
    }
  }

  if (weights.size === 0) add(topPercentCodes(0.2));
  return weights;
}

/**
 * How often this player folds to a bet of `betRatio` times the pot.
 * Derived from their fold tendency, stretched by size and by the street, and
 * damped by how much the setting lets bluffs through.
 */
export function foldFrequency(arch, setting, betRatio, street) {
  const sizePressure = 0.75 + 0.5 * clamp(betRatio, 0.15, 2);
  const streetPressure = street === 'river' ? 1.08 : street === 'turn' ? 1.04 : 1;
  const stickiness = 1 - (arch.calldown - 0.5) * 0.35;
  const raw = arch.foldToBet * sizePressure * streetPressure * stickiness * setting.foldEquity;
  return clamp(raw, 0.02, 0.93);
}

/**
 * Narrow a preflop range down to the combos this player still has after the
 * action on this board. Returns a sampler-ready range plus a breakdown of what
 * the remaining range is made of.
 */
export function continuingRange(weights, board, villain, setting, opts = {}) {
  const arch = archetypeById(villain.type);
  const street = streetOf(board);
  const dead = opts.dead ?? [];
  const betRatio = opts.betRatio ?? 0.6;

  const blocked = new Uint8Array(52);
  for (const c of dead) blocked[c] = 1;

  const entries = [];
  for (const [code, w] of weights) {
    if (w <= 0) continue;
    for (const combo of combosOf(code)) {
      if (blocked[combo[0]] || blocked[combo[1]]) continue;
      entries.push({ combo, weight: w, code, strength: board.length ? strengthOnBoard(combo, board) : RANGE_CUTOFF[code] * -1 });
    }
  }
  if (entries.length === 0) return { combos: [], cumulative: null, summary: null };
  entries.sort((a, b) => b.strength - a.strength);
  const total = entries.reduce((s, e) => s + e.weight, 0);

  let keepTop = 1;
  let keepBottom = 0;
  let topDiscount = 1;
  let label = 'their whole range';

  switch (villain.action) {
    case 'called': {
      keepTop = 1 - foldFrequency(arch, setting, betRatio, street);
      label = `the ${Math.round(keepTop * 100)}% of their range that calls this size`;
      break;
    }
    case 'bet':
    case 'raised': {
      // Betting ranges narrow as the hand goes on: everyone fires the flop wide
      // and the river only with something they mean.
      const streetTighten = street === 'river' ? 0.5 : street === 'turn' ? 0.72 : 1;
      const aggression = villain.action === 'raised' ? arch.raiseBluff : arch.bluffShare;
      const width = clamp((villain.action === 'raised' ? arch.cbet * 0.45 : arch.cbet) * streetTighten, 0.05, 0.9);
      keepTop = width * (1 - aggression);
      keepBottom = width * aggression;
      label = `a ${street} betting range that is about ${Math.round((1 - aggression) * 100)}% value and ${Math.round(aggression * 100)}% bluff`;
      break;
    }
    case 'checked': {
      // A check only caps a range when that player was the one expected to bet.
      // The blind checking to the preflop raiser is checking their whole range
      // and telling you nothing.
      const hasInitiative = villain.role === 'raised' || villain.role === '3bet';
      if (hasInitiative) {
        topDiscount = 1 - arch.cbet * 0.75;
        label = 'a checked range, capped by the hands they would have bet with the lead';
      } else {
        label = 'their whole range — checking to the raiser tells you nothing';
      }
      break;
    }
    default:
      break;
  }

  const out = [];
  const topBudget = keepTop * total;
  const bottomBudget = keepBottom * total;
  const wouldHaveBet = arch.cbet * total; // the slice a check makes less likely
  let used = 0;
  let valueWeight = 0;
  for (const e of entries) {
    if (used >= topBudget) break;
    const take = Math.min(e.weight, topBudget - used);
    const w = take * (used < wouldHaveBet ? topDiscount : 1);
    used += take;
    if (w > 0) out.push({ combo: e.combo, weight: w, code: e.code });
    valueWeight += w;
  }
  let bluffWeight = 0;
  if (bottomBudget > 0) {
    let usedBottom = 0;
    for (let i = entries.length - 1; i >= 0 && usedBottom < bottomBudget; i--) {
      const e = entries[i];
      if (out.some((o) => o.combo === e.combo)) continue;
      const take = Math.min(e.weight, bottomBudget - usedBottom);
      usedBottom += take;
      out.push({ combo: e.combo, weight: take, code: e.code });
      bluffWeight += take;
    }
  }

  if (out.length === 0) out.push({ combo: entries[0].combo, weight: entries[0].weight, code: entries[0].code });

  const combos = out.map((o) => o.combo);
  let flat = out.every((o) => Math.abs(o.weight - out[0].weight) < 1e-9);
  let cumulative = null;
  if (!flat) {
    cumulative = new Float64Array(out.length);
    let running = 0;
    for (let i = 0; i < out.length; i++) {
      running += out[i].weight;
      cumulative[i] = running;
    }
  }

  const topCodes = [];
  const seen = new Set();
  for (const o of out) {
    if (seen.has(o.code)) continue;
    seen.add(o.code);
    topCodes.push(o.code);
    if (topCodes.length >= 8) break;
  }

  return {
    combos,
    cumulative,
    summary: {
      label,
      combosLeft: combos.length,
      startingCombos: entries.length,
      share: out.reduce((s, o) => s + o.weight, 0) / total,
      valueShare: valueWeight + bluffWeight > 0 ? valueWeight / (valueWeight + bluffWeight) : 1,
      bluffShare: valueWeight + bluffWeight > 0 ? bluffWeight / (valueWeight + bluffWeight) : 0,
      topCodes,
      foldsToThisSize: 1 - keepTop,
    },
  };
}

/** Build every opponent's range for the spot as it stands. */
export function buildRanges(spot) {
  const setting = applyMood(settingById(spot.setting), spot.mood);
  const dead = [...spot.hero.cards, ...spot.board];
  return spot.villains
    .filter((v) => v.role !== 'folded')
    .map((villain) => {
      const preflop = villain.customRange?.trim()
        ? parseRange(villain.customRange).weights
        : preflopRange(villain, setting);
      const narrowed = spot.board.length
        ? continuingRange(preflop, spot.board, villain, setting, { dead, betRatio: spot.betRatio })
        : { ...rangeToCombos(preflop, dead), summary: { label: 'their preflop range', combosLeft: 0, share: 1, valueShare: 1, bluffShare: 0, topCodes: [...preflop.keys()].slice(0, 8), foldsToThisSize: 0 } };
      const preflopCombos = [...preflop.entries()].reduce((s, [code, w]) => s + comboCount(code) * w, 0);
      return {
        villain,
        preflop,
        preflopPercent: preflopCombos / 1326,
        ...narrowed,
      };
    });
}

/** Pot odds and the equity a call has to beat. */
export function callMath(spot, equity) {
  const { pot, toCall } = spot;
  const setting = applyMood(settingById(spot.setting), spot.mood);
  const stage = stageById(spot.stage);
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
  const riskPremium = setting.format === 'tournament' ? Math.max(setting.riskPremium, stage.riskPremium) : 0;
  // Survival is only worth paying for when the call is for a meaningful slice
  // of the stack — a small call is not a tournament-life decision.
  const stackShare = clamp(toCall / Math.max(spot.hero.stack, 1), 0, 1);
  const premium = riskPremium * stackShare;
  return {
    potOdds,
    riskPremium: premium,
    requiredEquity: clamp(potOdds + premium, 0, 1),
    evCall: equity * (pot + toCall) - (1 - equity) * toCall,
    evFold: 0,
  };
}

/** Bluff arithmetic: how often a bet of this size has to work. */
export function bluffMath(pot, bet) {
  return { breakEvenFoldFrequency: bet / (pot + bet) };
}

const potFractionLabel = (f) =>
  f >= 1.4 ? 'overbet' : f >= 0.9 ? 'pot-sized' : f >= 0.66 ? 'three-quarter pot' : f >= 0.45 ? 'half pot' : f >= 0.28 ? 'a third of the pot' : 'a small stab';

/**
 * The whole analysis. Returns the numbers, the recommendation and the reasons.
 */
export function analyse(spot, options = {}) {
  const setting = applyMood(settingById(spot.setting), spot.mood);
  const stage = stageById(spot.stage);
  const street = streetOf(spot.board);
  const ranges = buildRanges(spot);
  if (ranges.length === 0) throw new Error('Nobody is left in the pot — add an opponent.');
  if (ranges.some((r) => r.combos.length === 0)) throw new Error('An opponent has no hands left in their range. Widen it or check the cards.');

  const allKnown = ranges.every((r) => r.combos.length === 1);
  const spec = { hero: spot.hero.cards, board: spot.board, villains: ranges, trials: options.trials ?? 20000, seed: options.seed ?? 1 };
  const equityResult = allKnown && spot.board.length >= 3 ? { ...exactEquity(spec), exact: true, win: 0, tie: 0, stdError: 0, trials: 0 } : { ...equityVsRanges(spec), exact: false };

  const equity = equityResult.equity;
  const hand = readHand(spot.hero.cards, spot.board);
  const math = callMath(spot, equity);
  const reasons = [];
  const exploits = [];

  const bb = spot.bigBlind || 1;
  const inBB = (n) => `${Math.round((n / bb) * 10) / 10}bb`;
  const money = (n) =>
    setting.format === 'tournament'
      ? `${Math.round(n).toLocaleString()} chips`
      : `${spot.currency ?? '$'}${Math.round(n * 100) / 100}`;
  const amount = (n) => (setting.format === 'tournament' ? `${inBB(n)} (${Math.round(n).toLocaleString()} chips)` : `${money(n)} (${inBB(n)})`);

  // How often the field folds to a bet of a given size, from the same model
  // that built their ranges.
  const foldOdds = (ratio) => {
    let through = 1;
    for (const r of ranges) {
      const arch = archetypeById(r.villain.type);
      through *= foldFrequency(arch, setting, ratio, street);
    }
    return through;
  };

  const potAfterCall = spot.pot + spot.toCall;
  const effectiveStack = Math.min(spot.hero.stack, ...ranges.map((r) => r.villain.stack || Infinity));
  const spr = effectiveStack / Math.max(spot.pot, bb);

  let decision;

  if (spot.toCall > 0) {
    // ---- Facing a bet ----
    const edge = equity - math.requiredEquity;
    const raiseSize = clamp(spot.toCall * 3, spot.toCall * 2.2, effectiveStack);
    const raiseRatio = raiseSize / (spot.pot + spot.toCall);
    const fe = foldOdds(raiseRatio);
    const raiseBreakEven = bluffMath(spot.pot + spot.toCall, raiseSize).breakEvenFoldFrequency;

    if (equity > 0.62 && ranges.some((r) => archetypeById(r.villain.type).calldown > 0.6)) {
      decision = { action: 'raise', size: raiseSize, headline: `Raise to ${amount(raiseSize)}` };
      reasons.push(`You are ahead of the range that bet into you (${(equity * 100).toFixed(1)}% equity), and at least one player here calls raises far too wide. Raise for value.`);
    } else if (edge >= 0) {
      decision = { action: 'call', size: spot.toCall, headline: `Call ${amount(spot.toCall)}` };
      reasons.push(`You need ${(math.requiredEquity * 100).toFixed(1)}% to call and you have ${(equity * 100).toFixed(1)}% — the call shows a profit of ${money(math.evCall)} on average.`);
    } else if (fe > raiseBreakEven * 1.15 && equity > 0.25) {
      decision = { action: 'raise', size: raiseSize, headline: `Raise to ${amount(raiseSize)} as a semi-bluff` };
      reasons.push(`Calling is short of the price, but a raise to ${amount(raiseSize)} only needs to work ${(raiseBreakEven * 100).toFixed(0)}% of the time and this field folds about ${(fe * 100).toFixed(0)}% of the time to it — plus you still have ${(equity * 100).toFixed(1)}% when called.`);
    } else {
      decision = { action: 'fold', size: 0, headline: 'Fold' };
      const evText =
        math.evCall > 0
          ? `The call is worth ${money(math.evCall)} in raw chips, but chips are not what you are playing for here — see below.`
          : `Calling loses ${money(-math.evCall)} on average.`;
      reasons.push(`You need ${(math.requiredEquity * 100).toFixed(1)}% to continue and you have ${(equity * 100).toFixed(1)}%. ${evText}`);
    }

    if (math.riskPremium > 0.005) {
      reasons.push(`${stage.name}: chips you lose are worth more than chips you win, so this call needs an extra ${(math.riskPremium * 100).toFixed(1)}% on top of the raw pot odds.`);
    }

    // Implied odds are the honest counterweight to a thin fold with a draw.
    if (decision.action === 'fold' && (hand.draws.flushDraw || hand.draws.openEnded) && street !== 'river') {
      const shortfall = (math.requiredEquity - equity) * potAfterCall;
      const stickiest = Math.max(...ranges.map((r) => archetypeById(r.villain.type).calldown));
      const payable = (effectiveStack - spot.toCall) * stickiest * 0.35;
      if (payable > shortfall) {
        decision = { action: 'call', size: spot.toCall, headline: `Call ${amount(spot.toCall)} on implied odds` };
        reasons.push(`The direct price is short by ${money(shortfall)}, but you have ${money(effectiveStack - spot.toCall)} behind against players who pay off when you get there. That is enough to make the draw worth continuing.`);
      } else {
        reasons.push(`Implied odds do not rescue it: you would need roughly ${money(shortfall / 0.35)} more from later streets and there is only ${money(effectiveStack - spot.toCall)} behind.`);
      }
    }
  } else {
    // ---- Checked to, or first to act ----
    const valueRatio = ranges.some((r) => archetypeById(r.villain.type).calldown > 0.75) ? 0.8 : 0.62;
    const valueSize = clamp(spot.pot * valueRatio, bb, effectiveStack);
    const bluffRatio = ranges.every((r) => archetypeById(r.villain.type).foldToBet > 0.5) ? 0.5 : 0.66;
    const bluffSize = clamp(spot.pot * bluffRatio, bb, effectiveStack);
    const fe = foldOdds(bluffSize / spot.pot);
    const bluffBreakEven = bluffMath(spot.pot, bluffSize).breakEvenFoldFrequency;

    if (equity > 0.6) {
      decision = { action: 'bet', size: valueSize, headline: `Bet ${amount(valueSize)} for value` };
      reasons.push(`You are ahead of the range still in the pot (${(equity * 100).toFixed(1)}% equity). Bet ${potFractionLabel(valueRatio)} and get paid by the worse hands that call.`);
    } else if (equity < 0.35 && fe > bluffBreakEven * 1.1) {
      decision = { action: 'bet', size: bluffSize, headline: `Bet ${amount(bluffSize)} as a bluff` };
      reasons.push(`Your showdown value is thin (${(equity * 100).toFixed(1)}%), but a ${potFractionLabel(bluffRatio)} bet needs to work ${(bluffBreakEven * 100).toFixed(0)}% of the time and this field folds about ${(fe * 100).toFixed(0)}%.`);
    } else {
      decision = { action: 'check', size: 0, headline: 'Check' };
      reasons.push(`${(equity * 100).toFixed(1)}% equity is too thin to bet for value and too much to turn into a bluff. Check and keep the pot the size you can control.`);
      if (fe < bluffBreakEven) {
        reasons.push(`A bluff here needs to work ${(bluffBreakEven * 100).toFixed(0)}% of the time and this field only folds about ${(fe * 100).toFixed(0)}% — there is no fold equity to buy.`);
      }
    }
  }

  // ---- Reads that come from who these people are, not from the cards ----
  for (const r of ranges) {
    const arch = archetypeById(r.villain.type);
    const pos = positionById(r.villain.position);
    exploits.push({
      seat: `${pos.name} — ${arch.name}`,
      note: arch.notes[decision.action === 'fold' ? 2 % arch.notes.length : decision.action === 'call' ? 1 % arch.notes.length : 0],
      range: r.summary,
      equity: equityResult.villains?.[ranges.indexOf(r)]?.equity ?? null,
    });
  }

  const context = [...setting.notes];
  if (setting.format === 'tournament') context.push(stage.note);
  if (spr < 3) context.push(`Stack-to-pot ratio is ${spr.toFixed(1)} — this pot is already committing. Decide now whether you are getting it in, not on the river.`);
  else if (spr > 12) context.push(`Stack-to-pot ratio is ${spr.toFixed(1)} — deep. Implied odds are worth more than raw equity, and one pair goes down in value.`);

  const heroPos = positionById(spot.hero.position);
  const inPosition = ranges.every((r) => hasPositionOn(spot.hero.position, r.villain.position));
  if (spot.board.length > 0) {
    context.push(inPosition
      ? `You act last on every remaining street from the ${heroPos.label.toLowerCase()}. Use it: check back the marginal hands and bet the ones that want to grow the pot.`
      : `You are out of position from the ${heroPos.label.toLowerCase()}, so lean towards the lower-variance line — check-call more, bluff less, and keep the pot smaller with the middle of your range.`);
  }

  if (ranges.length > 1) {
    context.push(`${ranges.length} players still in. Multiway pots want made hands and real draws, not thin bluffs — every extra player is another chance someone woke up with something.`);
  }

  return {
    street,
    hand,
    equity: equityResult,
    math,
    decision,
    reasons,
    exploits,
    context,
    ranges,
    spr,
    effectiveStack,
    inPosition,
  };
}
