import { db } from "./firebase-config.js";
import {
  ref, update, get, onValue, set,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { watchSession } from "./session.js";
import { buildDeck, dealHands, generateEquipment } from "./game-logic.js";

const params = new URLSearchParams(location.search);
const code = params.get("session");
const roomCodeEl = document.getElementById("room-code");
const tableErrorEl = document.getElementById("table-error");
const tableConnDot = document.getElementById("table-conn-dot");
const tableConnText = document.getElementById("table-conn-text");

function setTableConn(connected) {
  if (!tableConnDot || !tableConnText) return;
  tableConnDot.style.background = connected ? "#1a9e32" : "#c81e2c";
  tableConnDot.style.boxShadow = connected ? "0 0 0 4px #d1f0d7" : "0 0 0 4px #fdeceb";
  tableConnText.textContent = connected ? "Connected" : "Offline — check Wi-Fi / disable Firefox Tracking Protection";
}

function showTableError(message, hint) {
  tableErrorEl.innerHTML = "";
  const strong = document.createElement("div");
  strong.textContent = message;
  strong.style.fontWeight = "700";
  tableErrorEl.appendChild(strong);
  if (hint) {
    const small = document.createElement("div");
    small.textContent = hint;
    small.style.fontWeight = "400";
    small.style.fontSize = "0.82rem";
    small.style.opacity = "0.9";
    small.style.marginTop = "0.35rem";
    tableErrorEl.appendChild(small);
  }
  const actions = document.createElement("div");
  actions.style.marginTop = "0.75rem";
  actions.style.display = "flex";
  actions.style.gap = "0.5rem";
  actions.style.justifyContent = "center";
  actions.style.flexWrap = "wrap";
  const backBtn = document.createElement("button");
  backBtn.textContent = "← Back to lobby";
  backBtn.className = "btn-secondary";
  backBtn.style.padding = "0.5rem 1rem";
  backBtn.style.fontSize = "0.9rem";
  backBtn.onclick = () => location.href = "index.html";
  actions.appendChild(backBtn);
  if (code) {
    const retryBtn = document.createElement("button");
    retryBtn.textContent = "Retry";
    retryBtn.className = "btn-primary";
    retryBtn.style.padding = "0.5rem 1rem";
    retryBtn.style.fontSize = "0.9rem";
    retryBtn.onclick = () => location.reload();
    actions.appendChild(retryBtn);
  }
  tableErrorEl.appendChild(actions);
  tableErrorEl.classList.remove("hidden");
  tableErrorEl.style.flexDirection = "column";
}

// Room code — copy button (presentation only, no game logic)
const copyBtn = document.getElementById("copy-code-btn");
if (copyBtn) {
  copyBtn.addEventListener("click", async () => {
    const text = roomCodeEl.textContent?.trim();
    if (!text || text === "—" || text === "----") return;
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = "✓ Copied";
      copyBtn.classList.add("copied");
      setTimeout(() => { copyBtn.textContent = "⧉ Copy"; copyBtn.classList.remove("copied"); }, 1600);
    } catch {
      // Fallback — select text
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(roomCodeEl);
      sel.removeAllRanges(); sel.addRange(range);
    }
  });
}

if (!code || code === "undefined" || code === "null" || code.trim() === "") {
  roomCodeEl.textContent = "—";
  if (copyBtn) copyBtn.classList.add("hidden");
  showTableError(
    "No room code in URL.",
    "Tap Host game on the lobby to create a room. If you opened table.html directly, go back. Tip: use the same http://<PC-IP>:3000 on all devices (npx serve -l tcp://0.0.0.0:3000 --cors) – don't mix localhost and IP, and don't open via file://."
  );
} else {
  roomCodeEl.textContent = code;
}

try {
  onValue(ref(db, ".info/connected"), (snap) => setTableConn(snap.val() === true), (err) => {
    console.error("table conn listener failed", err);
    setTableConn(false);
  });
} catch (e) {
  console.error("conn listener failed", e);
  setTableConn(false);
}

if (code) {
  watchSession(code, (session) => {
    if (!session) {
      showTableError(
        `No session found for "${code}".`,
        "It may have expired, or Firefox blocked Firebase (SecurityError). Disable Enhanced Tracking Protection (shield icon) and reload, then Host again."
      );
      return;
    }
    tableErrorEl.classList.add("hidden");
    tableErrorEl.innerHTML = "";
    render(session);
  });
}

// Tracks the previous detonator position so the "pulse" animation on the
// newest dot only plays when a wrong guess JUST happened — render() fires
// on every Firebase update, not just detonator changes.
let prevDetonatorPosition = null;

