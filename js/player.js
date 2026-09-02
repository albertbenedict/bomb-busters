import { db } from "./firebase-config.js";
import {
  ref, onValue, update,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { getSoloCutEligibleValue, isHandFullyCut } from "./game-logic.js";

const params = new URLSearchParams(location.search);
const code = params.get("session");
const playerId = params.get("player");

let session = null;

if (!code || !playerId || code === "undefined" || code === "null") {
  document.getElementById("turn-indicator").textContent = "⚠ Missing session – go back and Join again.";
  console.error("player.js missing params", { code, playerId, href: location.href });
} else {
  onValue(ref(db, `sessions/${code}`), (snap) => {
    session = snap.val();
    if (!session) {
      document.getElementById("turn-indicator").textContent = `⚠ No session "${code}" – did Firefox block Firebase? Disable Tracking Protection.`;
      console.warn("player no session", code);
      return;
    }
    render();
  }, (err) => {
    console.error("player onValue error", err);
    document.getElementById("turn-indicator").textContent = "⚠ Connection failed – check Wi-Fi / disable Firefox shield.";
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

  document.getElementById("turn-indicator").textContent =
    session.currentTurn === playerId ? "Your turn" : "Waiting for your turn…";

  renderTargets(session);

  const soloValue = getSoloCutEligibleValue(myHand, session.public.cutLog);
  const soloBtn = document.getElementById("solo-btn");
  const canAct = session.currentTurn === playerId && session.status === "in_progress";
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
  statusEl.textContent =
    session.status === "won" ? "Mission complete!" :
    session.status === "lost" ? "Bomb exploded — mission failed." : "";
}

function renderTargets(session) {
  const targetsEl = document.getElementById("targets");
  targetsEl.innerHTML = "";
  const canAct = session.currentTurn === playerId && session.status === "in_progress";

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
      btn.addEventListener("click", () => promptGuess(id, pos));
      group.appendChild(btn);
    }
    targetsEl.appendChild(group);
  });
}

function promptGuess(targetId, position) {
  const raw = prompt("Guess this wire's value:");
  const value = Number(raw);
  if (!raw || Number.isNaN(value)) return;
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
  return order[(order.indexOf(playerId) + 1) % order.length];
}

async function checkWin() {
  const allCut = Object.values(session.hands).every(isHandFullyCut);
  if (allCut) await update(ref(db, `sessions/${code}`), { status: "won" });
}
