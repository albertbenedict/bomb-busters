
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const WIRE_VALUES = Array.from({ length: 12 }, (_, i) => i + 1);

export const EQUIPMENT_UNLOCK_CUTS = 4;

export function buildDeck({ yellowCount = 4, redCount = 2 } = {}) {
  const deck = [];
  for (const value of WIRE_VALUES) {
    for (let copy = 0; copy < 4; copy++) {
      deck.push({ type: "blue", value, guessKey: value });
    }
  }
  const yellowPool = [];
  for (let v = 1; v <= 11; v++) yellowPool.push(v + 0.1);
  const yellows = shuffle(yellowPool).slice(0, Math.max(0, Math.min(6, yellowCount)));
  yellows.forEach((val) => deck.push({ type: "yellow", value: val, guessKey: "yellow" }));
  const redPool = [];
  for (let v = 1; v <= 11; v++) redPool.push(v + 0.5);
  const reds = shuffle(redPool).slice(0, Math.max(0, Math.min(11, redCount)));
  reds.forEach((val) => deck.push({ type: "red", value: val, guessKey: null }));
  return shuffle(deck);
}

export function dealHands(deck, playerIds) {
  const hands = {};
  playerIds.forEach((id) => (hands[id] = []));
  deck.forEach((wire, i) => {
    hands[playerIds[i % playerIds.length]].push({ ...wire, cut: false });
  });
  Object.values(hands).forEach((hand) => {
    hand.sort((a, b) => (a.value || 0) - (b.value || 0));
  });
  return hands;
}

export function getDetonatorMax(playerCount) {
  return Math.max(1, Math.min(6, Math.round(Number(playerCount) || 4)));
}

export const MISSIONS = [
  {
    id: 1,
    name: "First Call",
    desc: "2 yellow, 1 red, hints on. The intro mission — just enough yellow to learn the group-guess, one red to respect.",
    longDesc: "Learn the ropes. Two yellow wires hide in the line — guess “Yellow” to cut any of them. One red wire is lurking: hit it and the bomb detonates on the spot. Use your opening blue hint to anchor a number the whole team can build around.",
    yellowCount: 2,
    redCount: 1,
    hintsEnabled: true,
  },
  {
    id: 2,
    name: "Yellow Alert",
    desc: "4 yellow, 1 red, hints on. More yellows in the line means more positions to track — deduction starts to matter.",
    longDesc: "The line gets crowded. Four yellow wires are scattered through the rack now, so the gaps between blue numbers are packed with unknowns. Your opening hints still give you a foothold, but you’ll need to track which yellows have been found and which gaps are still live. Start reading positions, not just values.",
    yellowCount: 4,
    redCount: 1,
    hintsEnabled: true,
  },
  {
    id: 3,
    name: "Wire and Fire",
    desc: "4 yellow, 2 red, hints on. A second red wire in play — one wrong guess in the wrong place now ends it.",
    longDesc: "Two reds. No room for error. The rack is dense with four yellows and two reds hiding between the blues making every guess riskier now. Use the tracker and hints to separate safe wires from dangerous ones before you commit. One wrong red guess ends the mission instantly.",
    yellowCount: 4,
    redCount: 2,
    hintsEnabled: true,
  },
  {
    id: 4,
    name: "Steady Hands",
    desc: "6 yellow, 2 red, hints off. Maximum yellow, and the team's one free clue is gone — everything now comes from cuts and wrong-guess reveals.",
    longDesc: "No free intel. Six yellows and two reds, but this time you start in the dark with no opening hints. Every scrap of information comes from successful cuts and the tokens left behind by wrong guesses. Equipment unlocks after four cuts of a value.",
    yellowCount: 6,
    redCount: 2,
    hintsEnabled: false,
  },
  {
    id: 5,
    name: "No Second Chances",
    desc: "6 yellow, 3 red, hints off. The hardest config this system supports with max yellow, max red, and no starting information at all.",
    longDesc: "Maximum threat. Six yellows, three reds, and zero starting hints as every wire is a gamble. Solo-cut when you hold the last of a value, and use equipment hints to peel back a single wire’s colour before you guess. One mistake on red and it’s over — steady hands, clear calls.",
    yellowCount: 6,
    redCount: 3,
    hintsEnabled: false,
  },
];

