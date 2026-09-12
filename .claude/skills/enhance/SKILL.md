---
name: enhance
description: Deepen and polish an existing feature of Runout without changing what it is. The counterpart to /10xthis — same shape, higher quality. Use when the user invokes /enhance on a feature, screen, or area of the app (or with no target, to find and lift the weakest one).
---

# Enhance

Take the feature the user pointed at and make the version that already exists
noticeably better: smarter where it thinks, clearer where it speaks, smoother
where it is touched. This is not a rebuild and not a re-imagining — the feature
keeps its shape and its place in the app. If the request is really a bigger
thing wearing a small name, say so and offer /10xthis instead.

If no target is given, play the app and read the code until the weakest
user-facing area declares itself, name it, and enhance that.

## How to do it

1. **Use it before you touch it.** Run the real thing the way a player would —
   deal hands through it, read the transcripts and coach output it produces,
   drive it in the browser (Chromium is preinstalled; `js/play.js` renders
   everything). Write down what is rough, wrong-feeling, or flat *as
   experienced*, not as imagined from the code.
2. **Sort the list into the three layers.** Every enhancement here lands in one
   of: the **math/model** (engine, ranges, dealer behavior — does it decide
   right?), the **words** (coach verdicts, table talk, labels — does it teach
   and read like a person?), or the **feel** (pacing, layout, taps and
   scrolling — does it get out of the way?). Fix in that order; better words on
   a wrong number is lipstick.
3. **Measure, don't vibe.** This repo's standard holds: a behavioral claim gets
   a simulation over hundreds of hands, a payout or equity claim gets an
   independent recomputation, a "feels too frequent/rare" claim gets a measured
   rate before and after. Tune to numbers you printed, not to impressions.
4. **Pin it with tests.** Each fix gets a regression test in `test/` that fails
   on the old behavior. `npm test` green before every push; statistical tests
   use fixed seeds.
5. **Ship and verify.** Commit with a message that says what got better and
   why, push to the working branch, and confirm the Pages deploy succeeded via
   the Actions API (the sandbox cannot fetch the live site directly).

## Rules

- The feature's scope does not grow. New capabilities are a different request;
  park them in one line at the end if they came up.
- Keep every existing test passing — an enhancement that breaks the dealer's
  chip conservation or the coach's grading invariants is a regression with
  good intentions.
- Player-facing text follows the house voice: plain language, second person,
  the arithmetic said out loud, no jargon left undefined.
- Never make the game about real money. Enhancements to stakes, careers, or
  payouts stay play-money.
- Three sharp improvements shipped beat ten noted. Depth over coverage.