function render(session) {
  const playersEl = document.getElementById("players");
  playersEl.innerHTML = "";
  const players = session.public.players || {};
  Object.entries(players).forEach(([id, p]) => {
    const isActive = session.currentTurn === id && session.status === "in_progress";
    const li = document.createElement("li");
    li.className = "player-row" + (isActive ? " player-row--active" : "");
    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.alignItems = "center";
    left.style.gap = "0.5rem";
    left.style.flexWrap = "wrap";
    const nameSpan = document.createElement("span");
    nameSpan.textContent = `${p.name} · ${p.wireCount} wires`;
    nameSpan.style.fontWeight = isActive ? "800" : "600";
    left.appendChild(nameSpan);
    if (p.connected === false) {
      const off = document.createElement("span");
      off.className = "badge badge--muted";
      off.textContent = "Offline";
      off.style.fontSize = "0.6rem";
      left.appendChild(off);
    }
    if (isActive) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "Turn";
      left.appendChild(badge);
    }
    li.appendChild(left);

    const kickBtn = document.createElement("button");
    kickBtn.textContent = "Kick";
    kickBtn.className = "danger";
    kickBtn.style.padding = "0.25rem 0.6rem";
    kickBtn.style.fontSize = "0.8rem";
    kickBtn.style.borderWidth = "1px";
    kickBtn.style.opacity = "0.72";
    kickBtn.onclick = () => kickPlayer(id, p.name);
    li.appendChild(kickBtn);

    playersEl.appendChild(li);
  });

  const detonator = session.public.detonator;
  const detonatorEl = document.getElementById("detonator");
  detonatorEl.textContent = `${detonator.position} / ${detonator.max}`;
  const danger = detonator.position >= detonator.max - 1;
  const critical = detonator.position >= detonator.max;
  detonatorEl.classList.toggle("warn", danger);

  const detonatorBadge = document.getElementById("detonator-badge");
  detonatorBadge.textContent = critical ? "Exploded" : danger ? "Danger" : "Safe";
  detonatorBadge.classList.toggle("badge--danger", danger);
  detonatorBadge.classList.toggle("badge--muted", !danger);

  // Meter — visual escalation, not just Safe→Danger flip
  const meterEl = document.getElementById("detonator-meter");
  if (meterEl) {
    meterEl.innerHTML = "";
    const max = detonator.max || 1;
    const justIncreased = prevDetonatorPosition !== null && detonator.position > prevDetonatorPosition;
    for (let i = 0; i < max; i++) {
      const dot = document.createElement("span");
      dot.className = "detonator-dot" + (i < detonator.position ? " filled" : "");
      if (i < detonator.position && danger) dot.classList.add("danger");
      if (justIncreased && i === detonator.position - 1) dot.classList.add("pulse");
      meterEl.appendChild(dot);
    }
    // Bar under dots
    const bar = document.createElement("div");
    bar.className = "detonator-bar";
    bar.style.width = "100%";
    const fill = document.createElement("div");
    fill.className = "detonator-bar__fill" + (critical ? " critical" : danger ? " warn" : "");
    fill.style.width = `${Math.min(100, (detonator.position / max) * 100)}%`;
    bar.appendChild(fill);
    meterEl.appendChild(bar);
  }
  prevDetonatorPosition = detonator.position;

  const labelEl = document.getElementById("detonator-label");
  if (labelEl) {
    if (critical) labelEl.textContent = "Detonator maxed — bomb exploded.";
    else if (danger) labelEl.textContent = `${detonator.max - detonator.position} wrong guess left before explosion.`;
    else labelEl.textContent = `${detonator.max - detonator.position} safe misses remaining.`;
  }

  const cutLog = Object.values(session.public.cutLog || {});
  const cutCount = cutLog.filter((c) => c.result === "cut").length;
  document.getElementById("cut-count").textContent = cutCount;

  const yellowCut = cutLog.filter((c) => c.type === "yellow" && c.result === "cut").length;
  const redCut = cutLog.filter((c) => c.type === "red" && c.result === "cut").length;
  document.getElementById("yellow-count").textContent = `${yellowCut} / ${session.config.yellowCount ?? 0}`;
  document.getElementById("red-count").textContent = `${redCut} / ${session.config.redCount ?? 0}`;

  const lobbyBadge = document.getElementById("lobby-badge");
  const finished = session.status === "won" || session.status === "lost";
  lobbyBadge.classList.toggle("hidden", finished);
  lobbyBadge.textContent = session.status === "in_progress" ? "Live" : "Lobby";

  const statusEl = document.getElementById("status");
  if (session.status === "won") {
    statusEl.textContent = "Mission complete — every wire cut.";
    statusEl.className = "banner banner--success";
  } else if (session.status === "lost") {
    statusEl.textContent = "Bomb exploded — mission failed.";
    statusEl.className = "banner banner--danger";
  } else {
    statusEl.className = "banner hidden";
  }

  // Equipment pool — locked/dimmed, unlocked-unused highlighted, used struck through
  const eqEl = document.getElementById("equipment-pool");
  if (eqEl) {
    eqEl.innerHTML = "";
    const equipment = session.public.equipment || {};
    const cutLog = session.public.cutLog || {};
    const entries = Object.entries(equipment);
    if (entries.length === 0) {
      eqEl.innerHTML = `<span class="muted" style="font-size:0.82rem;">No equipment — start a game to generate ${Object.keys(players).length || "2–5"} cards.</span>`;
    } else {
      entries.forEach(([id, e]) => {
        const cnt = Object.values(cutLog).filter((c) => c.guessKey === e.unlockValue).length;
        const isUsed = !!e.used;
        const isUnlocked = !isUsed && cnt >= 2;
        const chip = document.createElement("span");
        chip.className = "eq-chip" + (isUsed ? " eq-chip--used" : isUnlocked ? " eq-chip--unlocked" : " eq-chip--locked");
        chip.textContent = isUsed ? `Used · ${e.unlockValue}s` : isUnlocked ? `Ready · ${e.unlockValue}s` : `Locked · ${e.unlockValue}s`;
        chip.title = isUsed ? `Used (unlocks on ${e.unlockValue}s)` : isUnlocked ? `Unlocked — defuse one mistake` : `Needs 2 cuts of ${e.unlockValue}s (${cnt}/2)`;
        eqEl.appendChild(chip);
      });
    }
  }

  // Hints — one blue factual per player, strict turnOrder + target-only wrong reveals
  const hintsEl = document.getElementById("hints-pool");
  if (hintsEl) {
    hintsEl.innerHTML = "";
    const hints = session.public.hints || {};
    const infoTokens = session.public.infoTokens || {};
    const hintOrder = session.public.hintOrder || session.turnOrder || [];
    const hintIndex = session.public.hintIndex ?? hintOrder.length;
    const totalPlayers = Object.keys(players).length;
    const hintCount = Object.keys(hints).length;
    const isHintPhase = session.status === "in_progress" && hintCount < totalPlayers && totalPlayers >= 2;
    if (hintCount === 0 && totalPlayers >= 2 && session.status === "lobby") {
      hintsEl.innerHTML = `<span class="muted" style="font-size:0.82rem;">Hints will appear after deal — one blue per player in turn order.</span>`;
    } else {
      // Factual hints + wrong auto-hints unified
      hintOrder.forEach((pid) => {
        const p = players[pid];
        if (!p) return;
        const h = hints[pid];
        const chip = document.createElement("span");
        if (h) {
          chip.className = "hint-chip";
          chip.textContent = `${p.name}: ${h.position + 1} is ${h.value}`;
          chip.title = `Factual blue hint — wire ${h.position + 1} is ${h.value}`;
        } else {
          const isNext = hintOrder[hintIndex] === pid && isHintPhase;
          chip.className = isNext ? "hint-chip hint-chip--next" : "hint-chip hint-chip--pending";
          chip.textContent = `${p.name}: —`;
          chip.title = isNext ? "Next to give hint" : "Awaiting hint";
        }
        hintsEl.appendChild(chip);
      });
      // Wrong reveals as "was" chips (target only)
      Object.values(infoTokens).forEach((tok) => {
        const owner = players[tok.ownerId];
        const chip = document.createElement("span");
        chip.className = "hint-chip hint-chip--wrong";
        chip.textContent = `${owner ? owner.name : "Wire"} ${tok.position + 1} was ${tok.value ?? tok.guessKey}`;
        chip.title = `Wrong guess revealed — actual ${tok.value ?? tok.guessKey}`;
        hintsEl.appendChild(chip);
      });
    }
  }

  const startBtn = document.getElementById("start-btn");
  const resetBtn = document.getElementById("reset-btn");
  const endBtn = document.getElementById("end-btn");
  const hostHint = document.getElementById("host-hint");
  const playerCount = Object.keys(players).length;
  const canStart = session.status === "lobby" && playerCount >= 2 && playerCount <= 5;
  startBtn.classList.toggle("hidden", !canStart);
  document.getElementById("lobby-hint").classList.toggle("hidden", session.status !== "lobby");

  const hasSession = !!session && !!session.config;
  resetBtn.classList.toggle("hidden", !hasSession);
  endBtn.classList.toggle("hidden", !hasSession);
  hostHint.classList.toggle("hidden", !hasSession);
}

