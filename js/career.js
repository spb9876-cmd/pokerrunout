// Career mode. The bankroll is the score: start at the kitchen table, win your
// way up the ladder, and if you go broke you are back where you started —
// minus some pride. Every venue is a real table with recurring characters, so
// moving up means leaving people you had figured out for people you have not.

export const VENUES = [
  {
    id: 'kitchen',
    name: 'The Kitchen Table',
    tagline: 'Quarters and beer caps with people who love you',
    unlock: 0,
    buyin: 50,
    config: {
      setting: 'home_cash',
      stage: 'early',
      currency: '$',
      smallBlind: 0.5,
      bigBlind: 1,
      mood: 'early',
      villains: [
        { name: 'Uncle Ray', type: 'station', stack: 50 },
        { name: 'Sam', type: 'abc', stack: 50 },
        { name: 'Priya', type: 'recreational', stack: 50 },
      ],
    },
    lineupNote: 'Uncle Ray has not folded since 2019. Sam bets when Sam has it. Priya is here for the snacks and the gossip.',
  },
  {
    id: 'garage',
    name: 'Garage Night',
    tagline: 'The Friday game where the blinds finally mean something',
    unlock: 300,
    buyin: 100,
    config: {
      setting: 'home_cash',
      stage: 'early',
      currency: '$',
      smallBlind: 1,
      bigBlind: 2,
      mood: 'swing',
      villains: [
        { name: 'Dave', type: 'tricky', stack: 100 },
        { name: 'Marcus', type: 'lag', stack: 100 },
        { name: 'Jenny', type: 'nit', stack: 100 },
        { name: 'Big Tony', type: 'station', stack: 100 },
      ],
    },
    lineupNote: 'Dave has history with you and plays it. Marcus raises light. Jenny is a vault. Big Tony calls — that is the whole read.',
  },
  {
    id: 'casino12',
    name: 'Casino $1/$2',
    tagline: 'Strangers, cocktails, and a rake — welcome to the pool',
    unlock: 600,
    buyin: 200,
    config: {
      setting: 'casino_cash',
      stage: 'early',
      currency: '$',
      smallBlind: 1,
      bigBlind: 2,
      villains: [
        { name: 'Vic', type: 'tag', stack: 200 },
        { name: 'The Tourist', type: 'recreational', stack: 200 },
        { name: 'Earl', type: 'station', stack: 300 },
        { name: 'Headphones Kid', type: 'lag', stack: 200 },
        { name: 'Doris', type: 'nit', stack: 150 },
      ],
    },
    lineupNote: 'Vic grinds this table daily. The Tourist is on vacation from folding. Earl calls to the river on principle. The kid three-bets more than he breathes. Doris waits.',
  },
  {
    id: 'online',
    name: 'The Online Grind',
    tagline: 'Screen names, timing tells, and no faces to read',
    unlock: 1000,
    buyin: 100,
    config: {
      setting: 'online_cash',
      stage: 'early',
      currency: '$',
      smallBlind: 0.5,
      bigBlind: 1,
      freshTable: true,
      villains: [
        { name: 'xX_r1verG0d_Xx', type: 'unknown', stack: 100 },
        { name: 'FoldEquityFan', type: 'unknown', stack: 100 },
        { name: 'chip_sandwich', type: 'unknown', stack: 100 },
        { name: 'AA_every_hand', type: 'unknown', stack: 100 },
        { name: 'quietgrinder', type: 'unknown', stack: 100 },
      ],
    },
    lineupNote: 'Nobody here has a face. Their real styles are hidden — you build the read from what they do, hand by hand.',
  },
  {
    id: 'casino25',
    name: 'Casino $2/$5',
    tagline: 'The table where the regulars know each other by name',
    unlock: 1500,
    buyin: 500,
    config: {
      setting: 'casino_cash',
      stage: 'early',
      currency: '$',
      smallBlind: 2,
      bigBlind: 5,
      villains: [
        { name: 'Sonny', type: 'tag', stack: 500 },
        { name: 'The Doctor', type: 'tricky', stack: 500 },
        { name: 'Lena', type: 'lag', stack: 700 },
        { name: 'Whale Watch', type: 'recreational', stack: 500 },
      ],
    },
    lineupNote: 'Sonny and Lena are pros. The Doctor traps for a living. The one they call Whale Watch is why everyone else is here.',
  },
  {
    id: 'biggame',
    name: 'The Big Game',
    tagline: 'Deep stacks, deep night, and everyone is stuck',
    unlock: 3000,
    buyin: 1000,
    config: {
      setting: 'home_cash',
      stage: 'early',
      currency: '$',
      smallBlind: 5,
      bigBlind: 10,
      mood: 'late',
      villains: [
        { name: 'Ivan', type: 'maniac', stack: 1500 },
        { name: 'The Judge', type: 'tricky', stack: 1000 },
        { name: 'Cal', type: 'lag', stack: 1000 },
        { name: 'Moneybags', type: 'station', stack: 2000 },
      ],
    },
    lineupNote: 'Ivan raises dark. The Judge never shows a hand he did not want you to see. It is two in the morning and nobody is leaving until they are even.',
  },
];

export const venueById = (id) => VENUES.find((v) => v.id === id) ?? VENUES[0];

export function newCareer() {
  return {
    version: 1,
    bankroll: VENUES[0].buyin * 2, // $100 and a dream
    stakes: 0, // times your buddy had to bail you out
    handsPlayed: 0,
    peak: VENUES[0].buyin * 2,
    history: [], // { venue, hands, net }
  };
}

export const unlocked = (career, venue) => career.bankroll >= venue.unlock;
export const canAfford = (career, venue) => career.bankroll >= venue.buyin;

/** The session config for sitting down at a venue, hero staked to its buy-in. */
export function sitDownConfig(venue) {
  return structuredClone({ ...venue.config, heroStack: venue.buyin });
}

/**
 * Settle a finished (or abandoned) session back into the career:
 * everything bought in comes out of the roll, the final stack goes back in.
 */
export function settle(career, venue, session) {
  const spent = session.invested[0];
  const returned = session.stacks[0];
  const net = returned - spent;
  career.bankroll = Math.round((career.bankroll - spent + returned) * 100) / 100;
  career.handsPlayed += session.handsPlayed;
  career.peak = Math.max(career.peak, career.bankroll);
  career.history.push({ venue: venue.id, hands: session.handsPlayed, net: Math.round(net * 100) / 100 });

  // Fully felted: your buddy stakes you back to the kitchen table.
  let staked = false;
  if (career.bankroll < VENUES[0].buyin) {
    career.bankroll = VENUES[0].buyin;
    career.stakes += 1;
    staked = true;
  }
  return { net, staked };
}

/**
 * Can the hero take another bullet at this venue mid-session?
 * Cash outside the table = bankroll minus everything already bought in.
 */
export function canRebuy(career, venue, session) {
  return career.bankroll - session.invested[0] >= venue.buyin;
}

const STORE_KEY = 'runout.career.v1';

export function loadCareer() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.version === 1) return parsed;
    }
  } catch {
    /* fresh career */
  }
  return null;
}

export function saveCareer(career) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(career));
  } catch {
    /* fine */
  }
}

export function resetCareer() {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* fine */
  }
}
