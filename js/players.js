// Player archetypes and table settings.
//
// This is the part that makes a runout mean something. The same hand on the
// same board is a different decision against the friend who never folds a pair
// and against a stranger three seats over at a casino, and it is a different
// decision again on a tournament bubble. Every number below is a tendency, not
// a law — they are the starting point you adjust once you have a read.

/**
 * Archetype fields, all frequencies as 0..1:
 *   openBy        share of hands they raise first in, per position group
 *   callVsOpen    share of hands they call a raise with
 *   threeBet      share of hands they re-raise with
 *   limp          how often they enter the pot by calling the blind
 *   cbet          how often they bet when they take the lead on the flop
 *   foldToBet     how often they fold facing a bet on a street they did not lead
 *   bluffShare    share of their betting range that is a bluff
 *   raiseBluff    how often a raise from them is a bluff
 *   calldown      how far down their range they will call a river bet
 *   sizingTell    do their bet sizes tell you what they have
 */
export const ARCHETYPES = [
  {
    id: 'nit',
    name: 'Nit',
    tagline: 'Waits for the goods, then tells you about it',
    openBy: { early: 0.08, middle: 0.1, late: 0.14, blinds: 0.1 },
    callVsOpen: 0.07,
    threeBet: 0.025,
    limp: 0.05,
    cbet: 0.55,
    foldToBet: 0.62,
    bluffShare: 0.1,
    raiseBluff: 0.03,
    calldown: 0.3,
    sizingTell: true,
    notes: [
      'When they put money in, believe them — fold hands you would call down with against anyone else.',
      'Attack their checks relentlessly; they fold everything that missed.',
      'Do not bluff-catch. Their river bet is the top of their range almost every time.',
    ],
  },
  {
    id: 'tag',
    name: 'Tight-aggressive reg',
    tagline: 'Solid, positionally aware, mostly does the right thing',
    openBy: { early: 0.16, middle: 0.2, late: 0.3, blinds: 0.22 },
    callVsOpen: 0.14,
    threeBet: 0.07,
    limp: 0.02,
    cbet: 0.62,
    foldToBet: 0.48,
    bluffShare: 0.3,
    raiseBluff: 0.18,
    calldown: 0.5,
    sizingTell: false,
    notes: [
      'Ranges are close to correct, so pure exploits are thin — take the small edges from position.',
      'They fold to pressure on boards that miss a calling range; pick your spots on high, dry flops.',
      'Their raises are weighted to value. Give their big turn and river raises credit.',
    ],
  },
  {
    id: 'lag',
    name: 'Loose-aggressive reg',
    tagline: 'Plays a lot of hands and puts you to decisions',
    openBy: { early: 0.24, middle: 0.32, late: 0.45, blinds: 0.35 },
    callVsOpen: 0.22,
    threeBet: 0.12,
    limp: 0.02,
    cbet: 0.72,
    foldToBet: 0.42,
    bluffShare: 0.42,
    raiseBluff: 0.3,
    calldown: 0.58,
    sizingTell: false,
    notes: [
      'Widen your calling range — a large part of their betting range is air.',
      'Let them bluff into you. Check strong hands more often than you would against a passive player.',
      'Re-raise light preflop in position; their opening range folds to pressure more than they admit.',
    ],
  },
  {
    id: 'station',
    name: 'Calling station',
    tagline: 'Comes to see cards and never wants to fold',
    openBy: { early: 0.1, middle: 0.12, late: 0.16, blinds: 0.12 },
    callVsOpen: 0.42,
    threeBet: 0.02,
    limp: 0.4,
    cbet: 0.3,
    foldToBet: 0.22,
    bluffShare: 0.08,
    raiseBluff: 0.02,
    calldown: 0.88,
    sizingTell: true,
    notes: [
      'Never bluff. It does not matter how good the story is; they are calling.',
      'Value bet two and three streets with hands you would normally check — top pair is a three-street hand here.',
      'Size up. They call the same range whether you bet half pot or full pot.',
    ],
  },
  {
    id: 'maniac',
    name: 'Maniac',
    tagline: 'Raises everything, bluffs every street, occasionally has it',
    openBy: { early: 0.4, middle: 0.5, late: 0.6, blinds: 0.55 },
    callVsOpen: 0.35,
    threeBet: 0.22,
    limp: 0.05,
    cbet: 0.85,
    foldToBet: 0.35,
    bluffShare: 0.6,
    raiseBluff: 0.45,
    calldown: 0.65,
    sizingTell: false,
    notes: [
      'Stop bluffing and start trapping. Let them build the pot for you.',
      'Any pair is a bluff-catcher; call down far lighter than feels comfortable.',
      'Isolate them in position and get in with a range they are drawing thin against.',
    ],
  },
  {
    id: 'recreational',
    name: 'Recreational',
    tagline: 'Here for a good time — plays any two, chases everything',
    openBy: { early: 0.14, middle: 0.18, late: 0.24, blinds: 0.2 },
    callVsOpen: 0.4,
    threeBet: 0.03,
    limp: 0.45,
    cbet: 0.4,
    foldToBet: 0.3,
    bluffShare: 0.15,
    raiseBluff: 0.06,
    calldown: 0.75,
    sizingTell: true,
    notes: [
      'They arrive on the river with any pair and any draw — bet your good hands for value, all three streets.',
      'Charge the draws. Half-pot is a discount when they are calling with a gutshot.',
      'Play more suited and connected hands in position against them; the implied odds are real.',
    ],
  },
  {
    id: 'abc',
    name: 'Straightforward friend',
    tagline: 'Someone you know who plays it face-up: bets when good, checks when not',
    openBy: { early: 0.12, middle: 0.16, late: 0.22, blinds: 0.18 },
    callVsOpen: 0.2,
    threeBet: 0.04,
    limp: 0.25,
    cbet: 0.45,
    foldToBet: 0.5,
    bluffShare: 0.12,
    raiseBluff: 0.05,
    calldown: 0.5,
    sizingTell: true,
    notes: [
      'Read their line, not their cards. Checking twice means they missed; bet and take it.',
      'When they lead into you on a scary board, they have it. Fold the middle of your range.',
      'Watch the bet size — bigger means stronger against this player almost every time.',
    ],
  },
  {
    id: 'tricky',
    name: 'Tricky regular you know',
    tagline: 'Has history with you, adjusts to you, and knows you are reading them',
    openBy: { early: 0.2, middle: 0.26, late: 0.38, blinds: 0.3 },
    callVsOpen: 0.2,
    threeBet: 0.1,
    limp: 0.06,
    cbet: 0.6,
    foldToBet: 0.45,
    bluffShare: 0.4,
    raiseBluff: 0.28,
    calldown: 0.6,
    sizingTell: false,
    notes: [
      'Assume they know your tendencies too. Whatever you did last time in this spot, they saw it.',
      'Balance matters against this one — mix your sizings and do not run the same bluff twice.',
      'Their unusual lines are more often bluffs than they would be from anyone else at the table.',
    ],
  },
  {
    id: 'unknown',
    name: 'Unknown',
    tagline: 'No reads — assume the pool average for this setting',
    openBy: { early: 0.15, middle: 0.19, late: 0.28, blinds: 0.22 },
    callVsOpen: 0.2,
    threeBet: 0.06,
    limp: 0.15,
    cbet: 0.55,
    foldToBet: 0.45,
    bluffShare: 0.25,
    raiseBluff: 0.14,
    calldown: 0.55,
    sizingTell: false,
    notes: [
      'Play a solid default and collect information before you commit to a read.',
      'The setting is the read until you have a better one — see the setting notes.',
    ],
  },
];

