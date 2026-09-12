// Character dossiers. Every named character you play against keeps a page:
// how many hands you have sat with them, how many of their mannerisms you have
// seen, and — the game inside the game — how often you called their tells
// right. Reading a person is a skill with a score, and the score persists.

export function emptyDossiers() {
  return { version: 1, chars: {} };
}

function charOf(dossiers, name) {
  if (!dossiers.chars[name]) dossiers.chars[name] = { hands: 0, tells: 0, reads: 0, correct: 0 };
  return dossiers.chars[name];
}

/** A completed hand with these named characters at the table. */
export function recordHand(dossiers, names) {
  for (const name of names) charOf(dossiers, name).hands += 1;
}

/** A tell from this character was shown, whether or not the hero called it. */
export function recordTell(dossiers, name) {
  charOf(dossiers, name).tells += 1;
}

/** The hero called a tell from this character strong or weak; was it right? */
export function recordRead(dossiers, name, correct) {
  const c = charOf(dossiers, name);
  c.reads += 1;
  if (correct) c.correct += 1;
}

/**
 * How well you read this person, as a title they would hate to hear.
 * Titles need reads to change — just sitting with someone teaches you nothing.
 */
export function readTitle(d) {
  if (!d || d.reads < 3) return 'Stranger';
  const accuracy = d.correct / d.reads;
  if (accuracy >= 0.75) return 'Open book';
  if (accuracy >= 0.5) return 'Getting there';
  return 'Poker face';
}

const STORE_KEY = 'runout.dossiers.v1';

export function loadDossiers() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.version === 1) return parsed;
    }
  } catch {
    /* fresh book */
  }
  return emptyDossiers();
}

export function saveDossiers(dossiers) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(dossiers));
  } catch {
    /* fine */
  }
}

export function resetDossiers() {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* fine */
  }
  return emptyDossiers();
}
