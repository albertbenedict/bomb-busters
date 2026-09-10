import { db } from "./firebase-config.js";
import {
  ref, onValue, update, onDisconnect,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { getSoloCutEligibleKey, getAllSoloCutEligibleKeys, canRevealRedWires, isHandFullyCut, getUsableEquipment, isBlueHintValid, canGiveHint } from "./game-logic.js";

const params = new URLSearchParams(location.search);
const code = params.get("session");
const playerId = params.get("player");

let session = null;
let activeGuess = null;
let colorHintMode = null;

let disconnectRef = null;
if (!code || !playerId || code === "undefined" || code === "null" || playerId === "undefined") {
  const el = document.getElementById("turn-indicator");
  if (el) {
    el.textContent = "⚠ Missing session – go back and Join again.";
    el.className = "badge badge--danger";
  }
  console.error("player.js missing params", { code, playerId, href: location.href });
} else {
  try {
    update(ref(db, `sessions/${code}/public/players/${playerId}`), { connected: true });
    disconnectRef = onDisconnect(ref(db, `sessions/${code}/public/players/${playerId}/connected`));
    disconnectRef.set(false);
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
    try {
      if (disconnectRef) disconnectRef.cancel();
      update(ref(db, `sessions/${code}/public/players/${playerId}`), { connected: false });
    } catch {}
  });
  window.addEventListener("pagehide", () => {
    try { if (disconnectRef) disconnectRef.cancel(); } catch {}
  });
}

function wireLabel(wire) {
  if (wire.type === "blue") return String(wire.value);
  if (wire.type === "yellow") return String(wire.value);
  return String(wire.value);
}

let prevHandCut = [];
let hasRenderedHand = false;