export const archetypeById = (id) => ARCHETYPES.find((a) => a.id === id) ?? ARCHETYPES.at(-1);

/**
 * The setting. Where the game is being played changes the pool, and the pool
 * changes every range at the table before a single card is dealt.
 *
 *   loosen        added to how wide unknown players play
 *   foldEquity    multiplier on how often bluffs actually get through
 *   defaultType   what an unknown seat looks like here
 *   riskPremium   extra equity required to stack off (tournament survival)
 */
export const SETTINGS = [
  {
    id: 'home_cash',
    name: 'Home game with friends',
    format: 'cash',
    tagline: 'People you know, history at the table, nobody folding to a friend',
    loosen: 0.14,
    foldEquity: 0.82,
    defaultType: 'abc',
    riskPremium: 0,
    notes: [
      'Everyone has history with everyone. Your image is doing more work here than any solver output.',
      'Fold equity is low — people call to see if you were bluffing them specifically. Bluff less, value bet thinner.',
      'Pots go multiway. Hands that make the nuts beat hands that make top pair; play suited and connected, fold weak aces.',
    ],
  },
  {
    id: 'casino_cash',
    name: 'Casino cash game',
    format: 'cash',
    tagline: 'Strangers, a loose-passive pool, straddles and limped pots',
    loosen: 0.08,
    foldEquity: 0.9,
    defaultType: 'recreational',
    riskPremium: 0,
    notes: [
      'The default unknown here is recreational, not a reg. Assume too loose and too sticky until shown otherwise.',
      'Isolate limpers in position and size up preflop — the pool calls raises far too wide.',
      'Value bet relentlessly and bluff selectively. Most of your win rate comes from getting paid, not from getting through.',
    ],
  },
  {
    id: 'online_cash',
    name: 'Online cash game',
    format: 'cash',
    tagline: 'Tighter, more aggressive, more balanced ranges',
    loosen: -0.02,
    foldEquity: 1.0,
    defaultType: 'tag',
    riskPremium: 0,
    notes: [
      'Ranges are closer to correct, so your edge comes from position and sizing rather than from big reads.',
      'Multi-tabling opponents play a default line — attack the spots where a default is clearly wrong.',
      'Expect three-bets. Have a plan for your opening range before you click raise.',
    ],
  },
  {
    id: 'online_tourney',
    name: 'Online tournament',
    format: 'tournament',
    tagline: 'Fast blinds, re-entries, and a field that has seen every chart',
    loosen: -0.02,
    foldEquity: 1.0,
    defaultType: 'tag',
    riskPremium: 0.05,
    notes: [
      'The field is younger and more aggressive than live — expect three-bets and jams that live players never make.',
      'Blind levels move fast online. A comfortable stack is two levels away from a desperate one; keep counting in big blinds.',
      'Re-entry periods play like a cash game with an ante; the real ICM starts when the re-entries close.',
    ],
  },
  {
    id: 'home_tourney',
    name: 'Home tournament',
    format: 'tournament',
    tagline: 'Friends, a fixed buy-in, and nobody wants to bust first',
    loosen: 0.1,
    foldEquity: 0.85,
    defaultType: 'abc',
    riskPremium: 0.03,
    notes: [
      'Early levels play like a loose cash game; late levels play like everyone forgot about the blinds.',
      'Stacks are shallow relative to the pot as it goes on. Count everything in big blinds, not in dollars.',
      'Nobody wants to be the one who busts in front of their friends — steal more than you think you can.',
    ],
  },
  {
    id: 'casino_tourney',
    name: 'Casino tournament',
    format: 'tournament',
    tagline: 'Real payout jumps, real ICM, a mix of regs and satellite qualifiers',
    loosen: 0.02,
    foldEquity: 0.95,
    defaultType: 'unknown',
    riskPremium: 0.06,
    notes: [
      'Chips you lose are worth more than chips you win. Marginal calls for stacks stop being break-even.',
      'Pressure the medium stacks — they are the ones who cannot call.',
      'Antes change everything. Open wider than the raw hand strength suggests once they kick in.',
    ],
  },
];

