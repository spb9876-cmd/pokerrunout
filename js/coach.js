// The coach. After a hand ends it goes back through every decision you made,
// re-reads the spot with the same engine the analyzer uses — knowing only what
// you could have known — and says whether the decision was right, regardless
// of how the cards fell. Then it opens everything: what each player actually
// held, and which of the tells were telling the truth.

import { analyse } from './engine.js';
import { equityVsRanges } from './equity.js';
import { archetypeById, positionById } from './players.js';
import { readHand } from './handstrength.js';
import { decodeTell, TELL_RELIABILITY } from './tells.js';
import { percentileOnBoard } from './handstrength.js';
import { mulberry32 } from './rng.js';

const pct = (x) => `${(x * 100).toFixed(1)}%`;

/**
 * Grade one finished hand.
 * @returns {{ decisions: [], tells: [], summary, reveal }}
 */
export function gradeHand(session, hand) {
  const cfg = session.config;
  const hero = hand.seats.find((s) => s.isHero);
  const graded = hand.decisions.map((d, i) => gradeDecision(session, hand, d, i));

  for (const g of graded) {
    if (g.grade) session.grades[g.grade] += 1;
  }

  const tells = decodeTells(hand);
  const steam = hand.seats
    .filter((s) => !s.isHero && (s.tilt ?? 0) >= 0.25)
    .map(
      (s) =>
        `${positionById(s.position).name} (${archetypeById(s.type).name}) came into this hand steaming from a big loss — wider and angrier than their usual ranges, so give their aggression a little less credit and their calls a little more rope.`
    );
  const results = hand.results;
  const money = (n) => `${cfg.currency}${Math.round(Math.abs(n) * 100) / 100}`;

  const outcome =
    results.heroNet > 0.001
      ? `You won ${money(results.heroNet)} on the hand.`
      : results.heroNet < -0.001
        ? `You lost ${money(results.heroNet)} on the hand.`
        : 'You broke even on the hand.';

  const mistakes = graded.filter((g) => g.grade === 'mistake').length;
  const process =
    graded.length === 0
      ? 'No decisions came to you this hand.'
      : mistakes === 0
        ? 'Every decision held up against the ranges you were actually facing — that is the part you control.'
        : `${mistakes} decision${mistakes > 1 ? 's' : ''} cost you expectation, whatever the cards then did.`;

  return {
    decisions: graded,
    tells,
    steam,
    summary: { outcome, process, heroNet: results.heroNet, heroCards: [...hero.cards] },
    reveal: results.reveal,
  };
}