function render() {
  const myHand = (session.hands && session.hands[playerId]) || [];

  const hintsEnabled = session.config?.hintsEnabled ?? true;
  const hints = session.public.hints || {};
  const hintOrder = session.public.hintOrder || session.turnOrder || [];
  const hintIndex = session.public.hintIndex ?? 0;
  const playerCount = Object.keys(session.public.players || {}).length;
  const hintCount = Object.keys(hints).length;
  const isHintPhase = hintsEnabled && session.status === "in_progress" && hintCount < playerCount && playerCount >= 2;
  const isMyHintTurn = isHintPhase && hintOrder[hintIndex] === playerId && canGiveHint(hints, playerId);

  const handEl = document.getElementById("hand");
  handEl.innerHTML = "";
  myHand.forEach((wire, i) => {
    const wasCut = prevHandCut[i] === true;
    const nowCut = !!wire.cut;
    const div = document.createElement("div");
    let extra = "";
    if (!wasCut && nowCut) extra = " wire--cutting";
    else if (!hasRenderedHand) extra = " wire--enter";
    const hintable = isMyHintTurn && wire.type === "blue" && !wire.cut;
    const colorHintable = colorHintMode && !wire.cut && (
      (colorHintMode.type === "blueHint" && wire.type === "blue") ||
      (colorHintMode.type === "yellowHint" && wire.type === "yellow")
    );
    div.className = `wire wire--${wire.type}` + (nowCut ? " cut" : "") + extra + (hintable ? " wire--hintable" : "") + (colorHintable ? " wire--color-hintable" : "");
    div.textContent = wireLabel(wire);
    if (hintable) {
      div.style.cursor = "pointer";
      div.title = `Hint: wire ${i + 1} is ${wire.value}`;
      div.addEventListener("click", () => submitHint(i));
    } else if (colorHintable) {
      div.style.cursor = "pointer";
      div.title = `Use ${colorHintMode.type === "blueHint" ? "Blue" : "Yellow"} Hint on wire ${i + 1}`;
      div.addEventListener("click", () => submitColorHint(i));
    }
    handEl.appendChild(div);
  });
  if (colorHintMode) {
    const hintBar = document.createElement("div");
    hintBar.className = "muted";
    hintBar.style.fontSize = "0.85rem";
    hintBar.style.marginTop = "0.5rem";
    hintBar.style.display = "flex";
    hintBar.style.gap = "0.5rem";
    hintBar.style.alignItems = "center";
    hintBar.textContent = `Pick one of your ${colorHintMode.type === "blueHint" ? "blue" : "yellow"} wires to reveal`;
    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.className = "btn-ghost";
    cancelBtn.style.padding = "0.3rem 0.6rem";
    cancelBtn.style.fontSize = "0.8rem";
    cancelBtn.onclick = () => { colorHintMode = null; render(); };
    hintBar.appendChild(cancelBtn);
    handEl.appendChild(hintBar);
  }
  prevHandCut = myHand.map((w) => !!w.cut);
  if (myHand.length > 0) hasRenderedHand = true;

  const countBadge = document.getElementById("hand-count-badge");
  if (countBadge) {
    const remaining = myHand.filter((w) => !w.cut).length;
    countBadge.textContent = myHand.length ? `${remaining} left · ${myHand.length} total` : "—";
  }

  const canAct = !isHintPhase && session.currentTurn === playerId && session.status === "in_progress";
  const banner = document.getElementById("turn-banner");
  const bannerLabel = document.getElementById("turn-banner-label");
  const turnEl = document.getElementById("turn-indicator");
  const currentName = session.public.players && session.currentTurn && session.public.players[session.currentTurn]
    ? session.public.players[session.currentTurn].name
    : null;
  if (banner && bannerLabel && turnEl) {
    if (session.status === "won" || session.status === "lost") {
      banner.className = "turn-banner hidden";
    } else if (isHintPhase) {
      const hintPlayerName = hintOrder[hintIndex] ? session.public.players?.[hintOrder[hintIndex]]?.name : null;
      if (isMyHintTurn) {
        banner.className = "turn-banner turn-banner--active";
        bannerLabel.textContent = "Your hint — tap a blue wire";
        turnEl.textContent = "Pick one of your blue wires";
        turnEl.className = "turn-banner__sub badge";
      } else {
        banner.className = "turn-banner turn-banner--waiting";
        if (hintPlayerName) {
          bannerLabel.innerHTML = `Hint: waiting for <span class="turn-banner__waiting-name">${hintPlayerName}</span>`;
          turnEl.textContent = `${hintPlayerName}'s hint`;
        } else {
          bannerLabel.textContent = "Hints…";
          turnEl.textContent = "Waiting for hints…";
        }
        turnEl.className = "turn-banner__sub badge badge--muted";
      }
    } else if (canAct) {
      banner.className = "turn-banner turn-banner--active";
      bannerLabel.textContent = "Your turn — go!";
      turnEl.textContent = "Pick a teammate's wire";
      turnEl.className = "turn-banner__sub badge";
    } else {
      banner.className = "turn-banner turn-banner--waiting";
      if (currentName) {
        bannerLabel.innerHTML = `Waiting for <span class="turn-banner__waiting-name">${currentName}</span>`;
        turnEl.textContent = `${currentName}'s turn`;
      } else {
        bannerLabel.textContent = session.status === "lobby" ? "Waiting to start…" : "Waiting…";
        turnEl.textContent = "Waiting for next turn…";
      }
      turnEl.className = "turn-banner__sub badge badge--muted";
    }
  } else if (turnEl) {
    if (isHintPhase) {
      const hn = hintOrder[hintIndex] ? session.public.players?.[hintOrder[hintIndex]]?.name : null;
      turnEl.textContent = isMyHintTurn ? "Your hint" : hn ? `Waiting for ${hn}'s hint…` : "Hints…";
      turnEl.className = isMyHintTurn ? "badge" : "badge badge--muted";
    } else {
      turnEl.textContent = canAct ? "Your turn" : currentName ? `Waiting for ${currentName}…` : "Waiting…";
      turnEl.className = canAct ? "badge" : "badge badge--muted";
    }
  }

  const effectiveCanAct = isHintPhase ? false : canAct;
  renderTargets(effectiveCanAct);
  renderGuessComposer(effectiveCanAct);
  renderHints();
  renderHintActions(isMyHintTurn);

  const soloKeys = getAllSoloCutEligibleKeys(myHand, session.public.cutLog, session.config);
  const soloBtn = document.getElementById("solo-btn");
  const showSolo = soloKeys.length > 0 && canAct;
  soloBtn.classList.toggle("hidden", !showSolo);
  if (showSolo) {
    if (soloKeys.length === 1) {
      const k = soloKeys[0];
      soloBtn.textContent = k === "yellow" ? "Solo cut your yellows" : `Solo cut your ${k}s`;
      soloBtn.onclick = () => performSoloCut(k);
    } else {
      soloBtn.textContent = `Solo cut: ${soloKeys.map((k) => k === "yellow" ? "Yellow" : k).join(", ")}`;
      soloBtn.onclick = () => performSoloCut(soloKeys);
    }
  }

  const canReveal = canRevealRedWires(myHand);
  const revealBtn = document.getElementById("reveal-red-btn");
  revealBtn.classList.toggle("hidden", !(canReveal && canAct));
  revealBtn.onclick = () => revealRedWires();

  renderEquipment(canAct);

  renderGuessResult();

  if (session.pendingGuess && session.pendingGuess.target === playerId) {
    resolvePendingGuess(session.pendingGuess);
  }

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
  toggleWinOverlay(session);
}

