// Pure functions only — no Firebase here, so this file is easy to test standalone.

export function buildDeck(wireCount = 12) {
  const deck = [];
  for (let value = 1; value <= wireCount; value++) {
    for (let copy = 0; copy < 4; copy++) deck.push(value);
  }
  return shuffle(deck);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Deals as evenly as possible, then sorts each hand ascending —
// mirrors physically sorting your tile stand left to right.
export function dealHands(deck, playerIds) {
  const hands = {};
  playerIds.forEach((id) => (hands[id] = []));
  deck.forEach((value, i) => {
    hands[playerIds[i % playerIds.length]].push({ value, cut: false });
  });
  playerIds.forEach((id) => hands[id].sort((a, b) => a.value - b.value));
  return hands;
}

export function cutCountForValue(cutLog, value) {
  return Object.values(cutLog || {}).filter((c) => c.value === value).length;
}

// Returns a value the active player is allowed to solo-cut, or null.
// Eligible when every remaining copy of that value (4 total, minus
// however many are already in the public cut log) is sitting in their
// own uncut hand — this only needs their own hand + public data, so
// it's always safe to compute on the client.
export function getSoloCutEligibleValue(hand, cutLog) {
  const counts = {};
  hand.forEach((wire) => {
    if (!wire.cut) counts[wire.value] = (counts[wire.value] || 0) + 1;
  });
  for (const [value, count] of Object.entries(counts)) {
    const remaining = 4 - cutCountForValue(cutLog, Number(value));
    if (remaining === count) return Number(value);
  }
  return null;
}

export function isHandFullyCut(hand) {
  return hand.every((wire) => wire.cut);
}