export const settingById = (id) => SETTINGS.find((s) => s.id === id) ?? SETTINGS[0];

/** Tournament stage — how much survival is worth on top of raw chip equity. */
export const STAGES = [
  { id: 'early', name: 'Early levels', riskPremium: 0.0, note: 'Chips are close to their face value; play a chip-EV game.' },
  { id: 'middle', name: 'Middle levels', riskPremium: 0.02, note: 'Stacks are shortening. Blind pressure starts to matter more than hand strength.' },
  { id: 'bubble', name: 'On the bubble', riskPremium: 0.09, note: 'The bubble is the single biggest ICM spot of the tournament — folding is cheap and calling is expensive.' },
  { id: 'itm', name: 'In the money', riskPremium: 0.04, note: 'Pay jumps are live. Short stacks are desperate; big stacks should be relentless.' },
  { id: 'final', name: 'Final table', riskPremium: 0.11, note: 'Every pay jump is enormous. Avoid coin flips for your tournament life without a clear edge.' },
];

export const stageById = (id) => STAGES.find((s) => s.id === id) ?? STAGES[0];

/** Table positions, from first to act preflop to last. */
export const POSITIONS = [
  { id: 'utg', name: 'UTG', group: 'early', label: 'Under the gun' },
  { id: 'utg1', name: 'UTG+1', group: 'early', label: 'Under the gun +1' },
  { id: 'mp', name: 'MP', group: 'middle', label: 'Middle position' },
  { id: 'lj', name: 'LJ', group: 'middle', label: 'Lojack' },
  { id: 'hj', name: 'HJ', group: 'late', label: 'Hijack' },
  { id: 'co', name: 'CO', group: 'late', label: 'Cutoff' },
  { id: 'btn', name: 'BTN', group: 'late', label: 'Button' },
  { id: 'sb', name: 'SB', group: 'blinds', label: 'Small blind' },
  { id: 'bb', name: 'BB', group: 'blinds', label: 'Big blind' },
];

