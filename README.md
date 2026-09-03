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

**Stubbed / MVP-only (see the scope list from our chat):**
- No yellow or red wires yet — blue wires (1–N) only
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
npm run serve          # npx serve -l tcp://0.0.0.0:3000 --cors  (phone: http://<PC-IP>:3000)
# or
npm run serve:lan      # http-server variant
```

For LAN phones, use the printed `Network` address (e.g. `http://192.168.1.3:3000`), not `localhost`. If Windows Firewall blocks, allow `Node.js` / `Code` or run `tailscale funnel 3000` and use `https://<tailnet>.ts.net`.

## Firebase rules

Test-mode rules (`now < ...`) expire after 30 days. This repo ships `database.rules.json` with **no expiry** and basic validation (status/config/players). Deploy it:

```
# via Firebase CLI (once)
npm i -g firebase-tools && firebase login
firebase use bomb-busters-744e5
firebase deploy --only database
```

Or paste the file contents into Firebase Console → Realtime Database → Rules.

## Reliability notes

- **Reconnect:** Joining with the same `room code + name` (case-insensitive) reuses your old `playerId` and hand instead of orphaning it. Player pages also restore from `localStorage` on refresh.
- **Turn skip:** `nextTurn()` skips players whose hand is already fully cut.
- **Host controls:** Table screen has Kick per-player and Reset game (back to lobby, keeps players).

