// Pure functions only — no Firebase here, so this file is easy to test standalone.

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Builds the full wire pool: blues fixed 1-12×4, yellows 1.1-11.1 and reds 1.5-11.5
// Yellow/red values are decimals to interleave: 1, 1.1, 1.5, 2, 2.1...
// Guess remains group: yellow "yellow", red never guessable.
export function buildDeck({ wireCount = 12, yellowCount = 4, redCount = 2 } = {}) {
  const deck = [];
  // Blues fixed 1-12×4 (ignore wireCount for missions — always 12 per your note)
  const wc = 12;
  for (let value = 1; value <= wc; value++) {
    for (let copy = 0; copy < 4; copy++) {
      deck.push({ type: "blue", value, guessKey: value });
    }
  }
  // Yellows: distinct 1.1-11.1
  const yellowPool = [];
  for (let v = 1; v <= 11; v++) yellowPool.push(v + 0.1);
  const yellows = shuffle(yellowPool).slice(0, Math.max(0, Math.min(11, yellowCount)));
  yellows.forEach((val) => deck.push({ type: "yellow", value: val, guessKey: "yellow" }));
  // Reds: distinct 1.5-11.5
  const redPool = [];
  for (let v = 1; v <= 11; v++) redPool.push(v + 0.5);
  const reds = shuffle(redPool).slice(0, Math.max(0, Math.min(11, redCount)));
  reds.forEach((val) => deck.push({ type: "red", value: val, guessKey: null }));
  return shuffle(deck);
}

// Deals as evenly as possible, then sorts each hand by decimal value
// 1, 1.1, 1.5, 2, 2.1... — interleaves blue/yellow/red as in the box
// Captain gets all remainder when not divisible (per your note)
export function dealHands(deck, playerIds, captainId = null) {
  const hands = {};
  const orderedIds = captainId && playerIds.includes(captainId)
    ? [captainId, ...playerIds.filter((id) => id !== captainId)]
    : [...playerIds];
  orderedIds.forEach((id) => (hands[id] = []));
  // Round-robin first
  deck.forEach((wire, i) => {
    hands[orderedIds[i % orderedIds.length]].push({ ...wire, cut: false });
  });
  // Move all remainder extra (beyond floor) to captain only
  const remainder = deck.length % orderedIds.length;
  if (captainId && orderedIds.includes(captainId) && remainder > 0) {
    // Collect indices that got the extra due to round-robin distribution (first `remainder` in orderedIds)
    const extraRecipients = orderedIds.slice(1, remainder);
    extraRecipients.forEach((pid) => {
      const wire = hands[pid].pop();
      if (wire) hands[captainId].push(wire);
    });
  }
  // Restore mapping to original playerIds order for return, but keep captain extra
  const result = {};
  playerIds.forEach((id) => (result[id] = hands[id] || []));
  // Ensure captain's extra is in result
  if (captainId && !playerIds.includes(captainId)) result[captainId] = hands[captainId];
  Object.keys(result).forEach((id) => {
    result[id].sort((a, b) => (a.value || 0) - (b.value || 0));
  });
  return result;
}

export const MISSIONS = [
  {
    id: 1,
    name: "First Yellow",
    desc: "Blues 1–12, Yellows 2 (2.1, 7.1), Reds 0 — learn YELLOW as group & tracker.",
    wireCount: 12,
    yellowCount: 2,
    redCount: 0,
    detonatorMax: 4,
  },
  {
    id: 2,
    name: "Live Red",
    desc: "Blues 1–12, Yellows 3 (1.1, 5.1, 9.1), Reds 1 (6.5) — red is instant loss if guessed, plus Y interleaving.",
    wireCount: 12,
    yellowCount: 3,
    redCount: 1,
    detonatorMax: 4,
  },
];

export function cutCountForKey(cutLog, key) {
  return Object.values(cutLog || {}).filter((c) => String(c.guessKey) === String(key) && c.result === "cut").length;
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
