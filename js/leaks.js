// The leak profile. One graded hand is a fact; hundreds are a diagnosis.
// Aggregates every decision the coach grades — across sessions — into the
// handful of sentences a good coach would actually say to you.

const LEAK_INFO = {
  'loose-call': {
    title: 'You call when you are beat',
    line: (n, cost, money) =>
      `${n} call${n === 1 ? '' : 's'} that needed more equity than you had — roughly ${money(cost)} lit on fire. When the price is wrong, the cards do not owe you a miracle.`,
  },
  overfold: {
    title: 'You fold winners',
    line: (n) =>
      `${n} fold${n === 1 ? '' : 's'} where the price made continuing profitable. You are letting the table bluff you out of money that was already yours.`,
  },
  'missed-value': {
    title: 'You leave value on the table',
    line: (n) =>
      `${n} check${n === 1 ? '' : 's'} with a hand strong enough to bet. Good hands pay the rent — make the worse hands pay to see cards.`,
  },
  'missed-bluff': {
    title: 'You give up when the bluff is right there',
    line: (n) =>
      `${n} spot${n === 1 ? '' : 's'} where the field folds often enough to make betting profitable, and you checked or folded instead. Aggression is not a mood — it is arithmetic, and the arithmetic was on your side.`,
  },
  'bad-bluff': {
    title: 'You bluff people who do not fold',
    line: (n) =>
      `${n} bluff${n === 1 ? '' : 's'} fired at players who were never letting go. A bluff is a story the other player has to be willing to fold to — pick the target, not the moment.`,
  },
  'loose-open': {
    title: 'You open junk',
    line: (n) =>
      `${n} unprofitable preflop entr${n === 1 ? 'y' : 'ies'}. The cheapest mistake in poker to stop making: just fold the bad ones.`,
  },
};

export function emptyLeaks() {
  return { version: 1, graded: 0, good: 0, ok: 0, mistake: 0, cost: 0, keys: {}, hands: 0 };
}

/** Fold one hand's coach report into the running profile. */
export function recordCoach(leaks, coach) {
  leaks.hands += 1;
  for (const d of coach.decisions) {
    if (!d.grade) continue;
    leaks.graded += 1;
    leaks[d.grade] += 1;
    if (d.grade === 'mistake' && d.leakKey) {
      leaks.keys[d.leakKey] = (leaks.keys[d.leakKey] ?? 0) + 1;
      leaks.cost += d.cost ?? 0;
    }
  }
  return leaks;
}

/**
 * The diagnosis: the leaks that matter, worst first, in plain language.
 * Returns { headline, items: [{key, title, line, count}] }.
 */
export function diagnose(leaks, money = (n) => `$${Math.round(n)}`) {
  const items = Object.entries(leaks.keys)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, n]) => ({
      key,
      count: n,
      title: LEAK_INFO[key]?.title ?? key,
      line: LEAK_INFO[key]?.line(n, leaks.cost, money) ?? `${n} times.`,
    }));

  const accuracy = leaks.graded > 0 ? leaks.good / leaks.graded : 0;
  let headline;
  if (leaks.graded < 15) {
    headline = `${leaks.graded} decision${leaks.graded === 1 ? '' : 's'} graded so far — play more hands and the picture sharpens.`;
  } else if (items.length === 0 || leaks.mistake / leaks.graded < 0.08) {
    headline = `Solid: ${Math.round(accuracy * 100)}% of your ${leaks.graded} graded decisions were right, and no leak stands out. The remaining edge is in the close calls.`;
  } else {
    headline = `${leaks.graded} decisions graded: ${Math.round(accuracy * 100)}% right, ${leaks.mistake} clear mistake${leaks.mistake === 1 ? '' : 's'}. Your money is leaking from ${items.length === 1 ? 'one place' : items.length + ' places'}:`;
  }
  return { headline, items, accuracy };
}

const STORE_KEY = 'runout.leaks.v1';

export function loadLeaks() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.version === 1) return parsed;
    }
  } catch {
    /* fresh profile */
  }
  return emptyLeaks();
}

export function saveLeaks(leaks) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(leaks));
  } catch {
    /* fine */
  }
}

export function resetLeaks() {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* fine */
  }
  return emptyLeaks();
}