function renderTargets(canAct) {
  const targetsEl = document.getElementById("targets");
  targetsEl.innerHTML = "";

  Object.entries(session.public.players || {}).forEach(([id, p]) => {
    if (id === playerId) return;
    const group = document.createElement("div");
    group.className = "player-group";
    const head = document.createElement("div");
    head.className = "player-group__head";
    const label = document.createElement("div");
    label.className = "player-group__name";
    label.textContent = p.name;
    head.appendChild(label);
    const meta = document.createElement("span");
    meta.className = "badge badge--muted";
    meta.style.fontSize = "0.62rem";
    meta.textContent = `${p.wireCount} wires`;
    head.appendChild(meta);
    group.appendChild(head);

    const hints = session.public.hints || {};
    const myHint = hints[id];
    if (myHint) {
      const hintRow = document.createElement("div");
      hintRow.className = "hint-row";
      const chip = document.createElement("span");
      chip.className = "hint-chip";
      chip.textContent = `Hint: ${myHint.position + 1} is ${myHint.value}`;
      chip.title = `Factual — wire ${myHint.position + 1} is ${myHint.value}`;
      hintRow.appendChild(chip);
      group.appendChild(hintRow);
    }
    const infoTokens = session.public.infoTokens || {};
    const wrongs = Object.values(infoTokens).filter((t) => t.ownerId === id);
    if (wrongs.length) {
      const wrongRow = document.createElement("div");
      wrongRow.className = "hint-row";
      wrongs.forEach((tok) => {
        const chip = document.createElement("span");
        chip.className = "hint-chip hint-chip--wrong";
        const wasLabel = tok.type === "red" ? "RED" : tok.type === "yellow" ? "YELLOW" : (tok.value ?? tok.guessKey ?? "—");
        chip.textContent = `${tok.position + 1} was ${wasLabel}`;
        chip.title = `Wrong guess revealed`;
        wrongRow.appendChild(chip);
      });
      group.appendChild(wrongRow);
    }

    const rack = document.createElement("div");
    rack.className = "rack";
    const theirHand = session.hands && session.hands[id];
    for (let pos = 0; pos < p.wireCount; pos++) {
      const alreadyCut = !!(theirHand && theirHand[pos] && theirHand[pos].cut);
      const btn = document.createElement("button");
      btn.className = "rack-wire" + (alreadyCut ? " rack-wire--cut" : "");
      if (activeGuess && activeGuess.targetId === id && activeGuess.position === pos) btn.classList.add("rack-wire--active");
      btn.textContent = pos + 1;
      btn.disabled = !canAct || alreadyCut;
      btn.setAttribute("aria-label", `${p.name} wire ${pos + 1}${alreadyCut ? " (cut)" : ""}`);
      if (!alreadyCut) {
        btn.addEventListener("click", () => {
          const prev = activeGuess;
          activeGuess = { targetId: id, targetName: p.name, position: pos };
          render();
          if (!prev || prev.targetId !== id || prev.position !== pos) {
            update(ref(db, `sessions/${code}/public/pendingSelections/${playerId}`), { targetId: id, position: pos, targetName: p.name, at: Date.now() }).catch(() => {});
          }
        });
      }
      rack.appendChild(btn);
    }
    group.appendChild(rack);
    targetsEl.appendChild(group);
  });
}

