import test from 'node:test';
import assert from 'node:assert/strict';
import { VENUES, venueById, newCareer, unlocked, canAfford, sitDownConfig, settle, canRebuy } from '../js/career.js';
import { createSession, startHand, step, heroAct } from '../js/game.js';
import { emptyLeaks, recordCoach, diagnose } from '../js/leaks.js';
import { gradeHand } from '../js/coach.js';

test('the ladder is a ladder', () => {
  assert.ok(VENUES.length >= 5);
  let lastUnlock = -1;
  for (const venue of VENUES) {
    assert.ok(venue.unlock >= lastUnlock, `${venue.name} unlocks in order`);
    lastUnlock = venue.unlock;
    assert.ok(venue.buyin > 0);
    assert.ok(venue.config.villains.length >= 3, `${venue.name} has a real lineup`);
    for (const v of venue.config.villains) assert.ok(v.name, 'career characters have names');
  }
  const fresh = newCareer();
  assert.ok(unlocked(fresh, VENUES[0]), 'the kitchen table is always open');
  assert.ok(canAfford(fresh, VENUES[0]));
  assert.ok(!unlocked(fresh, VENUES.at(-1)), 'the big game is earned');
});

test('a career session settles money correctly, win or bust', () => {
  const career = newCareer();
  const venue = VENUES[0];
  const before = career.bankroll;

  const session = createSession(sitDownConfig(venue), 81);
  // Simulate: hero bought in once (invested = buyin) and doubled up.
  session.invested[0] = venue.buyin;
  session.stacks[0] = venue.buyin * 2;
  session.handsPlayed = 12;
  const win = settle(career, venue, session);
  assert.equal(win.net, venue.buyin);
  assert.equal(career.bankroll, before + venue.buyin);
  assert.equal(career.handsPlayed, 12);
  assert.ok(!win.staked);

  // Now lose everything, twice over (a rebuy), leaving nothing.
  const s2 = createSession(sitDownConfig(venue), 83);
  s2.invested[0] = venue.buyin * 3;
  s2.stacks[0] = 0;
  s2.handsPlayed = 9;
  const bust = settle(career, venue, s2);
  assert.equal(bust.net, -venue.buyin * 3);
  assert.equal(career.bankroll, venue.buyin, 'the stake puts you back to one kitchen-table buy-in');
  assert.ok(bust.staked);
  assert.equal(career.stakes, 1);
});

test('rebuy affordability tracks cash outside the table', () => {
  const career = newCareer(); // 100
  const venue = VENUES[0]; // buyin 50
  const session = createSession(sitDownConfig(venue), 85);
  session.invested[0] = 50;
  assert.ok(canRebuy(career, venue, session), '100 roll, 50 in play: one more bullet fits');
  session.invested[0] = 100;
  assert.ok(!canRebuy(career, venue, session), 'both buy-ins in play: no cash left');
});

test('career hands actually play with named characters in the talk', () => {
  const venue = venueById('garage');
  const session = createSession(sitDownConfig(venue), 87);
  for (let i = 0; i < 5; i++) {
    startHand(session);
    let guard = 0;
    for (;;) {
      if (++guard > 400) throw new Error('no end');
      const ev = step(session);
      if (ev.kind === 'over') break;
      if (ev.kind === 'hero-turn') heroAct(session, ev.canCheck ? 'check' : 'fold');
    }
  }
  const talk = session.hand.log.map((e) => e.text).join('\n');
  assert.match(talk, /Dave \(|Marcus \(|Jenny \(|Big Tony \(/, `characters speak by name:\n${talk}`);
});

test('the leak profile aggregates coach reports into a diagnosis', () => {
  const leaks = emptyLeaks();
  recordCoach(leaks, {
    decisions: [
      { grade: 'mistake', leakKey: 'loose-call', cost: 12 },
      { grade: 'mistake', leakKey: 'loose-call', cost: 8 },
      { grade: 'good', leakKey: null, cost: 0 },
      { grade: 'ok', leakKey: null, cost: 0 },
    ],
  });
  recordCoach(leaks, { decisions: [{ grade: 'mistake', leakKey: 'overfold', cost: 5 }] });
  assert.equal(leaks.graded, 5);
  assert.equal(leaks.mistake, 3);
  assert.equal(leaks.keys['loose-call'], 2);
  assert.equal(leaks.cost, 25);

  const d = diagnose(leaks);
  assert.ok(d.items[0].key === 'loose-call', 'worst leak first');
  assert.match(d.items[0].line, /call/i);
  assert.match(d.headline, /decision/);
});

test('live play produces leak-classified mistakes end to end', () => {
  const cfg = {
    setting: 'home_cash', stage: 'early', currency: '$', smallBlind: 1, bigBlind: 2, heroStack: 200, mood: 'early',
    villains: [{ type: 'tag', stack: 200 }, { type: 'nit', stack: 200 }],
  };
  const session = createSession(structuredClone(cfg), 91);
  const leaks = emptyLeaks();
  for (let i = 0; i < 25; i++) {
    startHand(session);
    let guard = 0;
    for (;;) {
      if (++guard > 400) throw new Error('no end');
      const ev = step(session);
      if (ev.kind === 'over') break;
      if (ev.kind === 'hero-turn') heroAct(session, ev.canCheck ? 'check' : 'call'); // call-everything: leaky on purpose
    }
    recordCoach(leaks, gradeHand(session, session.hand));
  }
  assert.ok(leaks.graded > 20);
  assert.ok(Object.keys(leaks.keys).length > 0, `calling everything must register leaks: ${JSON.stringify(leaks.keys)}`);
});
