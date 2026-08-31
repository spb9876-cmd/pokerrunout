import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCards } from '../js/cards.js';
import * as engine from '../js/engine.js';
import { analyse, preflopRange, callMath, bluffMath, foldFrequency, bandCodes } from '../js/engine.js';
import { archetypeById, settingById } from '../js/players.js';
import { rangePercent } from '../js/ranges.js';

const spot = (over = {}) => ({
  setting: 'casino_cash',
  stage: 'early',
  currency: '$',
  bigBlind: 5,
  hero: { position: 'btn', cards: parseCards('Ah Kd'), stack: 500 },
  villains: [{ position: 'bb', type: 'recreational', stack: 400, role: 'blind', action: 'bet' }],
  board: parseCards('Ks 8d 3c'),
  pot: 60,
  toCall: 40,
  betRatio: 0.66,
  ...over,
});

const run = (over) => analyse(spot(over), { trials: 6000, seed: 4 });

test('a nit plays fewer hands than a maniac, everywhere', () => {
  for (const position of ['utg', 'co', 'btn']) {
    const nit = rangePercent(preflopRange({ type: 'nit', position, role: 'raised' }, settingById('casino_cash')));
    const maniac = rangePercent(preflopRange({ type: 'maniac', position, role: 'raised' }, settingById('casino_cash')));
    assert.ok(nit < maniac, `${position}: nit ${nit} should be tighter than maniac ${maniac}`);
    assert.ok(nit > 0 && maniac < 1);
  }
});

test('everyone opens wider on the button than under the gun', () => {
  for (const type of ['nit', 'tag', 'lag', 'recreational']) {
    const utg = rangePercent(preflopRange({ type, position: 'utg', role: 'raised' }, settingById('casino_cash')));
    const btn = rangePercent(preflopRange({ type, position: 'btn', role: 'raised' }, settingById('casino_cash')));
    assert.ok(btn > utg, `${type} should open wider on the button (${btn}) than UTG (${utg})`);
  }
});

test('a calling range is capped — the very best hands would have raised', () => {
  const called = preflopRange({ type: 'tag', position: 'co', role: 'called' }, settingById('casino_cash'));
  assert.ok((called.get('AA') ?? 0) < 1, 'aces should not be a full-weight flat call for a reg');
  assert.ok(called.has('JTs') || called.has('99'), 'but the middle of the range should be there');
});

test('the setting widens the pool', () => {
  const home = rangePercent(preflopRange({ type: 'unknown', position: 'co', role: 'raised' }, settingById('home_cash')));
  const online = rangePercent(preflopRange({ type: 'unknown', position: 'co', role: 'raised' }, settingById('online_cash')));
  assert.ok(home > online, `home game (${home}) should play looser than online (${online})`);
});

test('bands are contiguous and non-overlapping', () => {
  const a = bandCodes(0, 0.1);
  const b = bandCodes(0.1, 0.3);
  assert.ok(a.length > 0 && b.length > 0);
  assert.equal(a.filter((c) => b.includes(c)).length, 0);
  assert.equal(a[0], 'AA');
});

test('bigger bets get more folds, and stickier players fold less', () => {
  const setting = settingById('casino_cash');
  const tag = archetypeById('tag');
  assert.ok(foldFrequency(tag, setting, 1.0, 'flop') > foldFrequency(tag, setting, 0.33, 'flop'));
  assert.ok(foldFrequency(archetypeById('station'), setting, 0.66, 'flop') < foldFrequency(archetypeById('nit'), setting, 0.66, 'flop'));
  assert.ok(foldFrequency(archetypeById('station'), setting, 2, 'river') <= 0.93);
});

test('pot odds and bluff break-evens are the textbook numbers', () => {
  const m = callMath({ pot: 100, toCall: 50, setting: 'casino_cash', stage: 'early', hero: { stack: 1000 } }, 0.4);
  assert.ok(Math.abs(m.potOdds - 1 / 3) < 1e-9, 'calling 50 into 100 is a third');
  assert.ok(Math.abs(m.evCall - (0.4 * 150 - 0.6 * 50)) < 1e-9);
  assert.ok(Math.abs(bluffMath(100, 100).breakEvenFoldFrequency - 0.5) < 1e-9, 'a pot-sized bluff needs to work half the time');
  assert.ok(Math.abs(bluffMath(100, 50).breakEvenFoldFrequency - 1 / 3) < 1e-9);
});