function renderGuessComposer() {
  const composer = document.getElementById("guess-composer");
  if (!activeGuess) {
    composer.classList.add("hidden");
    return;
  }
  composer.classList.remove("hidden");
  document.getElementById("guess-target-label").textContent =
    `${activeGuess.targetName} · wire ${activeGuess.position + 1}`;

  const myHand = (session.hands && session.hands[playerId]) || [];
  const haveKeys = new Set();
  myHand.forEach((w) => {
    if (!w.cut && w.guessKey != null) haveKeys.add(String(w.guessKey));
  });

  const optionsEl = document.getElementById("guess-options");
  optionsEl.innerHTML = "";
  const wireCount = session.config.wireCount;
  for (let value = 1; value <= wireCount; value++) {
    const have = haveKeys.has(String(value));
    const btn = document.createElement("button");
    btn.textContent = value;
    btn.disabled = !have;
    btn.className = have ? "" : "blocked";
    btn.title = have ? `You have ${value}s — can guess` : `You have no uncut ${value}s`;
    if (have) btn.addEventListener("click", () => submitGuess(value));
    optionsEl.appendChild(btn);
  }
  const haveYellow = haveKeys.has("yellow");
  const yellowRow = document.getElementById("guess-yellow-row");
  if (yellowRow) {
    yellowRow.innerHTML = "";
    const yellowBtn = document.createElement("button");
    yellowBtn.textContent = "Yellow — any yellow wire";
    yellowBtn.className = "option-yellow" + (haveYellow ? "" : " blocked");
    yellowBtn.disabled = !haveYellow;
    yellowBtn.title = haveYellow ? "You have yellows — can guess" : "You have no uncut yellows";
    if (haveYellow) yellowBtn.addEventListener("click", () => submitGuess("yellow"));
    yellowRow.appendChild(yellowBtn);
  } else {
    const yellowBtn = document.createElement("button");
    yellowBtn.textContent = "Yellow";
    yellowBtn.className = "option-yellow" + (haveYellow ? "" : " blocked");
    yellowBtn.disabled = !haveYellow;
    if (haveYellow) yellowBtn.addEventListener("click", () => submitGuess("yellow"));
    optionsEl.appendChild(yellowBtn);
  }

  document.getElementById("guess-cancel").onclick = () => {
    activeGuess = null;
    update(ref(db, `sessions/${code}/public/pendingSelections/${playerId}`), null).catch(() => {});
    render();
  };
}

function renderEquipment(canAct) {
  const wrap = document.getElementById("equipment-actions");
  if (!wrap || !session) return;
  wrap.innerHTML = "";
  const usable = getUsableEquipment(session.public.equipment, session.public.cutLog);
  if (!usable.length || session.status !== "in_progress") return;
  if (!canAct && !colorHintMode) {
    // still show hint equip even when not your turn? No
    const hasHintEquip = usable.some((e) => e.type === "blueHint" || e.type === "yellowHint");
    if (!hasHintEquip) return;
  }
  usable.forEach((eq) => {
    const btn = document.createElement("button");
    btn.className = "btn-equipment";
    if (eq.type === "skip") {
      btn.textContent = `Use Equipment (unlocks on ${eq.unlockValue}s) — Skip your turn`;
      btn.title = `Unlocked after 4 cuts of ${eq.unlockValue}s — skip turn, pass to next player`;
      btn.disabled = !canAct;
    } else if (eq.type === "blueHint") {
      btn.textContent = `Use Equipment (unlocks on ${eq.unlockValue}s) — Blue Hint`;
      btn.title = `Unlocked after 4 cuts of ${eq.unlockValue}s — reveal one of your blue wires`;
      btn.disabled = !canAct;
    } else if (eq.type === "yellowHint") {
      btn.textContent = `Use Equipment (unlocks on ${eq.unlockValue}s) — Yellow Hint`;
      btn.title = `Unlocked after 4 cuts of ${eq.unlockValue}s — reveal one of your yellow wires`;
      btn.disabled = !canAct;
    } else {
      const atZero = (session.public.detonator?.position || 0) <= 0;
      btn.textContent = `Use Equipment (unlocks on ${eq.unlockValue}s) — Defuse one mistake`;
      btn.title = atZero ? "Detonator already at 0" : `Unlocked after 4 cuts of ${eq.unlockValue}s — reduces detonator by 1`;
      btn.disabled = !canAct && eq.type === "defuse" ? atZero : !canAct;
    }
    btn.addEventListener("click", () => useEquipment(eq.id));
    wrap.appendChild(btn);
  });
}

