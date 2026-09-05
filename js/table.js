import { db } from "./firebase-config.js";
import {
  ref, update, get, onValue, set,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { watchSession } from "./session.js";
import { buildDeck, dealHands, generateEquipment, getKeyTotals, cutCountForKey } from "./game-logic.js";

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

function polar(cx, cy, r, deg) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
function segmentPath(cx, cy, r, startDeg, endDeg) {
  const start = polar(cx, cy, r, startDeg);
  const end = polar(cx, cy, r, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y} Z`;
}
// Cat head path — white outline on black in source, filled black on dial segments
const CAT_HEAD_D = "M -9 -7 C -9 -7 -7 -13 0 -8 C 7 -13 9 -7 9 -7 L 7 6 C 7 9 4 12 0 12 C -4 12 -7 9 -7 6 Z";

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

// Room code
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

let prevDetonatorPosition = null;

function render(session) {
  const players = session.public.players || {};
  const slots = document.querySelectorAll(".board-player-slot");
  const hiddenList = document.getElementById("players");
  if (hiddenList) hiddenList.innerHTML = "";
  const allEntries = Object.entries(players);
  const entries = allEntries.slice(0, 5);
  // Map slots by data-slot for 5P layout (0,1,2,3 left/right, 4 center)
  const slotsByIdx = {};
  slots.forEach((el) => {
    const idx = Number(el.dataset.slot);
    slotsByIdx[idx] = el;
    el.innerHTML = "";
    el.classList.add("hidden");
  });
  // Show only needed slots — per-wire board with hint houses below each wire
  const hints = session.public.hints || {};
  const infoTokens = session.public.infoTokens || {};
  const hands = session.hands || {};
  entries.forEach(([id, p], idx) => {
    const isActive = session.currentTurn === id && session.status === "in_progress";
    const card = document.createElement("div");
    card.className = "card player-board" + (isActive ? " card--active" : "");
    card.style.marginBottom = "0";
    const head = document.createElement("div");
    head.style.display = "flex";
    head.style.justifyContent = "space-between";
    head.style.alignItems = "flex-start";
    head.style.marginBottom = "0.35rem";
    const nameEl = document.createElement("div");
    nameEl.style.fontFamily = "'Space Grotesk', sans-serif";
    nameEl.style.fontWeight = isActive ? "800" : "700";
    nameEl.style.fontSize = "0.95rem";
    nameEl.textContent = p.name;
    head.appendChild(nameEl);
    if (isActive) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "Turn";
      head.appendChild(badge);
    }
    card.appendChild(head);

    // Wires row — quantity = dealt count, face-down black until revealed
    const tray = document.createElement("div");
    tray.className = "player-tray";
    const hand = hands[id] || [];
    for (let pos = 0; pos < p.wireCount; pos++) {
      const w = hand[pos];
      const isCut = !!(w && w.cut);
      const wrap = document.createElement("div");
      wrap.className = "wire-wrap";
      const tile = document.createElement("div");
      // All face-down look identical until revealed/cut
      if (isCut) {
        tile.className = `wire-tile wire-tile--revealed wire-tile--${w.type}`;
        tile.textContent = w.type === "yellow" ? "Y" : w.type === "red" ? "R" : String(w.value ?? "");
      } else {
        tile.className = "wire-tile wire-tile--down";
        tile.innerHTML = `<span class="wire-line"></span>`;
      }
      wrap.appendChild(tile);
      // Hint house below this wire — only after hint phase, same number as wire above, disappears on cut
      if (!isCut) {
        const myHint = hints[id];
        const wrong = Object.values(infoTokens).find((t) => t.ownerId === id && t.position === pos);
        let houseVal = null;
        let houseKind = null;
        if (myHint && myHint.position === pos) {
          houseVal = myHint.value;
          houseKind = "is";
        } else if (wrong) {
          houseVal = wrong.type === "red" ? "R" : wrong.type === "yellow" ? "Y" : (wrong.value ?? wrong.guessKey);
          houseKind = "was";
        }
        if (houseVal !== null) {
          const house = document.createElement("div");
          house.className = `hint-house ${houseKind === "was" ? "hint-house--was" : ""}`;
          house.textContent = String(houseVal);
          house.title = houseKind === "is" ? `Hint: ${pos + 1} is ${houseVal}` : `Was ${houseVal}`;
          wrap.appendChild(house);
        }
      }
      tray.appendChild(wrap);
    }
    if (p.wireCount === 0) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.style.fontSize = "0.82rem";
      empty.textContent = "No wires yet — waiting for deal";
      tray.appendChild(empty);
    }
    card.appendChild(tray);

    const foot = document.createElement("div");
    foot.style.display = "flex";
    foot.style.justifyContent = "space-between";
    foot.style.alignItems = "center";
    foot.style.marginTop = "0.4rem";
    const meta = document.createElement("div");
    meta.className = "muted";
    meta.style.fontSize = "0.78rem";
    meta.textContent = p.connected === false ? "Offline" : `${p.wireCount} wires`;
    foot.appendChild(meta);
    const kickBtn = document.createElement("button");
    kickBtn.textContent = "Kick";
    kickBtn.className = "danger";
    kickBtn.style.padding = "0.18rem 0.45rem";
    kickBtn.style.fontSize = "0.7rem";
    kickBtn.style.opacity = "0.72";
    kickBtn.onclick = () => kickPlayer(id, p.name);
    foot.appendChild(kickBtn);
    card.appendChild(foot);

    const slot = slotsByIdx[idx];
    if (slot) {
      slot.classList.remove("hidden");
      slot.appendChild(card);
    }
    if (hiddenList) {
      const li = document.createElement("li");
      li.textContent = p.name;
      hiddenList.appendChild(li);
    }
  });

  // Empty placeholders for missing players among the 4 corners (hide 5th if not needed)
  const maxSlots = entries.length === 5 ? 5 : 4;
  for (let i = entries.length; i < maxSlots; i++) {
    const slot = slotsByIdx[i];
    if (slot) {
      slot.classList.remove("hidden");
      slot.innerHTML = `<div class="card" style="opacity:0.45; text-align:center;"><p class="muted">Empty</p><p class="muted" style="font-size:0.75rem;">Waiting for player</p></div>`;
    }
  }
  // Hide 5th center slot when <5 players
  if (slotsByIdx[4] && entries.length < 5) slotsByIdx[4].classList.add("hidden");

  if (allEntries.length > 5) {
    console.warn("More than 5 players — truncating to 5");
  }

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


  // Old meter now hidden — using 6-segment dial
  const meterEl = document.getElementById("detonator-meter");
  if (meterEl) meterEl.innerHTML = "";
  // Detonator dial — 6 segments matching the reference image (cats 2-3, skull, arrow)
  const dialSvg = document.getElementById("detonator-dial-svg");
  const needle = document.getElementById("detonator-needle");
  if (dialSvg) {
    dialSvg.innerHTML = "";
    const SEGMENTS = 6;
    // Colors matching the reference: light green, yellow, orange, red, purple, green
    const colors = ["#f1c40f", "#f39c12", "#c0392b", "#7d3c98", "#2ecc71", "#a8e063"];
    const catCounts = [2, 2, 0, 0, 3, 2]; // per segment: 0:top(2),1:top-right(2),2:right skull,3:bottom-right arrow,4:bottom-left green 3,5:left 2
    const segAngle = 360 / SEGMENTS;
    for (let i = 0; i < SEGMENTS; i++) {
      const color = colors[i];
      const startDeg = (i * segAngle) - 90;
      const endDeg = ((i + 1) * segAngle) - 90;
      const path = segmentPath(50, 50, 48, startDeg, endDeg);
      const seg = document.createElementNS("http://www.w3.org/2000/svg", "path");
      seg.setAttribute("d", path);
      seg.setAttribute("fill", color);
      seg.setAttribute("stroke", "#0f1f1a");
      seg.setAttribute("stroke-width", "0.8");
      const isPast = i < detonator.position;
      seg.setAttribute("opacity", isPast ? "0.55" : "1");
      dialSvg.appendChild(seg);
      const count = catCounts[i];
      if (count > 0) {
        const midDeg = (startDeg + endDeg) / 2;
        for (let c = 0; c < count; c++) {
          const offsetAng = count === 1 ? 0 : ((c - (count - 1) / 2) * 7);
          const offsetR = c % 2 === 0 ? 0 : -5;
          const ang = midDeg + offsetAng;
          const r = 28 + offsetR;
          const pos = polar(50, 50, r, ang);
          const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
          const pathEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
          pathEl.setAttribute("d", CAT_HEAD_D);
          pathEl.setAttribute("fill", "#1a1a1a");
          pathEl.setAttribute("stroke", "#f5d76e");
          pathEl.setAttribute("stroke-width", "0.5");
          pathEl.setAttribute("opacity", "0.7");
          g.setAttribute("transform", `translate(${pos.x} ${pos.y}) scale(0.34)`);
          g.appendChild(pathEl);
          dialSvg.appendChild(g);
        }
      } else if (i === 2) {
        // Red segment — skull
        const midDeg = (startDeg + endDeg) / 2;
        const pos = polar(50, 50, 28, midDeg);
        const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
        txt.setAttribute("x", pos.x);
        txt.setAttribute("y", pos.y);
        txt.setAttribute("text-anchor", "middle");
        txt.setAttribute("dominant-baseline", "central");
        txt.setAttribute("font-size", "13");
        txt.setAttribute("fill", "white");
        txt.textContent = "☠";
        dialSvg.appendChild(txt);
      } else if (i === 3) {
        // Purple segment — arrow + triangle (bottom right)
        const midDeg = (startDeg + endDeg) / 2;
        const pos = polar(50, 50, 28, midDeg);
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.setAttribute("transform", `translate(${pos.x} ${pos.y})`);
        const arrow = document.createElementNS("http://www.w3.org/2000/svg", "path");
        arrow.setAttribute("d", "M -8 -4 L 6 -4 L 6 -7 L 12 0 L 6 7 L 6 4 L -8 4 Z");
        arrow.setAttribute("fill", "#aed6f1");
        arrow.setAttribute("stroke", "#1a1a1a");
        arrow.setAttribute("stroke-width", "0.6");
        arrow.setAttribute("transform", "scale(0.9)");
        g.appendChild(arrow);
        const tri = document.createElementNS("http://www.w3.org/2000/svg", "path");
        tri.setAttribute("d", "M -4 6 L 4 6 L 0 -6 Z");
        tri.setAttribute("fill", "#f9e79f");
        tri.setAttribute("stroke", "#1a1a1a");
        tri.setAttribute("stroke-width", "0.6");
        tri.setAttribute("transform", "translate(0 10) scale(0.9)");
        g.appendChild(tri);
        // Small exclamation inside triangle
        const excl = document.createElementNS("http://www.w3.org/2000/svg", "text");
        excl.setAttribute("x", "0");
        excl.setAttribute("y", "8");
        excl.setAttribute("text-anchor", "middle");
        excl.setAttribute("font-size", "6");
        excl.setAttribute("fill", "#1a1a1a");
        excl.textContent = "!";
        g.appendChild(excl);
        dialSvg.appendChild(g);
      }
    }
    const center = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    center.setAttribute("cx", "50");
    center.setAttribute("cy", "50");
    center.setAttribute("r", "8.5");
    center.setAttribute("fill", "#0f1f1a");
    center.setAttribute("stroke", "#e8ecef");
    center.setAttribute("stroke-width", "1.4");
    dialSvg.appendChild(center);
  }
  if (needle) {
    const clamped = Math.min(detonator.position, 5);
    const angle = (clamped / 6) * 360;
    needle.style.transform = `translateX(-50%) rotate(${angle}deg)`;
    needle.style.opacity = critical ? "0.9" : "1";
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

  // Wire Tracker 
  const trackerEl = document.getElementById("wire-tracker");
  if (trackerEl) {
    trackerEl.innerHTML = "";
    const totals = getKeyTotals(session.config);
    const rawCutLog = session.public.cutLog || {};
    const max = session.config.wireCount || 12;
    for (let v = 1; v <= max; v++) {
      const total = totals[v] ?? 4;
      const cut = cutCountForKey(rawCutLog, v);
      const done = cut >= total;
      const cell = document.createElement("div");
      cell.className = "tracker-cell" + (done ? " tracker-cell--done" : "");
      cell.innerHTML = `<span class="tracker-num">${v}</span><span class="tracker-dot">${done ? "●" : "○"}</span>`;
      cell.title = done ? `All ${total} × ${v}s cut` : `${cut}/${total} × ${v}s still in play`;
      trackerEl.appendChild(cell);
    }
  }

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

  // Equipment pool 
  const eqEl = document.getElementById("equipment-pool");
  if (eqEl) {
    eqEl.innerHTML = "";
    const equipment = session.public.equipment || {};
    const cutLog = session.public.cutLog || {};
    const entries = Object.entries(equipment);
    for (let i = 0; i < 5; i++) {
      const entry = entries[i];
      const chip = document.createElement("span");
      if (!entry) {
        chip.className = "eq-chip eq-chip--locked";
        chip.textContent = "—";
        chip.title = "Equipment slot — will be assigned at deal";
      } else {
        const [, e] = entry;
        const cnt = cutCountForKey(cutLog, e.unlockValue);
        const isUsed = !!e.used;
        const isUnlocked = !isUsed && cnt >= 2;
        chip.className = "eq-chip" + (isUsed ? " eq-chip--used" : isUnlocked ? " eq-chip--unlocked" : " eq-chip--locked");
        chip.textContent = isUsed ? `Used · ${e.unlockValue}s` : isUnlocked ? `Ready · ${e.unlockValue}s` : `Locked · ${e.unlockValue}s`;
        chip.title = isUsed ? `Used (unlocks on ${e.unlockValue}s)` : isUnlocked ? `Unlocked — defuse one mistake` : `Needs 2 cuts of ${e.unlockValue}s (${cnt}/2)`;
      }
      eqEl.appendChild(chip);
    }
  }

  // Hints
  const hintsEl = document.getElementById("hints-pool");
  if (hintsEl) {
    hintsEl.innerHTML = "";
    const hints = session.public.hints || {};
    const infoTokens = session.public.infoTokens || {};
    const hintOrder = session.public.hintOrder || session.turnOrder || [];
    const hintIndex = session.public.hintIndex ?? hintOrder.length;
    const totalPlayers = Object.keys(players).length;
    const hintCount = Object.keys(hints).length;
    const hintsEnabled = session.config?.hintsEnabled ?? true;
    const isHintPhase = hintsEnabled && session.status === "in_progress" && hintCount < totalPlayers && totalPlayers >= 2;
    if (!hintsEnabled) {
      hintsEl.innerHTML = `<span class="muted" style="font-size:0.82rem;">Hints disabled for this game.</span>`;
    } else if (hintCount === 0 && totalPlayers >= 2 && session.status === "lobby") {
      hintsEl.innerHTML = `<span class="muted" style="font-size:0.82rem;">Hints will appear after deal — one blue per player in turn order.</span>`;
    } else {
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
      Object.values(infoTokens).forEach((tok) => {
        const owner = players[tok.ownerId];
        const chip = document.createElement("span");
        chip.className = "hint-chip hint-chip--wrong";
        const wasLabel = tok.type === "red" ? "RED" : tok.type === "yellow" ? "YELLOW" : (tok.value ?? tok.guessKey ?? "—");
        chip.textContent = `${owner ? owner.name : "Wire"} ${tok.position + 1} was ${wasLabel}`;
        chip.title = `Wrong guess revealed — actual ${wasLabel}`;
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
  let playerIds = Object.keys(session.public.players);
  if (playerIds.length < 2) return;
  // Captain gets all remainder — reorder so captain is first
  const captainId = session.public.captainId || playerIds[0];
  if (captainId && playerIds.includes(captainId)) {
    playerIds = [captainId, ...playerIds.filter((id) => id !== captainId)];
  }
  const deck = buildDeck(session.config);
  const hands = dealHands(deck, playerIds, captainId);
  const equipment = generateEquipment(playerIds.length, session.config.wireCount);
  const hintsEnabled = session.config?.hintsEnabled ?? true;

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
  if (hintsEnabled) {
    updates["public/hints"] = {};
    updates["public/hintOrder"] = playerIds;
    updates["public/hintIndex"] = 0;
  } else {
    updates["public/hints"] = {};
    updates["public/hintOrder"] = [];
    updates["public/hintIndex"] = 0;
  }

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
  const hintOrder = (session.public?.hintOrder || session.turnOrder || []).filter((id) => id !== playerId);
  updates["public/hintOrder"] = hintOrder;
  if (session.public?.hints && session.public.hints[playerId]) {
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
