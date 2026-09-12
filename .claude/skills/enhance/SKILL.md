---
name: enhance
description: Digest a messy prompt into a fixed six-slot spec, execute from the spec in the same turn with no clarifying questions, and report with the assumptions listed for one-shot correction. Use when the user types /enhance in front of a prompt, or asks to tighten a prompt.
---

# Enhance

Take the prompt after `/enhance` — as messy as it comes — and run it through
one turn with no questions back to the user.

## 1. Digest the prompt into a six-slot spec

Exactly these slots, always in this order:

- **Goal** — what the user is actually after, one line.
- **Deliverable** — the concrete artifact this turn produces.
- **Must** — only facts the user actually stated, kept verbatim. Nothing
  inferred, nothing invented, nothing "obviously implied" ever enters this
  list.
- **Assumptions** — every gap that would normally trigger a clarifying
  question becomes a line here with a chosen default instead. Check the
  codebase before assuming: if the repo already answers the question (a thing
  already exists, a convention is already set), record that finding as the
  assumption rather than guessing.
- **Out of scope** — what this turn deliberately does not touch.
- **Done when** — a check that can actually be run, not a feeling. For code
  changes in this repo the floor is `npm test` green; name anything stricter
  the prompt implies.

The spec must not be longer than the prompt it digests. For a short prompt
that means a short spec — empty slots are written as "—", not padded.

## 2. Execute from the spec

Work only from the spec, reading only the files the spec names (plus what
they directly require). Do the work, then verify the **Done when** check by
running it, not by asserting it.

## 3. Report in three parts

1. **Delivered** — what exists now that did not before.
2. **Assumptions** — the list from the spec, so any wrong default can be
   corrected with a single follow-up message.
3. **Check** — the Done-when result, quoted from the actual run.

## Limits

- This skill fires only when the user types `/enhance` before a prompt or
  asks to tighten one. It cannot apply itself to plain messages; automatic
  rewriting of every message would need a hook in settings and would cost an
  extra model call per message.
- No clarifying questions, ever — that is what the Assumptions slot is for.