function renderHints() {
  const list = document.getElementById("hints-list");
  if (!list || !session) return;
  list.innerHTML = "";
  const hintsEnabled = session.config?.hintsEnabled ?? true;
  const hints = session.public.hints || {};
  const infoTokens = session.public.infoTokens || {};
  const players = session.public.players || {};
  if (!hintsEnabled) {
    list.innerHTML = `<span class="muted" style="font-size:0.82rem;">Hints disabled for this game.</span>`;
    Object.values(infoTokens).forEach((tok) => {
      const owner = players[tok.ownerId];
      const chip = document.createElement("span");
      chip.className = "hint-chip hint-chip--wrong";
      const wasLabel = tok.type === "red" ? "RED" : tok.type === "yellow" ? "YELLOW" : (tok.value ?? tok.guessKey ?? "—");
      chip.textContent = `${owner ? owner.name : "Wire"} ${tok.position + 1} was ${wasLabel}`;
      chip.title = `Wrong guess revealed`;
      list.appendChild(chip);
    });
    return;
  }
  const order = session.public.hintOrder || session.turnOrder || Object.keys(players);
  order.forEach((pid) => {
    const p = players[pid];
    if (!p) return;
    const h = hints[pid];
    const chip = document.createElement("span");
    if (h) {
      chip.className = "hint-chip";
      chip.textContent = `${p.name}: ${h.position + 1} is ${h.value}`;
      chip.title = `Factual hint — wire ${h.position + 1} is ${h.value}`;
    } else {
      chip.className = "hint-chip hint-chip--pending";
      chip.textContent = `${p.name}: —`;
      chip.title = "Awaiting blue hint";
    }
    list.appendChild(chip);
  });
  Object.values(infoTokens).forEach((tok) => {
    const owner = players[tok.ownerId];
    const chip = document.createElement("span");
    chip.className = "hint-chip hint-chip--wrong";
    const wasLabel = tok.type === "red" ? "RED" : tok.type === "yellow" ? "YELLOW" : (tok.value ?? tok.guessKey ?? "—");
    chip.textContent = `${owner ? owner.name : "Wire"} ${tok.position + 1} was ${wasLabel}`;
    chip.title = `Wrong guess revealed`;
    list.appendChild(chip);
  });
  if (!Object.keys(hints).length && !Object.keys(infoTokens).length) {
    list.innerHTML = `<span class="muted" style="font-size:0.82rem;">No hints yet — each player gives one blue hint in turn order before guessing.</span>`;
  }
}

function renderHintActions(isMyHintTurn) {
  const wrap = document.getElementById("hint-actions");
  if (!wrap || !session) return;
  wrap.innerHTML = "";
  const hintsEnabled = session.config?.hintsEnabled ?? true;
  if (!hintsEnabled) return;
  const hints = session.public.hints || {};
  const hintOrder = session.public.hintOrder || session.turnOrder || [];
  const hintIndex = session.public.hintIndex ?? 0;
  const playerCount = Object.keys(session.public.players || {}).length;
  const hintCount = Object.keys(hints).length;
  const isHintPhase = hintsEnabled && session.status === "in_progress" && hintCount < playerCount && playerCount >= 2;
  if (!isHintPhase) return;
  if (isMyHintTurn) {
    const info = document.createElement("div");
    info.className = "muted";
    info.style.fontSize = "0.85rem";
    info.style.marginBottom = "0.4rem";
    info.textContent = "Tap a blue wire above to give your factual hint (one per game).";
    wrap.appendChild(info);
  } else {
    const nextName = hintOrder[hintIndex] ? session.public.players?.[hintOrder[hintIndex]]?.name : null;
    const info = document.createElement("div");
    info.className = "muted";
    info.style.fontSize = "0.85rem";
    info.textContent = nextName ? `Waiting for ${nextName}'s hint…` : "Waiting for hints…";
    wrap.appendChild(info);
  }
}

