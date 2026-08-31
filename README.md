# Runout

A No-Limit Texas Hold'em study tool that starts a hand where a real hand starts: **the setting, the stacks,
and the people you are actually up against** — not a chart that assumes everyone at the table plays the same
way.

The idea it is built on: the same hand on the same board is a different decision in a home game against
friends who never fold to you, against strangers in a casino, and on a tournament bubble where busting costs
more than the pot is worth. Runout takes that as its input rather than its footnote.

**Live site:** https://spb9876-cmd.github.io/pokerrunout/

Pages needs switching on once, by someone with admin rights on the repository: **Settings → Pages → Build
and deployment → Source: GitHub Actions**. (A workflow cannot do this for itself — creating a Pages site
needs admin permission that `GITHUB_TOKEN` does not carry.) After that, every push to the default branch
runs the tests and publishes the site if they pass.

## What it does

Two modes.

### Play hands

Set the table once — where the game is, the blinds, your stack, and one line about each opponent — then it
deals hand after hand until you reset. Positions rotate. Opponents act on their own cards the way their
player type would: the nit folds, the maniac raises, the station calls. Tells show up in the table talk
(*"takes a long drink before pushing the chips in"*) — and whether they mean anything depends on who they
came from: the straightforward friend's body tells the truth about 85% of the time, the tricky regular you
know runs backwards more often than not.

After every hand the coach goes back through each decision you made, re-reads the spot knowing only what you
could have known, and grades it — right, close, or a leak, with the numbers ("14.3% equity needing 40.0% —
about $1.28 lit on fire per time"). Then it opens everything: every hand at the table, and which of the
tells were honest. The session keeps score: net result and decision quality, separately, because they are
not the same thing.

### Read a spot

You build a spot — where you are playing, your seat and stack, your two cards, the board, the pot, and one
line about each opponent (what kind of player they are, what they did) — and it gives you:

- **Your real equity**, simulated against the ranges those specific players actually turn up with here,
  with a confidence margin. Exact enumeration when every holding is known.
- **The price you are being offered**: pot odds, the equity you need, the EV of calling, and on a
  tournament the extra you need on top because survival is worth something.
- **A decision with its reasoning spelled out** — fold, call, raise, bet or check, with a size, and every
  step of the arithmetic stated so you can disagree with it on purpose.
- **What each opponent's range has narrowed to** after the action, how much of their betting range is air,
  and the exploit that comes from who they are.
- **Run it out** — deal the rest of the hand once and watch your equity move street by street.

Spots are saved in your browser, and **Copy link** puts the whole spot in the URL so you can send a hand to
someone and argue about it.

## How the model works

Nothing here is a solver, and it does not pretend to be one. It is a chain of stated assumptions:

1. **Preflop range** — each archetype has tendencies (how often they open from each position, call a raise,
   three-bet, limp). The setting widens or tightens the pool on top of that. A calling range is capped,
   because the top of a range would have raised instead.
2. **Board narrowing** — every combo in that range is scored on the actual board, made hands and draws
   together, and the range is cut to the share that continues given how often that player folds to a bet
   of that size. A bet keeps a value slice from the top and a bluff slice from the bottom, in the ratio
   that player bluffs. Betting ranges tighten street by street.
3. **A check only caps a range when that player was the one expected to bet.** The blind checking to the
   preflop raiser is checking their whole range and telling you nothing.
4. **Equity** — Monte Carlo against those ranges, 20,000 runouts, with card removal handled properly.
5. **The decision** — pot odds against equity, fold equity against the break-even bluff frequency, implied
   odds weighed against what is actually behind, and an ICM-style risk premium in tournaments that scales
   with how much of your stack is at risk.

The hand rankings in `js/data/preflop.js` are generated, not typed from a chart: each of the 169 starting
hands is measured against a random hand *and* against a strong range, then adjusted for playability. That
two-sided measurement is what keeps TT from sorting above AKs, which is what raw all-in equity does on its
own.

### Player types

Nit · Tight-aggressive reg · Loose-aggressive reg · Calling station · Maniac · Recreational ·
Straightforward friend · Tricky regular you know · Unknown

### Settings

Home game with friends · Casino cash game · Online cash game · Home tournament · Casino tournament
(with early / middle / bubble / in-the-money / final table stages)

Any range can be overridden by hand with standard notation: `88+, ATs+, KQs`, `77-44`, `T9s-65s`,
`AKo:0.5`, or just `15%`.

## Running it locally

No build step and no dependencies — it is ES modules served as static files.

```bash
git clone https://github.com/spb9876-cmd/pokerrunout.git
cd pokerrunout
npm run serve          # http://localhost:8080
```

It has to be served over HTTP rather than opened as a `file://` path, because ES modules need it.

```bash
npm test               # the whole suite
npm run gen            # regenerate the preflop hand data
```

## Tests

The math is checked rather than trusted:

- the hand evaluator is verified against the exhaustive distribution of all 2,598,960 five-card hands
- the Monte Carlo sampler is checked against exact board enumeration, and against published all-in equities
- range notation, board reading, and the range-building rules each have their own tests
- the dealer is swept over hundreds of scripted hands: chips are conserved at every step, side pots pay out
  exactly what went in, folded players never win, positions rotate, and a maniac provably raises more than
  a nit

## Layout

```
index.html            the page
assets/styles.css     styles
js/cards.js           card primitives, hand codes, combos
js/evaluator.js       7-card hand evaluator
js/equity.js          Monte Carlo equity, exact enumeration
js/ranges.js          range notation
js/handstrength.js    what a holding is on a board, draws included
js/players.js         archetypes, settings, positions, tournament stages
js/engine.js          range building, narrowing, and the decision
js/game.js            the dealer: betting rounds, side pots, villain AI, rotation
js/tells.js           the tell library and who can be believed
js/coach.js           post-hand grading and tell decoding
js/play.js            play mode UI
js/analyzer.js        spot analyzer UI
js/examples.js        worked spots
js/main.js            entry point and mode switch
js/data/preflop.js    generated hand rankings
tools/gen-preflop.mjs the generator
test/                 the suite
```

## Honest limits

- Ranges are models of tendencies. They are a starting point for a read, not a read.
- In play mode, stacks reset between hands and antes are not dealt; the session score is the memory.
- Equity is simulated, so it carries a margin — shown next to every number.
- The decision looks one street ahead, not to the end of the hand. It does not solve a game tree, and it
  does not balance your own range for you.
- The tournament risk premium is a simplification of ICM, scaled by how much of your stack is at risk. It
  is directionally right, not a payout-model calculation.

A study tool. Do not use it at a table where that is against the rules.