export const positionById = (id) => POSITIONS.find((p) => p.id === id) ?? POSITIONS[0];

/** Seats in order for a table of `n`, always ending SB, BB. */
export function seatsForTableSize(n) {
  const order = ['utg', 'utg1', 'mp', 'lj', 'hj', 'co', 'btn'];
  const middle = order.slice(Math.max(0, order.length - (n - 2)));
  return [...middle, 'sb', 'bb'];
}

/** Is `a` acting after `b` on every postflop street? */
export function hasPositionOn(a, b) {
  const order = ['sb', 'bb', 'utg', 'utg1', 'mp', 'lj', 'hj', 'co', 'btn'];
  return order.indexOf(a) > order.indexOf(b);
}

/**
 * How deep into the night a home game is. The same table plays three different
 * games between eight o'clock and two in the morning: ranges drift wider, the
 * stuck players stop folding, and the pots grow to match.
 *
 *   heat        baseline tilt applied to everyone at the table
 *   loosen      added on top of the setting's loosen
 *   foldEquity  multiplier on how often bluffs get through
 */
export const MOODS = [
  {
    id: 'early',
    name: 'Early evening — casual',
    heat: 0,
    loosen: 0,
    foldEquity: 1,
    note: 'Everyone is fresh and playing their normal game. Pots are honest and a big bet means it.',
  },
  {
    id: 'swing',
    name: 'Mid-session — loosening up',
    heat: 0.12,
    loosen: 0.05,
    foldEquity: 0.94,
    note: 'A few drinks and a few lost pots in. Ranges are drifting wider and calls come easier than folds.',
  },
  {
    id: 'late',
    name: 'Late night — stuck and steaming',
    heat: 0.3,
    loosen: 0.12,
    foldEquity: 0.84,
    note: 'The stuck players are chasing it back before the night ends. Aggression is up and folding is out of fashion — stop bluffing, start charging.',
  },
];

export const moodById = (id) => MOODS.find((m) => m.id === id) ?? MOODS[0];

/** Does this setting have a night to get deep into? */
export const hasMoods = (setting) => setting.id === 'home_cash';

/** The setting as it actually plays at this hour of the night. */
export function applyMood(setting, moodId) {
  if (!hasMoods(setting) || !moodId) return setting;
  const mood = moodById(moodId);
  if (mood.id === 'early') return setting;
  return {
    ...setting,
    loosen: setting.loosen + mood.loosen,
    foldEquity: setting.foldEquity * mood.foldEquity,
    notes: [mood.note, ...setting.notes],
  };
}