async function submitHint(position) {
  if (!session || session.status !== "in_progress") return;
  if (!(session.config?.hintsEnabled ?? true)) return;
  const hints = session.public.hints || {};
  const hintOrder = session.public.hintOrder || session.turnOrder || [];
  const hintIndex = session.public.hintIndex ?? 0;
  if (hints[playerId]) return;
  if (hintOrder[hintIndex] !== playerId) return;
  const myHand = session.hands && session.hands[playerId];
  if (!isBlueHintValid(myHand, position, session.config?.wireCount)) {
    alert("Hint must be a blue wire — yellow and red cannot be hinted. Pick another blue wire.");
    return;
  }
  const wire = myHand[position];
  const updates = {};
  updates[`public/hints/${playerId}`] = {
    position,
    value: wire.value,
    guessKey: wire.value,
    type: "blue",
    at: Date.now(),
  };
  updates["public/hintIndex"] = hintIndex + 1;
  await update(ref(db, `sessions/${code}`), updates);
}

async function useEquipment(equipmentId) {
  if (!session || session.status !== "in_progress") return;
  const usable = getUsableEquipment(session.public.equipment, session.public.cutLog);
  const eq = usable.find((e) => e.id === equipmentId);
  if (!eq) return;
  if (eq.type === "blueHint" || eq.type === "yellowHint") {
    colorHintMode = { eqId: equipmentId, type: eq.type };
    render();
    return;
  }
  const updates = {};
  updates[`public/equipment/${equipmentId}/used`] = true;
  updates[`public/equipment/${equipmentId}/unlocked`] = true;
  if (eq.type === "skip") {
    updates.currentTurn = nextTurn();
  } else {
    const pos = session.public.detonator?.position || 0;
    if (pos <= 0) return;
    updates["public/detonator/position"] = Math.max(0, pos - 1);
  }
  await update(ref(db, `sessions/${code}`), updates);
  if (eq.type === "skip") checkWin();
}

async function submitColorHint(position) {
  if (!colorHintMode) return;
  const myHand = session.hands && session.hands[playerId];
  const wire = myHand && myHand[position];
  if (!wire || wire.cut) return;
  if (colorHintMode.type === "blueHint" && wire.type !== "blue") return;
  if (colorHintMode.type === "yellowHint" && wire.type !== "yellow") return;
  const eqId = colorHintMode.eqId;
  const stamp = Date.now();
  const updates = {};
  updates[`public/equipment/${eqId}/used`] = true;
  updates[`public/equipment/${eqId}/unlocked`] = true;
  updates[`public/colorHints/hint_${stamp}`] = {
    ownerId: playerId,
    position,
    type: wire.type,
    value: wire.value,
    guessKey: wire.guessKey,
    by: playerId,
    at: stamp,
  };
  colorHintMode = null;
  await update(ref(db, `sessions/${code}`), updates);
  render();
}

let lastOutcomeAt = 0;
let resultHideTimer = null;
function renderGuessResult() {
  const el = document.getElementById("guess-result");
  if (!el || !session) return;
  const outcome = session.lastOutcome;
  if (outcome && outcome.at && Date.now() - outcome.at < 4200) {
    if (outcome.at === lastOutcomeAt) return; 
    lastOutcomeAt = outcome.at;
    const guesser = session.public.players?.[outcome.by]?.name || "Someone";
    const target = session.public.players?.[outcome.target]?.name || "teammate";
    const keyLabel = outcome.guessKey === "yellow" ? "Yellow" : outcome.guessKey != null ? String(outcome.guessKey) : "—";
    const isForMe = outcome.by === playerId || outcome.target === playerId;
    el.className = "guess-result " + (outcome.correct ? "guess-result--correct" : "guess-result--wrong");
    el.innerHTML = (outcome.correct ? "✓ Correct!" : "✕ Wrong!") +
      `<span class="guess-result__sub">${guesser} → ${target} · guessed ${keyLabel} on wire ${outcome.position + 1}${isForMe ? "" : ""}</span>`;
    el.classList.remove("hidden");
    if (resultHideTimer) clearTimeout(resultHideTimer);
    resultHideTimer = setTimeout(() => el.classList.add("hidden"), 3800);
  } else if (!outcome || Date.now() - (outcome.at || 0) >= 4200) {
    if (el && !el.classList.contains("hidden") && outcome && outcome.at === lastOutcomeAt) {
    } else if (el) {
      el.classList.add("hidden");
    }
  }
}

