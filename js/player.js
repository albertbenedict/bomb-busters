import { db } from "./firebase-config.js";
import {
  ref, onValue, update, onDisconnect,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { getSoloCutEligibleKey, canRevealRedWires, isHandFullyCut, getUsableEquipment, isBlueHintValid, canGiveHint, getKeyTotals, cutCountForKey } from "./game-logic.js";

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

function wireLabel(wire) {
  if (wire.type === "blue") return String(wire.value);
  if (wire.type === "yellow") return "Y";
  return "R";
}

// Track previous hand-cut state (to animate only wires that just transitioned
// to cut) and whether the hand has painted at least once (so the entrance
// animation plays only on first paint, not on every render() call — render()
// fires on every Firebase update, not just ones relevant to your own hand).
let prevHandCut = [];
let hasRenderedHand = false;

function render() {
  const myHand = (session.hands && session.hands[playerId]) || [];

  const hints = session.public.hints || {};
  const hintOrder = session.public.hintOrder || session.turnOrder || [];
  const hintIndex = session.public.hintIndex ?? 0;
  const playerCount = Object.keys(session.public.players || {}).length;
  const hintCount = Object.keys(hints).length;
  const isHintPhase = session.status === "in_progress" && hintCount < playerCount && playerCount >= 2;
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
    // During hint phase, make own blue wires hintable
    const hintable = isMyHintTurn && wire.type === "blue" && !wire.cut;
    div.className = `wire wire--${wire.type}` + (nowCut ? " cut" : "") + extra + (hintable ? " wire--hintable" : "");
    div.textContent = wireLabel(wire);
    if (hintable) {
      div.style.cursor = "pointer";
      div.title = `Hint: wire ${i + 1} is ${wire.value}`;
      div.addEventListener("click", () => submitHint(i));
    }
    handEl.appendChild(div);
  });
  prevHandCut = myHand.map((w) => !!w.cut);
  if (myHand.length > 0) hasRenderedHand = true;

  const countBadge = document.getElementById("hand-count-badge");
  if (countBadge) {
    const remaining = myHand.filter((w) => !w.cut).length;
    countBadge.textContent = myHand.length ? `${remaining} left · ${myHand.length} total` : "—";
  }

  // Hint phase overrides normal turn banner
  const canAct = !isHintPhase && session.currentTurn === playerId && session.status === "in_progress";
  // Turn banner — prominent, names whose turn it is
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

  // During hint phase, disable normal guess actions
  const effectiveCanAct = isHintPhase ? false : canAct;
  renderTargets(effectiveCanAct);
  renderGuessComposer(effectiveCanAct);
  // Hints render inside guess composer area? Keep separate
  renderHints();
  renderHintActions(isMyHintTurn);

  const soloKey = getSoloCutEligibleKey(myHand, session.public.cutLog, session.config);
  const soloBtn = document.getElementById("solo-btn");
  soloBtn.classList.toggle("hidden", !(soloKey !== null && canAct));
  soloBtn.textContent = soloKey === "yellow" ? "Solo cut your yellows" : `Solo cut your ${soloKey}s`;
  soloBtn.onclick = () => performSoloCut(soloKey);

  const canReveal = canRevealRedWires(myHand);
  const revealBtn = document.getElementById("reveal-red-btn");
  revealBtn.classList.toggle("hidden", !(canReveal && canAct));
  revealBtn.onclick = () => revealRedWires();

  renderEquipment(canAct);

  // Guess result — brief Correct! / Wrong! for both guesser and target
  renderGuessResult();

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

    // Factual blue hint + wrong reveals for this teammate
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
    // Wrong auto-hints for this owner only (target was this player)
    const infoTokens = session.public.infoTokens || {};
    const wrongs = Object.values(infoTokens).filter((t) => t.ownerId === id);
    if (wrongs.length) {
      const wrongRow = document.createElement("div");
      wrongRow.className = "hint-row";
      wrongs.forEach((tok) => {
        const chip = document.createElement("span");
        chip.className = "hint-chip hint-chip--wrong";
        chip.textContent = `${tok.position + 1} was ${tok.value ?? tok.guessKey}`;
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
          activeGuess = { targetId: id, targetName: p.name, position: pos };
          render();
        });
      }
      rack.appendChild(btn);
    }
    group.appendChild(rack);
    targetsEl.appendChild(group);
  });
}