document.getElementById("start-btn").addEventListener("click", async () => {
  const snap = await get(ref(db, `sessions/${code}`));
  const session = snap.val();
  if (!session || !session.public.players) return;
  const playerIds = Object.keys(session.public.players);
  if (playerIds.length < 2) return;
  const deck = buildDeck(session.config);
  const hands = dealHands(deck, playerIds);
  const equipment = generateEquipment(playerIds.length, session.config.wireCount);

  const updates = {
    status: "in_progress",
    turnOrder: playerIds,
    currentTurn: playerIds[0],
    hands,
    pendingGuess: null,
    lastOutcome: null,
  };
  playerIds.forEach((id) => {
    updates[`public/players/${id}/wireCount`] = hands[id].length;
    updates[`public/players/${id}/connected`] = true;
  });
  updates["public/cutLog"] = {};
  updates["public/infoTokens"] = {};
  updates["public/validationTokens"] = {};
  updates["public/detonator/position"] = 0;
  updates["public/equipment"] = equipment;
  updates["public/hints"] = {};
  updates["public/hintOrder"] = playerIds;
  updates["public/hintIndex"] = 0;

  await update(ref(db, `sessions/${code}`), updates);
});

async function kickPlayer(playerId, name) {
  if (!confirm(`Kick ${name}? Their hand will be removed.`)) return;
  const snap = await get(ref(db, `sessions/${code}`));
  const session = snap.val();
  if (!session) return;
  const updates = {};
  updates[`public/players/${playerId}`] = null;
  updates[`hands/${playerId}`] = null;
  updates[`public/hints/${playerId}`] = null;
  const order = (session.turnOrder || []).filter((id) => id !== playerId);
  updates["turnOrder"] = order;
  // Keep hintOrder in sync — strict sequential hints
  const hintOrder = (session.public?.hintOrder || session.turnOrder || []).filter((id) => id !== playerId);
  updates["public/hintOrder"] = hintOrder;
  if (session.public?.hints && session.public.hints[playerId]) {
    // if kicked player was next to hint, advance hintIndex if needed
    const idx = (session.public.hintOrder || []).indexOf(playerId);
    const curIdx = session.public.hintIndex ?? 0;
    if (idx !== -1 && idx < curIdx) updates["public/hintIndex"] = Math.max(0, curIdx - 1);
    else if (idx === curIdx) updates["public/hintIndex"] = curIdx;
  }
  if (session.currentTurn === playerId) {
    if (order.length === 0) {
      updates["currentTurn"] = null;
    } else {
      let next = order[0];
      for (const id of order) {
        const hand = session.hands && session.hands[id];
        if (!hand || hand.every((w) => w.cut) === false) { next = id; break; }
      }
      updates["currentTurn"] = next;
    }
  }
  if (order.length < 2 && session.status === "in_progress") {
    updates["status"] = "lobby";
  }
  await update(ref(db, `sessions/${code}`), updates);
}

