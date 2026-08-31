// Worked spots, chosen because the setting changes the answer.

import { parseCards } from './cards.js';

const cards = (text) => parseCards(text);

export const EXAMPLES = [
  {
    name: 'Casino cash: top pair, one recreational player',
    spot: {
      setting: 'casino_cash',
      stage: 'early',
      currency: '$',
      smallBlind: 2,
      bigBlind: 5,
      tableSize: 6,
      hero: { position: 'btn', cards: cards('Ah Kd'), stack: 620 },
      villains: [{ id: 101, position: 'bb', type: 'recreational', stack: 480, role: 'blind', action: 'checked', customRange: '' }],
      board: cards('Ks 8d 3c'),
      pot: 75,
      toCall: 0,
    },
  },
  {
    name: 'Home game: your friend who never folds just bet the river',
    spot: {
      setting: 'home_cash',
      stage: 'early',
      currency: '$',
      smallBlind: 1,
      bigBlind: 2,
      tableSize: 8,
      hero: { position: 'co', cards: cards('Ac Qh'), stack: 240 },
      villains: [{ id: 102, position: 'bb', type: 'abc', stack: 190, role: 'blind', action: 'bet', customRange: '' }],
      board: cards('Qs 9d 4c 7h 2s'),
      pot: 96,
      toCall: 70,
    },
  },
  {
    name: 'Tournament bubble: a call for your whole stack',
    spot: {
      setting: 'casino_tourney',
      stage: 'bubble',
      currency: '$',
      smallBlind: 2000,
      bigBlind: 4000,
      tableSize: 9,
      hero: { position: 'bb', cards: cards('Ah Jd'), stack: 100000 },
      villains: [
        {
          id: 103,
          position: 'co',
          type: 'lag',
          stack: 96000,
          role: 'raised',
          action: 'bet',
          customRange: '22+, A2s+, A8o+, K9s+, KJo+, QTs+, JTs, T9s',
        },
      ],
      board: [],
      pot: 102000,
      toCall: 92000,
    },
  },
  {
    name: 'Home game: flush draw, three ways, nobody folding',
    spot: {
      setting: 'home_cash',
      stage: 'early',
      currency: '$',
      smallBlind: 1,
      bigBlind: 2,
      tableSize: 8,
      hero: { position: 'hj', cards: cards('Th 9h'), stack: 210 },
      villains: [
        { id: 104, position: 'btn', type: 'station', stack: 260, role: 'called', action: 'called', customRange: '' },
        { id: 105, position: 'bb', type: 'tricky', stack: 180, role: 'blind', action: 'bet', customRange: '' },
      ],
      board: cards('Ah 6h 2c'),
      pot: 42,
      toCall: 22,
    },
  },
];