// Inline value picker — numbers plus a Yellow option. Red is never
// guessable here; it only clears via the "reveal red wires" action.
// Rule: you can only guess a value you actually hold (uncut) in your own hand.
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
    render();
  };
}

function renderEquipment(canAct) {
  const wrap = document.getElementById("equipment-actions");
  if (!wrap || !session) return;
  wrap.innerHTML = "";
  const usable = getUsableEquipment(session.public.equipment, session.public.cutLog);
  if (!usable.length || !canAct || session.status !== "in_progress") return;
  // Free safety-net: doesn't end turn, just defuses detonator by 1 (min 0)
  const atZero = (session.public.detonator?.position || 0) <= 0;
  usable.forEach((eq) => {
    const btn = document.createElement("button");
    btn.className = "btn-equipment";
    btn.textContent = `Use Equipment (unlocks on ${eq.unlockValue}s) — Defuse one mistake`;
    btn.disabled = atZero;
    btn.title = atZero ? "Detonator already at 0" : `Unlocked after 2 cuts of ${eq.unlockValue}s — reduces detonator by 1`;
    btn.addEventListener("click", () => useEquipment(eq.id));
    wrap.appendChild(btn);
  });
}

function renderHints() {
  const list = document.getElementById("hints-list");
  if (!list || !session) return;
  list.innerHTML = "";
  const hints = session.public.hints || {};
  const infoTokens = session.public.infoTokens || {};
  const players = session.public.players || {};
  // Factual hints in turnOrder
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
  // Wrong auto-reveals as "was" (target only)
  Object.values(infoTokens).forEach((tok) => {
    const owner = players[tok.ownerId];
    const chip = document.createElement("span");
    chip.className = "hint-chip hint-chip--wrong";
    chip.textContent = `${owner ? owner.name : "Wire"} ${tok.position + 1} was ${tok.value ?? tok.guessKey}`;
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
  const hints = session.public.hints || {};
  const hintOrder = session.public.hintOrder || session.turnOrder || [];
  const hintIndex = session.public.hintIndex ?? 0;
  const playerCount = Object.keys(session.public.players || {}).length;
  const hintCount = Object.keys(hints).length;
  const isHintPhase = session.status === "in_progress" && hintCount < playerCount && playerCount >= 2;
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
  const hints = session.public.hints || {};
  const hintOrder = session.public.hintOrder || session.turnOrder || [];
  const hintIndex = session.public.hintIndex ?? 0;
  if (hints[playerId]) return; // already given
  if (hintOrder[hintIndex] !== playerId) return; // strict order
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
  const pos = session.public.detonator?.position || 0;
  if (pos <= 0) return;
  // Re-check usable (guard against stale UI / double-click)
  const usableIds = new Set(getUsableEquipment(session.public.equipment, session.public.cutLog).map((e) => e.id));
  if (!usableIds.has(equipmentId)) return;
  const updates = {};
  updates[`public/equipment/${equipmentId}/used`] = true;
  updates[`public/equipment/${equipmentId}/unlocked`] = true;
  updates["public/detonator/position"] = Math.max(0, pos - 1);
  await update(ref(db, `sessions/${code}`), updates);
  // No turn change — free action
}

let lastOutcomeAt = 0;
let resultHideTimer = null;
function renderGuessResult() {
  const el = document.getElementById("guess-result");
  if (!el || !session) return;
  const outcome = session.lastOutcome;
  // Show for 4s after lastOutcome.at — visible to guesser, target, and spectators
  if (outcome && outcome.at && Date.now() - outcome.at < 4200) {
    if (outcome.at === lastOutcomeAt) return; // already showing this one
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
    // keep last shown until timeout, don't flicker
    if (el && !el.classList.contains("hidden") && outcome && outcome.at === lastOutcomeAt) {
      // let timer hide it
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
  });
}

// Runs only on the target's device — this is the one place a wire's
// real value ever gets compared, and it happens on the device that's
// already allowed to know it.
async function resolvePendingGuess(guess) {
  const myHand = session.hands[playerId];
  const wire = myHand[guess.position];

  if (!wire || wire.cut) {
    // Already resolved (stale click, or the UI just hasn't caught up yet) — no-op.
    await update(ref(db, `sessions/${code}`), { pendingGuess: null });
    return;
  }

  // Normalize for yellow — both should be "yellow" string, blues are numbers (handle string/number coerce)
  const correct = String(wire.guessKey) === String(guess.guessKey);
  const stamp = Date.now();
  console.log("[resolve] guess", guess, "wire", wire, "correct", correct);

  const updates = { pendingGuess: null };
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
  if (correct) {
    updates[`hands/${playerId}/${guess.position}/cut`] = true;
  } else {
    updates[`public/infoTokens/info_${stamp}`] = {
      ownerId: playerId, position: guess.position, type: wire.type, value: wire.value ?? wire.guessKey, guessKey: wire.guessKey,
    };
    newDetonatorPos += 1;
    updates[`public/detonator/position`] = newDetonatorPos;
  }

  updates.lastOutcome = {
    by: guess.by, target: playerId, correct, guessKey: wire.guessKey,
    position: guess.position, acknowledged: false, at: stamp,
  };

  if (newDetonatorPos >= session.public.detonator.max) {
    updates.status = "lost";
  }

  await update(ref(db, `sessions/${code}`), updates);
}

// Runs on the guesser's device — the only device that knows which of
// its own wires matches the guessed key.
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

async function performSoloCut(guessKey) {
  const myHand = session.hands[playerId];
  const stamp = Date.now();
  const updates = {};

  const totals = getKeyTotals(session.config);
  const total = totals[guessKey] ?? 4;
  const remaining = total - cutCountForKey(session.public.cutLog, guessKey);
  const inHand = myHand.filter((w) => String(w.guessKey) === String(guessKey) && !w.cut).length;

  // All 4 from start (remaining === total) → bulk cut all at once
  // Has all remaining but not all 4 (remaining < total) → single per turn
  if (remaining === total && inHand === total) {
    myHand.forEach((wire, i) => {
      if (String(wire.guessKey) === String(guessKey) && !wire.cut) {
        updates[`hands/${playerId}/${i}/cut`] = true;
        updates[`public/cutLog/log_${stamp}_${i}`] = {
          ownerId: playerId, position: i, type: wire.type, value: wire.value ?? wire.guessKey, guessKey,
          guessedBy: playerId, result: "cut", action: "solo",
        };
      }
    });
  } else {
    const idx = myHand.findIndex((w) => String(w.guessKey) === String(guessKey) && !w.cut);
    if (idx !== -1) {
      const wire = myHand[idx];
      updates[`hands/${playerId}/${idx}/cut`] = true;
      updates[`public/cutLog/log_${stamp}`] = {
        ownerId: playerId, position: idx, type: wire.type, value: wire.value ?? wire.guessKey, guessKey,
        guessedBy: playerId, result: "cut", action: "solo",
      };
    }
  }
  updates[`public/validationTokens/${guessKey}`] = true;
  updates.currentTurn = nextTurn();

  await update(ref(db, `sessions/${code}`), updates);
  checkWin();
}

// Cuts every remaining red wire in hand at once — safe by definition,
// since it's only offered once 100% of what's left in the hand is red.
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
  const allCut = Object.values(session.hands).every(isHandFullyCut);
  if (allCut) await update(ref(db, `sessions/${code}`), { status: "won" });
}