test('top pair against a recreational bettor is not a fold', () => {
  const r = run();
  assert.notEqual(r.decision.action, 'fold');
  assert.ok(r.equity.equity > 0.6);
  assert.equal(r.hand.made, 'top pair, top kicker');
});

test('air facing a big bet with no odds is a fold', () => {
  const r = run({
    hero: { position: 'btn', cards: parseCards('7h 2d'), stack: 500 },
    villains: [{ position: 'bb', type: 'nit', stack: 400, role: 'blind', action: 'bet' }],
    board: parseCards('Ks Qd Jc'),
    pot: 60,
    toCall: 60,
  });
  assert.equal(r.decision.action, 'fold');
});

test('a bluff is offered against a nit and refused against a station', () => {
  const checkedTo = {
    hero: { position: 'btn', cards: parseCards('7h 6d'), stack: 500 },
    board: parseCards('As Kd 2c'),
    pot: 60,
    toCall: 0,
  };
  const vsNit = run({ ...checkedTo, villains: [{ position: 'bb', type: 'nit', stack: 400, role: 'blind', action: 'checked' }] });
  const vsStation = run({ ...checkedTo, villains: [{ position: 'bb', type: 'station', stack: 400, role: 'blind', action: 'checked' }] });
  assert.equal(vsNit.decision.action, 'bet', 'a nit folds often enough to bluff');
  assert.equal(vsStation.decision.action, 'check', 'a station never folds, so there is nothing to buy');
  assert.match(vsStation.reasons.join(' '), /fold equity|folds about/);
});

test('tournament pressure raises the price of a call', () => {
  const base = { pot: 100, toCall: 300, hero: { stack: 400 } };
  const cash = callMath({ ...base, setting: 'casino_cash', stage: 'early' }, 0.5);
  const bubble = callMath({ ...base, setting: 'casino_tourney', stage: 'bubble' }, 0.5);
  assert.ok(bubble.requiredEquity > cash.requiredEquity + 0.05, `${bubble.requiredEquity} vs ${cash.requiredEquity}`);
  assert.equal(cash.riskPremium, 0);
});

test('a small call is not a tournament-life decision', () => {
  const tiny = callMath({ pot: 100, toCall: 5, setting: 'casino_tourney', stage: 'final', hero: { stack: 5000 } }, 0.5);
  assert.ok(tiny.riskPremium < 0.005, `tiny calls should carry almost no risk premium, got ${tiny.riskPremium}`);
});

test('every opponent gets a read and the setting gets a say', () => {
  const r = run({
    villains: [
      { position: 'co', type: 'station', stack: 400, role: 'called', action: 'called' },
      { position: 'bb', type: 'tag', stack: 400, role: 'blind', action: 'called' },
    ],
    toCall: 0,
  });
  assert.equal(r.exploits.length, 2);
  assert.ok(r.exploits.every((e) => e.note && e.seat));
  assert.ok(r.context.length >= 3);
  assert.match(r.context.join(' '), /players still in/);
});

test('refuses a spot with nobody in it', () => {
  assert.throws(() => run({ villains: [] }), /opponent/i);
});

test('a check caps the preflop raiser but not the player checking to them', () => {
  const board = parseCards('Ks 8d 3c');
  const setting = settingById('casino_cash');
  const { continuingRange, preflopRange } = engine;

  const raiser = { position: 'co', type: 'tag', role: 'raised', action: 'checked' };
  const defender = { position: 'bb', type: 'tag', role: 'blind', action: 'checked' };

  const raiserRange = continuingRange(preflopRange(raiser, setting), board, raiser, setting);
  const defenderRange = continuingRange(preflopRange(defender, setting), board, defender, setting);

  assert.match(raiserRange.summary.label, /capped/);
  assert.match(defenderRange.summary.label, /tells you nothing/);
});