function submitGuess(guessKey) {
  const { targetId, position } = activeGuess;
  activeGuess = null;
  update(ref(db, `sessions/${code}`), {
    pendingGuess: { by: playerId, target: targetId, position, guessKey, action: "duo" },
    [`public/pendingSelections/${playerId}`]: null,
  });
}

async function resolvePendingGuess(guess) {
  const myHand = session.hands[playerId];
  const wire = myHand[guess.position];

  if (!wire || wire.cut) {
    await update(ref(db, `sessions/${code}`), { pendingGuess: null });
    return;
  }

  const correct = String(wire.guessKey) === String(guess.guessKey);
  const stamp = Date.now();

  const updates = { pendingGuess: null, [`public/pendingSelections/${guess.by}`]: null };
  updates[`public/cutLog/log_${stamp}`] = {
    ownerId: playerId,
    position: guess.position,
    type: wire.type,
    value: wire.value ?? wire.guessKey,
    guessKey: wire.guessKey,
    guessedBy: guess.by,
    result: correct ? "cut" : "wrong",
    action: "duo",
  };

  let newDetonatorPos = session.public.detonator.position;
  const isRed = wire.type === "red";
  if (isRed) {
    updates.status = "lost";
    updates[`public/detonator/position`] = session.public.detonator.max;
  } else if (correct) {
    updates[`hands/${playerId}/${guess.position}/cut`] = true;
  } else {
    updates[`public/infoTokens/info_${stamp}`] = {
      ownerId: playerId, position: guess.position, type: wire.type, value: wire.value ?? wire.guessKey, guessKey: wire.guessKey,
    };
    newDetonatorPos += 1;
    updates[`public/detonator/position`] = newDetonatorPos;
  }

  updates.lastOutcome = {
    by: guess.by, target: playerId, correct: isRed ? false : correct, guessKey: wire.guessKey,
    position: guess.position, acknowledged: false, at: stamp, isRed,
  };

  if (!isRed && newDetonatorPos >= session.public.detonator.max) {
    updates.status = "lost";
  }

  await update(ref(db, `sessions/${code}`), updates);
}

async function reactToOutcome(outcome) {
  const updates = { "lastOutcome/acknowledged": true };

  if (outcome.correct) {
    const myHand = session.hands[playerId];
    const idx = myHand.findIndex((w) => String(w.guessKey) === String(outcome.guessKey) && !w.cut);
    if (idx > -1) updates[`hands/${playerId}/${idx}/cut`] = true;
  }

  if (session.status !== "lost") {
    updates.currentTurn = nextTurn();
  }

  await update(ref(db, `sessions/${code}`), updates);
  checkWin();
}

async function performSoloCut(guessKeyOrKeys) {
  const keys = Array.isArray(guessKeyOrKeys) ? guessKeyOrKeys : [guessKeyOrKeys];
  const myHand = session.hands[playerId];
  const stamp = Date.now();
  const updates = {};

  myHand.forEach((wire, i) => {
    if (keys.some((k) => String(wire.guessKey) === String(k)) && !wire.cut) {
      updates[`hands/${playerId}/${i}/cut`] = true;
      updates[`public/cutLog/log_${stamp}_${i}`] = {
        ownerId: playerId, position: i, type: wire.type, value: wire.value ?? wire.guessKey, guessKey: wire.guessKey,
        guessedBy: playerId, result: "cut", action: "solo",
      };
    }
  });
  keys.forEach((k) => { updates[`public/validationTokens/${k}`] = true; });
  updates.currentTurn = nextTurn();

  await update(ref(db, `sessions/${code}`), updates);
  checkWin();
}

