# Bomb Busters — MVP scaffold

Digital companion for the board game: one device is the **table** (public board
state), everyone else's device is their **hand** (private wires only they can
see). Still played in the same room — this just replaces the physical tile
stands and the "wait, who has the 9" bookkeeping.

## What's real vs. stubbed

**Working end-to-end (once Firebase is connected):**
- Host a session (sets wire count + detonator limit) → get a 4-letter room code
- Join a session by code from a player device
- Table starts the game → shuffles and deals wires evenly, sorted per hand
- Duo cut: guesser picks a target + position + value, target's own device
  resolves it (only that device legitimately knows the real value), writes
  the outcome, guesser's device reacts and advances the turn
- Solo cut: computed entirely client-side from your own hand + the public
  cut log — no round trip needed
- Detonator, cut log, info tokens, validation tokens, win/loss detection
- Yellow wires (host-configurable, kept even — 2–6): guessable via duo cut
  same as a number, just as the "Yellow" option; solo-cuttable the same way
  once you hold every remaining one
- Red wires (host-configurable, 1–3): never duo-guessable — cleared only via
  "Reveal red wires," which appears once 100% of your remaining hand is red.
  Always safe by definition, no risk involved

**Stubbed / MVP-only (see the scope list from our chat):**
- No Equipment cards or Character abilities
- No real mission data — wire count + detonator limit are just numbers you
  set when hosting, not one of the 66 official missions
- `firebase-config.js` has placeholder values — nothing will actually run
  until that's filled in with a real project

## Structure

```
index.html      landing — host or join
table.html      table device screen
player.html     player device screen
css/style.css   shared styles
js/
  firebase-config.js   Firebase init (placeholder — fill in later)
  session.js           create/join a session
  game-logic.js         pure functions: deck, dealing, solo-cut eligibility
  table.js              table screen logic
  player.js              player screen logic + the guess-resolution flow
  theme.js               dark mode toggle
```

## A known simplification worth knowing about

There's no server-side validation step (no Cloud Function). The guess check
happens on the *target's own device*, which is fine because a player is
already allowed to know their own hand — nothing secret ever needs to leave
a device that isn't supposed to have it. The trade-off: nothing stops a
deliberately modified client from writing a fake outcome to the database.
For a co-op game played with people in the same room, that's not a real risk,
so this keeps the whole thing running on Firebase's free tier with no
backend to deploy. If that ever stops being true, the fix later is a Cloud
Function that owns the write.

## Running it locally

ES modules need an actual server (not `file://`) — from this folder:

```
npx serve .
```

Then open the printed localhost URL. Nothing will work yet until
`js/firebase-config.js` has a real project's config — that's next.
