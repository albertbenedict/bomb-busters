import { db } from "./firebase-config.js";
import {
  ref, onValue, update, onDisconnect,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { getSoloCutEligibleValue, isHandFullyCut } from "./game-logic.js";

const params = new URLSearchParams(location.search);
const code = params.get("session");
const playerId = params.get("player");

let session = null;
let activeGuess = null; // { targetId, targetName, position } while the value picker is open

if (!code || !playerId || code === "undefined" || code === "null" || playerId === "undefined") {
  const el = document.getElementById("turn-indicator");
  if (el) {
    el.textContent = "⚠ Missing session – go back and Join again.";
    el.className = "badge badge--danger";
  }
  console.error("player.js missing params", { code, playerId, href: location.href });
} else {
  // Mark this handheld as connected (and auto-offline on disconnect/refresh)
  try {
    update(ref(db, `sessions/${code}/public/players/${playerId}`), { connected: true });
    onDisconnect(ref(db, `sessions/${code}/public/players/${playerId}/connected`)).set(false);
    try { localStorage.setItem(`bb-player-${code}`, playerId); } catch {}
  } catch (e) { console.warn("presence failed", e); }

  onValue(ref(db, `sessions/${code}`), (snap) => {
    session = snap.val();
    if (!session) {
      const el = document.getElementById("turn-indicator");
      if (el) {
        el.textContent = `⚠ No session "${code}" – did Firefox block Firebase? Disable Tracking Protection.`;
        el.className = "badge badge--danger";
      }
      console.warn("player no session", code);
      return;
    }
    // Ensure we still show presence if reconnected
    if (session.public.players && session.public.players[playerId] && session.public.players[playerId].connected === false) {
      try { update(ref(db, `sessions/${code}/public/players/${playerId}`), { connected: true }); } catch {}
    }
    render();
  }, (err) => {
    console.error("player onValue error", err);
    const el = document.getElementById("turn-indicator");
    if (el) {
      el.textContent = "⚠ Connection failed – check Wi-Fi / disable Firefox shield.";
      el.className = "badge badge--danger";
    }
  });

  window.addEventListener("beforeunload", () => {
    try { update(ref(db, `sessions/${code}/public/players/${playerId}`), { connected: false }); } catch {}
  });
}

function render() {
  const myHand = (session.hands && session.hands[playerId]) || [];

  const handEl = document.getElementById("hand");
  handEl.innerHTML = "";
  myHand.forEach((wire) => {
    const div = document.createElement("div");
    div.className = "wire" + (wire.cut ? " cut" : "");
    div.textContent = wire.value;
    handEl.appendChild(div);
  });

  const canAct = session.currentTurn === playerId && session.status === "in_progress";
  const turnEl = document.getElementById("turn-indicator");
  turnEl.textContent = canAct ? "Your turn" : "Waiting for your turn…";
  turnEl.className = canAct ? "badge" : "badge badge--muted";

  renderTargets(canAct);
  renderGuessComposer();

  const soloValue = getSoloCutEligibleValue(myHand, session.public.cutLog);
  const soloBtn = document.getElementById("solo-btn");
  soloBtn.classList.toggle("hidden", !(soloValue && canAct));
  soloBtn.textContent = `Solo cut your ${soloValue}s`;
  soloBtn.onclick = () => performSoloCut(soloValue);

  // I'm the target of a live guess — only my device can check it, since
  // only I legitimately know my own hand's real values.
  if (session.pendingGuess && session.pendingGuess.target === playerId) {
    resolvePendingGuess(session.pendingGuess);
  }

  // My own guess just got resolved by the target's device — react to it.
  if (session.lastOutcome && session.lastOutcome.by === playerId && !session.lastOutcome.acknowledged) {
    reactToOutcome(session.lastOutcome);
  }

  const statusEl = document.getElementById("status");
  if (session.status === "won") {
    statusEl.textContent = "Mission complete!";
    statusEl.className = "banner banner--success";
  } else if (session.status === "lost") {
    statusEl.textContent = "Bomb exploded — mission failed.";
    statusEl.className = "banner banner--danger";
  } else {
    statusEl.className = "banner hidden";
  }
}

function renderTargets(canAct) {
  const targetsEl = document.getElementById("targets");
  targetsEl.innerHTML = "";

  Object.entries(session.public.players || {}).forEach(([id, p]) => {
    if (id === playerId) return;
    const group = document.createElement("div");
    group.className = "player-group";
    const label = document.createElement("div");
    label.innerHTML = `<strong>${p.name}</strong>`;
    group.appendChild(label);

    for (let pos = 0; pos < p.wireCount; pos++) {
      const btn = document.createElement("button");
      btn.textContent = pos + 1;
      btn.disabled = !canAct;
      btn.addEventListener("click", () => {
        activeGuess = { targetId: id, targetName: p.name, position: pos };
        render();
      });
      group.appendChild(btn);
    }
    targetsEl.appendChild(group);
  });
}

// Inline value picker — replaces the old window.prompt() flow.
function renderGuessComposer() {
  const composer = document.getElementById("guess-composer");
  if (!activeGuess) {
    composer.classList.add("hidden");
    return;
  }
  composer.classList.remove("hidden");
  document.getElementById("guess-target-label").textContent =
    `${activeGuess.targetName} · wire ${activeGuess.position + 1}`;

  const optionsEl = document.getElementById("guess-options");
  optionsEl.innerHTML = "";
  const wireCount = session.config.wireCount;
  for (let value = 1; value <= wireCount; value++) {
    const btn = document.createElement("button");
    btn.textContent = value;
    btn.addEventListener("click", () => submitGuess(value));
    optionsEl.appendChild(btn);
  }

  document.getElementById("guess-cancel").onclick = () => {
    activeGuess = null;
    render();
  };
}

function submitGuess(value) {
  const { targetId, position } = activeGuess;
  activeGuess = null;
  update(ref(db, `sessions/${code}`), {
    pendingGuess: { by: playerId, target: targetId, position, value, action: "duo" },
  });
}

// Runs only on the target's device — this is the one place a wire's
// real value ever gets compared, and it happens on the device that's
// already allowed to know it.
async function resolvePendingGuess(guess) {
  const myHand = session.hands[playerId];
  const wire = myHand[guess.position];
  const correct = wire.value === guess.value;
  const stamp = Date.now();

  const updates = { pendingGuess: null };
  updates[`public/cutLog/log_${stamp}`] = {
    ownerId: playerId,
    position: guess.position,
    value: wire.value,
    guessedBy: guess.by,
    result: correct ? "cut" : "wrong",
    action: "duo",
  };

  let newDetonatorPos = session.public.detonator.position;
  if (correct) {
    updates[`hands/${playerId}/${guess.position}/cut`] = true;
  } else {
    updates[`public/infoTokens/info_${stamp}`] = {
      ownerId: playerId, position: guess.position, value: wire.value,
    };
    newDetonatorPos += 1;
    updates[`public/detonator/position`] = newDetonatorPos;
  }

  updates.lastOutcome = {
    by: guess.by, target: playerId, correct, value: wire.value,
    position: guess.position, acknowledged: false, at: stamp,
  };

  if (newDetonatorPos >= session.public.detonator.max) {
    updates.status = "lost";
  }

  await update(ref(db, `sessions/${code}`), updates);
}

// Runs on the guesser's device — the only device that knows which of
// its own wires matches the guessed value.
async function reactToOutcome(outcome) {
  const updates = { "lastOutcome/acknowledged": true };

  if (outcome.correct) {
    const myHand = session.hands[playerId];
    const idx = myHand.findIndex((w) => w.value === outcome.value && !w.cut);
    if (idx > -1) updates[`hands/${playerId}/${idx}/cut`] = true;
  }

  if (session.status !== "lost") {
    updates.currentTurn = nextTurn();
  }

  await update(ref(db, `sessions/${code}`), updates);
  checkWin();
}

async function performSoloCut(value) {
  const myHand = session.hands[playerId];
  const stamp = Date.now();
  const updates = {};

  myHand.forEach((wire, i) => {
    if (wire.value === value && !wire.cut) {
      updates[`hands/${playerId}/${i}/cut`] = true;
      updates[`public/cutLog/log_${stamp}_${i}`] = {
        ownerId: playerId, position: i, value, guessedBy: playerId, result: "cut", action: "solo",
      };
    }
  });
  updates[`public/validationTokens/${value}`] = true;
  updates.currentTurn = nextTurn();

  await update(ref(db, `sessions/${code}`), updates);
  checkWin();
}

function nextTurn() {
  const order = session.turnOrder;
  if (!order || order.length === 0) return playerId;
  const startIdx = order.indexOf(playerId);
  if (startIdx === -1) return order[0];
  // Skip players whose hand is already fully cut
  for (let step = 1; step <= order.length; step++) {
    const nextId = order[(startIdx + step) % order.length];
    const hand = session.hands && session.hands[nextId];
    if (!hand || !isHandFullyCut(hand)) return nextId;
  }
  // All other hands cut – game will be won on next checkWin()
  return order[(startIdx + 1) % order.length];
}

async function checkWin() {
  const allCut = Object.values(session.hands).every(isHandFullyCut);
  if (allCut) await update(ref(db, `sessions/${code}`), { status: "won" });
}