export function cutCountForKey(cutLog, key) {
  return Object.values(cutLog || {}).filter((c) => String(c.guessKey) === String(key) && c.result === "cut").length;
}

export function getKeyTotals(config) {
  const totals = {};
  const yellowCount = Math.max(0, Math.min(6, Number(config?.yellowCount) || 0));
  for (const v of WIRE_VALUES) totals[v] = 4;
  if (yellowCount > 0) totals.yellow = yellowCount;
  return totals;
}

export function getAllSoloCutEligibleKeys(hand, allHands, config) {
  if (!hand || !allHands || !config) return [];
  const out = [];
  const flat = Object.values(allHands).flatMap((h) => (Array.isArray(h) ? h : []));

  for (const key of WIRE_VALUES) {
    const myRemaining = hand.filter(
      (wire) => !wire.cut && wire.type === "blue" && wire.guessKey === key
    ).length;
    if (myRemaining === 0) continue;
    if (myRemaining !== 2 && myRemaining !== 4) continue;
    const totalRemaining = flat.filter(
      (wire) => !wire.cut && wire.type === "blue" && wire.guessKey === key
    ).length;
    if (myRemaining === totalRemaining) out.push(key);
  }

  const myYellow = hand.filter((wire) => !wire.cut && wire.guessKey === "yellow").length;
  if (myYellow > 0) {
    const totalYellow = flat.filter((wire) => !wire.cut && wire.guessKey === "yellow").length;
    if (myYellow === totalYellow) out.push("yellow");
  }
  return out;
}

export function canRevealRedWires(hand) {
  const remaining = hand.filter((w) => !w.cut);
  return remaining.length > 0 && remaining.every((w) => w.type === "red");
}

export function isHandFullyCut(hand) {
  return hand.every((wire) => wire.cut);
}

export function getNextTurn(currentPlayerId, turnOrder, hands) {
  if (!turnOrder?.length) return currentPlayerId;
  const startIdx = turnOrder.indexOf(currentPlayerId);
  if (startIdx === -1) return turnOrder[0];
  for (let step = 1; step <= turnOrder.length; step++) {
    const nextId = turnOrder[(startIdx + step) % turnOrder.length];
    const hand = hands?.[nextId];
    if (hand && !isHandFullyCut(hand)) return nextId;
  }
  return turnOrder[(startIdx + 1) % turnOrder.length];
}

export function isGameWon(hands) {
  const allHands = Object.values(hands || {});
  const hasNonRed = allHands.some((hand) => hand?.some((wire) => wire.type !== "red"));
  if (!hasNonRed) return false;
  return allHands.every((hand) => {
    const remaining = hand?.filter((wire) => !wire.cut) || [];
    return remaining.length === 0 || remaining.every((wire) => wire.type === "red");
  });
}

export function generateEquipment(count) {
  const n = Math.max(0, Math.min(5, Math.round(Number(count) || 0)));
  const equipment = {};
  if (n === 0) return equipment;
  const values = shuffle([...WIRE_VALUES]).slice(0, n);
  values.forEach((val) => {
    const id = "eq_" + Math.random().toString(36).slice(2, 8);
    const r = Math.random();
    let type = "defuse";
    if (r < 0.2) type = "blueHint";
    else if (r < 0.4) type = "yellowHint";
    else if (r < 0.6) type = "skip";
    equipment[id] = { unlockValue: val, type, unlocked: false, used: false };
  });
  return equipment;
}

export function getUsableEquipment(equipment, cutLog) {
  const eq = equipment || {};
  return Object.entries(eq)
    .filter(([, e]) => {
      if (e.used) return false;
      return cutCountForKey(cutLog, e.unlockValue) >= EQUIPMENT_UNLOCK_CUTS;
    })
    .map(([id, e]) => ({ id, ...e }));
}

export function isBlueHintValid(hand, position) {
  if (!hand || position == null || position < 0 || position >= hand.length) return false;
  const w = hand[position];
  if (!w || w.cut) return false;
  if (w.type !== "blue") return false;
  if (typeof w.value !== "number" || !WIRE_VALUES.includes(w.value)) return false;
  return true;
}

export function canGiveHint(hints, playerId) {
  return !(hints && hints[playerId]);
}