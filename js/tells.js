// Tells. Live players leak, online players time out, and the person you have
// played with for ten years knows you are watching them.
//
// Every tell that gets shown is stored with the truth behind it, so the
// end-of-hand analysis can tell you whether the drink before the three-bet
// meant what you thought it meant.

// Behaviours that, from an honest player, usually mean a big hand.
const LIVE_STRONG = [
  'takes a long drink before pushing the chips in',
  'goes very still and quiet',
  'starts stacking chips before the action even reaches them',
  'suddenly stops talking mid-story',
  'hands tremble slightly cutting out the bet',
  'leans back and relaxes into the chair',
  'double-checks their cards, then bets without hesitating',
  'glances at their own stack the moment the card lands',
];

// Behaviours that, from an honest player, usually mean weakness or a bluff.
const LIVE_WEAK = [
  'stares you down hard while betting',
  'announces the bet louder than they need to',
  'holds their breath after the chips go in',
  'shrugs and says "one time" while betting',
  'slams the chips in a little too forcefully',
  'starts chatting at you right after betting',
  'counts out the bet slowly, watching for your reaction',
  'sits bolt upright, frozen, after the bet',
];

const ONLINE_STRONG = [
  'snap-acts, no pause at all',
  'tanks nearly the full clock, then puts the bet in',
  'instantly ups the bet slider to a strange, precise number',
];

const ONLINE_WEAK = [
  'pauses, types something in chat, deletes it, then bets',
  'uses the exact same sizing they just showed a bluff with',
  'waits out the clock and bets at the last second',
];

const CALL_STRONG = [
  'calls quickly and quietly, almost bored',
  'calls and immediately starts watching the next card',
];

const CALL_WEAK = [
  'sighs and reluctantly slides the call in',
  'calls, then re-checks their cards',
];

/** How much of what this player's body says is actually true. */
export const TELL_RELIABILITY = {
  nit: 0.85,
  tag: 0.45,
  lag: 0.4,
  station: 0.8,
  maniac: 0.5,
  recreational: 0.8,
  abc: 0.85,
  tricky: 0.25, // knows you, plays you — their tells run backwards more often than not
  unknown: 0.6,
};

/** How often a tell is visible at all, by setting. */
const TELL_FREQUENCY = {
  home_cash: 0.6,
  home_tourney: 0.6,
  casino_cash: 0.45,
  casino_tourney: 0.45,
  online_cash: 0.35,
};

const pick = (pool, rng) => pool[(rng() * pool.length) | 0];

/**
 * Maybe produce a tell for a villain action.
 * @param {object} spec { typeId, settingId, strong, aggressive, rng }
 *   strong: whether their actual hand is strong right now
 *   aggressive: bet/raise (true) or call (false)
 * @returns {null | { text, honest, signalsStrength }}
 *   signalsStrength: what the behaviour would classically mean from an honest player
 */
export function maybeTell({ typeId, settingId, strong, aggressive, rng }) {
  const frequency = (TELL_FREQUENCY[settingId] ?? 0.45) * (aggressive ? 1 : 0.55);
  if (rng() >= frequency) return null;

  const reliability = TELL_RELIABILITY[typeId] ?? 0.6;
  const honest = rng() < reliability;
  // An honest tell reflects the real hand; a dishonest one points the other way.
  const signalsStrength = honest ? strong : !strong;

  const online = settingId === 'online_cash';
  const pool = aggressive
    ? online
      ? signalsStrength ? ONLINE_STRONG : ONLINE_WEAK
      : signalsStrength ? LIVE_STRONG : LIVE_WEAK
    : signalsStrength
      ? CALL_STRONG
      : CALL_WEAK;

  return { text: pick(pool, rng), honest, signalsStrength };
}

/** One line for the analysis: what the tell turned out to mean. */
export function decodeTell(tell, { typeName, hadStrong }) {
  const meant = tell.signalsStrength ? 'strength' : 'weakness';
  const truth = hadStrong ? 'strong' : 'weak';
  const read = tell.honest
    ? `an honest read — they really were ${truth}`
    : `a false signal — they were actually ${truth}`;
  return `“${tell.text}” classically signals ${meant}. From this ${typeName.toLowerCase()}, it was ${read}.`;
}