document.getElementById("reset-btn").addEventListener("click", async () => {
  if (!confirm("Reset to lobby? Keeps players but clears all wires, cuts and detonator.")) return;
  const snap = await get(ref(db, `sessions/${code}`));
  const session = snap.val();
  if (!session) return;
  const updates = {
    status: "lobby",
    turnOrder: [],
    currentTurn: null,
    pendingGuess: null,
    lastOutcome: null,
    hands: {},
    "public/cutLog": {},
    "public/infoTokens": {},
    "public/validationTokens": {},
    "public/equipment": {},
    "public/hints": {},
    "public/hintOrder": [],
    "public/hintIndex": 0,
    "public/detonator/position": 0,
  };
  Object.keys(session.public.players || {}).forEach((id) => {
    updates[`public/players/${id}/wireCount`] = 0;
    updates[`public/players/${id}/connected`] = true;
  });
  await update(ref(db, `sessions/${code}`), updates);
});

document.getElementById("end-btn").addEventListener("click", async () => {
  if (!confirm("End session? This deletes the room for everyone.")) return;
  try {
    await set(ref(db, `sessions/${code}`), null);
  } catch (e) {
    console.error("end failed", e);
    alert("Failed to end: " + e.message);
    return;
  }
  document.getElementById("room-code").textContent = "—";
  showTableError("Session ended.", "Share a new code from Host.");
});
