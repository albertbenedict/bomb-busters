import { db } from "./firebase-config.js";
import {
  ref, update, get, onValue,
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
      // Don't clobber the "No room code" error – that case already handled.
      // This fires when code exists in URL but DB has no session (expired or blocked).
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
    const turnTag = session.currentTurn === id ? " — turn" : "";
    li.textContent = `${p.name} (${p.wireCount} wires)${turnTag}`;
    playersEl.appendChild(li);
  });

  const detonator = session.public.detonator;
  const detonatorEl = document.getElementById("detonator");
  detonatorEl.textContent = `${detonator.position} / ${detonator.max}`;
  detonatorEl.classList.toggle("warn", detonator.position >= detonator.max - 1);

  const cutLog = Object.values(session.public.cutLog || {});
  const cutCount = cutLog.filter((c) => c.result === "cut").length;
  document.getElementById("cut-count").textContent = cutCount;

  const statusEl = document.getElementById("status");
  if (session.status === "won") statusEl.textContent = "Mission complete — every wire cut.";
  else if (session.status === "lost") statusEl.textContent = "Bomb exploded — mission failed.";
  else statusEl.textContent = "";

  const startBtn = document.getElementById("start-btn");
  const canStart = session.status === "lobby" && Object.keys(players).length >= 2 && Object.keys(players).length <= 5;
  startBtn.classList.toggle("hidden", !canStart);
  document.getElementById("lobby-hint").classList.toggle("hidden", session.status !== "lobby");
}

document.getElementById("start-btn").addEventListener("click", async () => {
  const snap = await get(ref(db, `sessions/${code}`));
  const session = snap.val();
  const playerIds = Object.keys(session.public.players);
  const deck = buildDeck(session.config.wireCount);
  const hands = dealHands(deck, playerIds);

  const updates = {
    status: "in_progress",
    turnOrder: playerIds,
    currentTurn: playerIds[0],
    hands,
  };
  playerIds.forEach((id) => {
    updates[`public/players/${id}/wireCount`] = hands[id].length;
  });

  await update(ref(db, `sessions/${code}`), updates);
});
