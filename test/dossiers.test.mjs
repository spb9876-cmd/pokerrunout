import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyDossiers, recordHand, recordTell, recordRead, readTitle } from '../js/dossiers.js';
import { VENUES } from '../js/career.js';

test('a dossier accumulates hands, tells, and scored reads per character', () => {
  const d = emptyDossiers();
  recordHand(d, ['Uncle Ray', 'Sam']);
  recordHand(d, ['Uncle Ray']);
  recordTell(d, 'Uncle Ray');
  recordRead(d, 'Uncle Ray', true);
  recordRead(d, 'Uncle Ray', false);

  assert.equal(d.chars['Uncle Ray'].hands, 2);
  assert.equal(d.chars['Uncle Ray'].tells, 1);
  assert.equal(d.chars['Uncle Ray'].reads, 2);
  assert.equal(d.chars['Uncle Ray'].correct, 1);
  assert.equal(d.chars['Sam'].hands, 1);
  assert.equal(d.chars['Sam'].reads ?? 0, 0);
});

test('read titles need reads to change, and track accuracy', () => {
  assert.equal(readTitle(undefined), 'Stranger');
  assert.equal(readTitle({ hands: 50, tells: 9, reads: 2, correct: 2 }), 'Stranger');
  assert.equal(readTitle({ hands: 5, tells: 4, reads: 4, correct: 4 }), 'Open book');
  assert.equal(readTitle({ hands: 5, tells: 4, reads: 4, correct: 2 }), 'Getting there');
  assert.equal(readTitle({ hands: 5, tells: 4, reads: 4, correct: 0 }), 'Poker face');
});

test('every career character has a face, distinct within their venue', () => {
  for (const venue of VENUES) {
    const avatars = venue.config.villains.map((v) => v.avatar);
    for (const a of avatars) assert.ok(a && a.length > 0, `${venue.id} has a faceless character`);
    assert.equal(new Set(avatars).size, avatars.length, `${venue.id} repeats a face`);
  }
});
