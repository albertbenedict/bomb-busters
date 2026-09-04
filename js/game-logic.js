// Pure functions only — no Firebase here, so this file is easy to test standalone.

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Builds the full wire pool: blue numbered wires (4 of each 1..wireCount),
// yellow wires (order-only, no number — guessed as "yellow"), and red wires
// (never duo-guessable — only cleared via the "reveal red wires" action).
export function buildDeck({ wireCount = 12, yellowCount = 4, redCount = 2 } = {}) {
  const deck = [];
  for (let value = 1; value <= wireCount; value++) {
    for (let copy = 0; copy < 4; copy++) {
      deck.push({ type: "blue", value, guessKey: value });
    }
  }
  for (let i = 0; i < yellowCount; i++) {
    deck.push({ type: "yellow", value: null, guessKey: "yellow" });
  }
  for (let i = 0; i < redCount; i++) {
    deck.push({ type: "red", value: null, guessKey: null });
  }
  return shuffle(deck);
}

// Deals as evenly as possible, then sorts each hand: blues ascending first
// (mirrors physically sorting your tile stand left to right), yellows next,
// reds last. Blue order matters for guessing; yellow/red are fungible within
// their own type, so their exact position doesn't leak extra information.
export function dealHands(deck, playerIds) {
  const hands = {};
  playerIds.forEach((id) => (hands[id] = []));
  deck.forEach((wire, i) => {
    hands[playerIds[i % playerIds.length]].push({ ...wire, cut: false });
  });
  const typeOrder = { blue: 0, yellow: 1, red: 2 };
  playerIds.forEach((id) => {
    hands[id].sort((a, b) => {
      if (typeOrder[a.type] !== typeOrder[b.type]) return typeOrder[a.type] - typeOrder[b.type];
      return (a.value || 0) - (b.value || 0);
    });
  });
  return hands;
}

export function cutCountForKey(cutLog, key) {
  return Object.values(cutLog || {}).filter((c) => c.guessKey === key).length;
}

// How many total copies of each guessable key exist in this game — every
// blue value always has 4, yellow's total is whatever the host configured.
// Red has no entry here; it's tracked separately via canRevealRedWires.
export function getKeyTotals(config) {
  const totals = {};
  const wireCount = Math.max(1, Math.min(12, Number(config?.wireCount) || 12));
  const yellowCount = Math.max(0, Math.min(6, Number(config?.yellowCount) || 0));
  for (let v = 1; v <= wireCount; v++) totals[v] = 4;
  if (yellowCount > 0) totals.yellow = yellowCount;
  return totals;
}

// Returns a guessKey (a number, or "yellow") the active player can
// solo-cut, or null. Eligible when every remaining copy of that key is
// sitting in their own uncut hand — only needs their own hand + public
// data, so it's always safe to compute on the client.
export function getSoloCutEligibleKey(hand, cutLog, config) {
  if (!hand || !config) return null;
  const totals = getKeyTotals(config);
  const counts = {};
  hand.forEach((wire) => {
    if (!wire.cut && wire.guessKey != null) {
      counts[wire.guessKey] = (counts[wire.guessKey] || 0) + 1;
    }
  });
  for (const rawKey of Object.keys(counts)) {
    const key = rawKey === "yellow" ? "yellow" : Number(rawKey);
    const total = totals[key] ?? 4;
    const remaining = total - cutCountForKey(cutLog, key);
    if (remaining === counts[rawKey]) return key;
  }
  return null;
}

// True once every remaining wire in hand is red — the only condition
// under which red wires clear, all at once, with no guessing involved.
export function canRevealRedWires(hand) {
  const remaining = hand.filter((w) => !w.cut);
  return remaining.length > 0 && remaining.every((w) => w.type === "red");
}

export function isHandFullyCut(hand) {
  return hand.every((wire) => wire.cut);
}

// Equipment — v1, single effect "Defuse one mistake"
export function generateEquipment(count, wireCount) {
  const n = Math.max(0, Math.min(5, Math.round(Number(count) || 0)));
  const w = Math.max(1, Math.min(12, Math.round(Number(wireCount) || 12)));
  const equipment = {};
  if (n === 0) return equipment;
  let values = [];
  if (w >= n) {
    // Pick n distinct blue values
    const pool = [];
    for (let v = 1; v <= w; v++) pool.push(v);
    values = shuffle(pool).slice(0, n);
  } else {
    // Rare edge: small custom pool (e.g. wireCount=2, players=5) — allow repeats
    for (let i = 0; i < n; i++) values.push(1 + Math.floor(Math.random() * w));
  }
  values.forEach((val) => {
    const id = "eq_" + Math.random().toString(36).slice(2, 8);
    equipment[id] = { unlockValue: val, unlocked: false, used: false };
  });
  return equipment;
}

export function getUsableEquipment(equipment, cutLog) {
  const eq = equipment || {};
  return Object.entries(eq)
    .filter(([, e]) => !e.used && cutCountForKey(cutLog, e.unlockValue) >= 2)
    .map(([id, e]) => ({ id, ...e }));
}

// Hints — factual blue-only, one per player, strict turnOrder
export function isBlueHintValid(hand, position, wireCount) {
  if (!hand || position == null || position < 0 || position >= hand.length) return false;
  const w = hand[position];
  if (!w || w.cut) return false;
  if (w.type !== "blue") return false; // yellow/red never hintable
  const wc = Math.max(1, Math.min(12, Number(wireCount) || 12));
  if (typeof w.value !== "number" || w.value < 1 || w.value > wc) return false;
  return true;
}

export function canGiveHint(hints, playerId) {
  return !(hints && hints[playerId]);
}

export function isHintPhaseComplete(hints, playerCount) {
  return hints && Object.keys(hints).length >= playerCount;
}