function gradeDecision(session, hand, d, index) {
  const cfg = session.config;
  const base = {
    index,
    street: d.street,
    board: d.board,
    action: d.action,
    amount: d.amount,
    heroPosition: d.heroPosition,
  };

  if (d.villains.length === 0) {
    return { ...base, grade: null, verdict: 'Everyone had already folded — nothing to decide.', detail: '' };
  }

  const hero = hand.seats.find((s) => s.isHero);
  const spot = {
    setting: cfg.setting,
    stage: cfg.stage,
    currency: cfg.currency,
    bigBlind: cfg.bigBlind,
    hero: { position: d.heroPosition, cards: hero.cards, stack: d.heroStack },
    villains: d.villains.map((v) => ({ position: v.position, type: v.type, stack: v.stack, role: v.role, action: v.streetAction })),
    board: d.board,
    pot: Math.max(d.pot, cfg.bigBlind),
    toCall: d.toCall,
    betRatio: d.pot > 0 ? d.toCall / d.pot : 0.6,
  };

  let report;
  try {
    report = analyse(spot, { trials: 5000, seed: 1000 + index });
  } catch {
    return { ...base, grade: null, verdict: 'This spot was too tangled to grade.', detail: '' };
  }

  // What you could not see: your real equity against the exact hands out there.
  let truth = null;
  try {
    const r = equityVsRanges({
      hero: hero.cards,
      board: d.board,
      villains: d.villains.map((v) => ({ combos: [v.cards] })),
      trials: 4000,
      seed: 2000 + index,
    });
    truth = r.equity;
  } catch {
    /* card conflicts cannot happen here, but stay safe */
  }

  const rec = report.decision.action;
  const equity = report.equity.equity;
  const required = report.math.requiredEquity;
  const facing = d.toCall > 0;
  const margin = Math.abs(equity - required);
  const aggressive = (a) => a === 'bet' || a === 'raise';
  const same = rec === d.action || (aggressive(rec) && aggressive(d.action));
  const money = (n) => `${cfg.currency}${Math.round(Math.abs(n) * 100) / 100}`;

  let grade;
  let verdict;
  if (same) {
    grade = 'good';
    verdict = `${cap(d.action)} was right — the engine lands on ${report.decision.headline.toLowerCase()}.`;
  } else if (facing && margin < 0.05) {
    grade = 'ok';
    verdict = `Close either way: you had ${pct(equity)} needing ${pct(required)}. ${cap(d.action)} is defensible.`;
  } else if (facing && rec === 'fold' && !aggressive(d.action) && d.action === 'call') {
    grade = 'mistake';
    const loss = (required - equity) * (d.pot + d.toCall);
    verdict = `Calling was the leak: ${pct(equity)} equity needing ${pct(required)} — about ${money(loss)} lit on fire per time.`;
  } else if (facing && d.action === 'fold' && (rec === 'call' || aggressive(rec))) {
    grade = 'mistake';
    verdict = `That fold gave up a profitable spot: ${pct(equity)} equity against ${pct(required)} needed.`;
  } else if (!facing && rec === 'bet' && d.action === 'check') {
    grade = equity > 0.7 ? 'mistake' : 'ok';
    verdict = equity > 0.7
      ? `Checking left money behind — at ${pct(equity)} this hand wants to grow the pot.`
      : `A check is playable, but the engine likes a bet here (${pct(equity)}).`;
  } else if (!facing && aggressive(d.action) && rec === 'check') {
    grade = 'ok';
    verdict = `The engine would check (${pct(equity)} equity), but a bet is not a disaster — just know why you are betting.`;
  } else if (aggressive(d.action) && rec === 'call') {
    grade = 'ok';
    verdict = `A call was enough; raising builds a pot you only sometimes want. Not wrong, just louder.`;
  } else if (d.action === 'call' && aggressive(rec)) {
    grade = 'ok';
    verdict = `Calling works, but this spot wanted pressure: ${report.decision.headline.toLowerCase()}.`;
  } else {
    grade = 'ok';
    verdict = `The engine preferred ${rec} — worth a second look.`;
  }

  const truthLine =
    truth !== null && Math.abs(truth - equity) > 0.12
      ? ` Against the actual hands out there you really had ${pct(truth)} — the read and the reality differed.`
      : truth !== null
        ? ` Your true equity against the exact hands was ${pct(truth)}.`
        : '';

  return {
    ...base,
    grade,
    verdict,
    detail: `Perceived equity ${pct(equity)} vs ${pct(required)} required.${truthLine}`,
    hand: readHand(hero.cards, d.board).made,
    equity,
    required,
    truth,
  };
}

const cap = (s) => s[0].toUpperCase() + s.slice(1);

/** What the body language was actually worth, tell by tell. */
function decodeTells(hand) {
  const out = [];
  const rng = mulberry32(hand.number * 31 + 7);
  for (const entry of hand.log) {
    if (!entry.tell) continue;
    const seat = hand.seats.find((s) => s.id === entry.seat);
    const arch = archetypeById(seat.type);
    // What the hand really was at that moment.
    const board = boardAt(hand, entry.street);
    const strong =
      entry.hiddenStrength !== undefined
        ? entry.hiddenStrength >= (entry.street === 'preflop' ? 0.88 : 0.7)
        : percentileOnBoard(seat.cards, board, rng) >= 0.7;
    out.push({
      seat: entry.seat,
      position: positionById(seat.position).name,
      type: arch.name,
      reliability: TELL_RELIABILITY[seat.type] ?? 0.6,
      line: entry.text,
      decoded: decodeTell(entry.tell, { typeName: arch.name, hadStrong: strong }),
    });
  }
  return out;
}

function boardAt(hand, street) {
  const size = { preflop: 0, flop: 3, turn: 4, river: 5 }[street] ?? 0;
  return hand.board.slice(0, size);
}
