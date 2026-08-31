import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, startHand, step, heroAct } from '../js/game.js';
import { gradeHand } from '../js/coach.js';

const CONFIG = {
  setting: 'home_cash',
  stage: 'early',
  currency: '$',
  smallBlind: 1,
  bigBlind: 2,
  heroStack: 200,
  villains: [
    { type: 'recreational', stack: 200 },
    { type: 'tricky', stack: 200 },
  ],
};

function playHand(session, policy) {
  startHand(session);
  let guard = 0;
  for (;;) {
    if (++guard > 400) throw new Error('no end');
    const ev = step(session);
    if (ev.kind === 'over') return ev.results;
    if (ev.kind === 'hero-turn') {
      const move = policy(ev);
      heroAct(session, move.action, move.amount ?? 0);
    }
  }
}

test('every played hand can be graded, and grades are tracked', () => {
  const session = createSession(structuredClone(CONFIG), 13);
  let graded = 0;
  for (let i = 0; i < 25; i++) {
    playHand(session, (ev) => (ev.canCheck ? { action: 'check' } : { action: 'call' }));
    const coach = gradeHand(session, session.hand);
    assert.ok(coach.summary.outcome.length > 0);
    assert.ok(Array.isArray(coach.decisions));
    assert.ok(Array.isArray(coach.tells));
    assert.equal(coach.reveal.length, 3, 'the whole table is revealed');
    for (const d of coach.decisions) {
      assert.ok(d.verdict.length > 0, 'every decision gets a verdict');
      if (d.grade) {
        graded++;
        assert.ok(['good', 'ok', 'mistake'].includes(d.grade));
      }
    }
    for (const t of coach.tells) {
      assert.match(t.decoded, /honest read|false signal/);
    }
  }
  const total = session.grades.good + session.grades.ok + session.grades.mistake;
  assert.equal(total, graded);
  assert.ok(graded > 10, `expected plenty of graded decisions, got ${graded}`);
});

test('calling every street with junk gets flagged sooner or later', () => {
  const session = createSession(structuredClone(CONFIG), 99);
  for (let i = 0; i < 30; i++) {
    playHand(session, (ev) => (ev.canCheck ? { action: 'check' } : { action: 'call' }));
    gradeHand(session, session.hand);
  }
  assert.ok(session.grades.mistake > 0, 'station-calling everything must produce mistakes');
  assert.ok(session.grades.good > 0, 'checking when checking is right must count as good');
});
