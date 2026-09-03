import { db } from "./firebase-config.js";
import {
  ref, update, get, onValue, set,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { watchSession } from "./session.js";
import { buildDeck, dealHands } from "./game-logic.js";

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

if (!code || code === "undefined" || code === "null" || code.trim() === "") {
  roomCodeEl.textContent = "—";
  showTableError(
    "No room code in URL.",
    "Tap Host game on the lobby to create a room. If you opened table.html directly, go back. Tip: use the same http://<PC-IP>:3000 on all devices (npx serve -l tcp://0.0.0.0:3000 --cors) – don't mix localhost and IP, and don't open via file://."
  );
} else {
  roomCodeEl.textContent = code;
}

// .info/connected listener for this page too – shows if wss is blocked (Firefox ETP)
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

function render(session) {
  const playersEl = document.getElementById("players");
  playersEl.innerHTML = "";
  const players = session.public.players || {};
  Object.entries(players).forEach(([id, p]) => {
    const li = document.createElement("li");
    li.className = "player-row";
    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.alignItems = "center";
    left.style.gap = "0.5rem";
    const nameSpan = document.createElement("span");
    nameSpan.textContent = `${p.name} · ${p.wireCount} wires`;
    left.appendChild(nameSpan);
    if (p.connected === false) {
      const off = document.createElement("span");
      off.className = "badge badge--muted";
      off.textContent = "Offline";
      off.style.fontSize = "0.6rem";
      left.appendChild(off);
    }
    if (session.currentTurn === id) {
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
    kickBtn.onclick = () => kickPlayer(id, p.name);
    li.appendChild(kickBtn);

    playersEl.appendChild(li);
  });

  const detonator = session.public.detonator;
  const detonatorEl = document.getElementById("detonator");
  detonatorEl.textContent = `${detonator.position} / ${detonator.max}`;
  const danger = detonator.position >= detonator.max - 1;
  detonatorEl.classList.toggle("warn", danger);

  const detonatorBadge = document.getElementById("detonator-badge");
  detonatorBadge.textContent = danger ? "Danger" : "Safe";
  detonatorBadge.classList.toggle("badge--danger", danger);
  detonatorBadge.classList.toggle("badge--muted", !danger);

  const cutLog = Object.values(session.public.cutLog || {});
  const cutCount = cutLog.filter((c) => c.result === "cut").length;
  document.getElementById("cut-count").textContent = cutCount;

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

  const startBtn = document.getElementById("start-btn");
  const resetBtn = document.getElementById("reset-btn");
  const endBtn = document.getElementById("end-btn");
  const hostHint = document.getElementById("host-hint");
  const playerCount = Object.keys(players).length;
  const canStart = session.status === "lobby" && playerCount >= 2 && playerCount <= 5;
  startBtn.classList.toggle("hidden", !canStart);
  document.getElementById("lobby-hint").classList.toggle("hidden", session.status !== "lobby");

  // Host controls visible once session exists (lobby or in_progress)
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
  const deck = buildDeck(session.config.wireCount);
  const hands = dealHands(deck, playerIds);

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
  // Clear previous game artefacts
  updates["public/cutLog"] = {};
  updates["public/infoTokens"] = {};
  updates["public/validationTokens"] = {};
  updates["public/detonator/position"] = 0;

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
  // Remove from turnOrder
  const order = (session.turnOrder || []).filter((id) => id !== playerId);
  updates["turnOrder"] = order;
  // If kicked player was current turn, advance (with skip)
  if (session.currentTurn === playerId) {
    if (order.length === 0) {
      updates["currentTurn"] = null;
    } else {
      // Find next live player (skip fully cut)
      let next = order[0];
      for (const id of order) {
        const hand = session.hands && session.hands[id];
        if (!hand || hand.every((w) => w.cut) === false) { next = id; break; }
      }
      updates["currentTurn"] = next;
    }
  }
  // If lobby and only kick, keep status
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