async function revealRedWires() {
  const myHand = session.hands[playerId];
  const stamp = Date.now();
  const updates = {};

  myHand.forEach((wire, i) => {
    if (wire.type === "red" && !wire.cut) {
      updates[`hands/${playerId}/${i}/cut`] = true;
      updates[`public/cutLog/log_${stamp}_${i}`] = {
        ownerId: playerId, position: i, type: "red", value: null, guessKey: null,
        guessedBy: playerId, result: "cut", action: "reveal_red",
      };
    }
  });
  updates.currentTurn = nextTurn();

  await update(ref(db, `sessions/${code}`), updates);
  checkWin();
}

function nextTurn() {
  const order = session.turnOrder;
  if (!order || order.length === 0) return playerId;
  const startIdx = order.indexOf(playerId);
  if (startIdx === -1) return order[0];
  for (let step = 1; step <= order.length; step++) {
    const nextId = order[(startIdx + step) % order.length];
    const hand = session.hands && session.hands[nextId];
    if (!hand || !isHandFullyCut(hand)) return nextId;
  }
  return order[(startIdx + 1) % order.length];
}

async function checkWin() {
  const allNonRedCut = Object.values(session.hands).every((hand) => hand.filter((w) => w.type !== "red").every((w) => w.cut));
  const hasNonRed = Object.values(session.hands).some((hand) => hand.some((w) => w.type !== "red"));
  const allRedLast = Object.values(session.hands).every((hand) => {
    const remaining = hand.filter((w) => !w.cut);
    return remaining.length === 0 || remaining.every((w) => w.type === "red");
  });
  if (hasNonRed && allNonRedCut && allRedLast) await update(ref(db, `sessions/${code}`), { status: "won" });
}

function toggleWinOverlay(session) {
  const existing = document.getElementById("win-overlay");
  const isWon = session.status === "won";
  const isLost = session.status === "lost";
  if (!isWon && !isLost) { if (existing) existing.remove(); return; }
  let overlay = existing;
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "win-overlay";
    overlay.className = "win-overlay" + (isLost ? " win-overlay--loss" : "");
    const confetti = document.createElement("div");
    confetti.className = "win-overlay__confetti";
    const emojis = isLost ? ["💥","💣","🔥"] : ["🎉","✨","🎊","⭐","🎈"];
    for (let i = 0; i < 28; i++) {
      const s = document.createElement("span");
      s.textContent = emojis[i % emojis.length];
      s.style.left = Math.random() * 100 + "%";
      s.style.animationDuration = (2.2 + Math.random() * 2.2) + "s";
      s.style.animationDelay = Math.random() * 1.2 + "s";
      confetti.appendChild(s);
    }
    overlay.appendChild(confetti);
    const stars = document.createElement("div");
    stars.className = "win-overlay__stars";
    stars.textContent = isLost ? "💥 💣 💥" : "✨ 🎉 ✨";
    overlay.appendChild(stars);
    const title = document.createElement("div");
    title.className = "win-overlay__title";
    title.textContent = isLost ? "BOOM!" : "WIN!";
    overlay.appendChild(title);
    const sub = document.createElement("div");
    sub.className = "win-overlay__subtitle";
    sub.textContent = isLost ? "Bomb exploded" : "Mission complete!";
    overlay.appendChild(sub);
    const actions = document.createElement("div");
    actions.className = "win-overlay__actions";
    const dismissBtn = document.createElement("button");
    dismissBtn.className = "win-overlay__btn win-overlay__btn--ghost";
    dismissBtn.textContent = "Dismiss";
    dismissBtn.onclick = () => overlay.remove();
    actions.appendChild(dismissBtn);
    overlay.appendChild(actions);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  } else {
    overlay.className = "win-overlay" + (isLost ? " win-overlay--loss" : "");
    const t = overlay.querySelector(".win-overlay__title");
    if (t) t.textContent = isLost ? "BOOM!" : "WIN!";
  }
}