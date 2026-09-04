import { db } from "./firebase-config.js";
import {
  ref, set, get, onValue, update, onDisconnect,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";

function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} timed out after ${ms/1000}s — Firebase is unreachable. Disable Firefox Enhanced Tracking Protection (shield icon) and check Wi-Fi.`)), ms);
  });
  return Promise.race([promise.finally(() => clearTimeout(t)), timeout]);
}

// No ambiguous chars (0/O, 1/I) so a code is easy to read aloud across the table.
function generateCode(length = 4) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < length; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export async function createSession({ wireCount = 12, detonatorMax = 4, yellowCount = 4, redCount = 2 } = {}) {
  // Defensive clamp – matches index.html + rules (yellow even 2..6, red 1..3)
  yellowCount = Math.max(2, Math.min(6, Math.round(Number(yellowCount) || 4)));
  if (yellowCount % 2 !== 0) yellowCount = Math.min(6, yellowCount + 1);
  redCount = Math.max(1, Math.min(3, Math.round(Number(redCount) || 2)));
  wireCount = Math.max(4, Math.min(12, Math.round(Number(wireCount) || 12)));
  detonatorMax = Math.max(1, Math.min(10, Math.round(Number(detonatorMax) || 4)));
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    const existsSnap = await withTimeout(get(ref(db, `sessions/${code}/status`)), 8000, "Checking room code");
    if (existsSnap.exists()) continue;
    await withTimeout(set(ref(db, `sessions/${code}`), {
      status: "lobby",
      config: { wireCount, detonatorMax, yellowCount, redCount },
      turnOrder: [],
      currentTurn: null,
      pendingGuess: null,
      lastOutcome: null,
      public: {
        detonator: { position: 0, max: detonatorMax },
        cutLog: {},
        infoTokens: {},
        validationTokens: {},
        players: {},
      },
      hands: {},
    }), 8000, "Creating room");
    return code;
  }
  throw new Error("Failed to generate unique room code – please retry");
}

export async function joinSession(code, playerName, storedId = null) {
  const nameTrim = playerName.trim();

  // 1) Device-based reconnect – stored playerId for this room (localStorage).
  //    This is the correct key: "this device already has a seat here."
  if (storedId) {
    try {
      const playersSnap = await withTimeout(get(ref(db, `sessions/${code}/public/players`)), 5000, "Checking players");
      const players = playersSnap.val() || {};
      if (players[storedId]) {
        await withTimeout(update(ref(db, `sessions/${code}/public/players/${storedId}`), {
          name: nameTrim,
          connected: true,
        }), 5000, "Reconnecting");
        try { onDisconnect(ref(db, `sessions/${code}/public/players/${storedId}/connected`)).set(false); } catch {}
        const sessionSnap = await withTimeout(get(ref(db, `sessions/${code}`)), 5000, "Checking session");
        const sess = sessionSnap.val();
        if (sess && Array.isArray(sess.turnOrder) && !sess.turnOrder.includes(storedId) && sess.status === "lobby") {
          await withTimeout(update(ref(db, `sessions/${code}`), { turnOrder: [...sess.turnOrder, storedId] }), 5000, "Restoring turn");
        }
        try { localStorage.setItem(`bb-player-${code}`, storedId); localStorage.setItem(`bb-name-${code}`, nameTrim); } catch {}
        return storedId;
      }
    } catch (e) {
      console.warn("storedId reconnect failed, falling back", e);
    }
  }

  // 2) Fallback for devices that cleared storage: only reuse an *offline* seat with the same name.
  //    Never steal an active (connected:true) seat – allows two "Sam"s on different devices.
  try {
    const playersSnap = await withTimeout(get(ref(db, `sessions/${code}/public/players`)), 5000, "Checking players");
    const players = playersSnap.val() || {};
    const nameLower = nameTrim.toLowerCase();
    const offlineMatch = Object.entries(players).find(([, p]) => p && p.name && p.name.trim().toLowerCase() === nameLower && p.connected === false);
    if (offlineMatch) {
      const [offlineId] = offlineMatch;
      await withTimeout(update(ref(db, `sessions/${code}/public/players/${offlineId}`), {
        name: nameTrim,
        connected: true,
      }), 5000, "Reconnecting offline");
      try { onDisconnect(ref(db, `sessions/${code}/public/players/${offlineId}/connected`)).set(false); } catch {}
      try { localStorage.setItem(`bb-player-${code}`, offlineId); localStorage.setItem(`bb-name-${code}`, nameTrim); } catch {}
      return offlineId;
    }
  } catch (e) {
    console.warn("offline name check failed", e);
  }

  // 3) No reusable seat – create a fresh playerId (allows duplicate display names).
  const playerId = "p_" + Math.random().toString(36).slice(2, 9);
  await withTimeout(set(ref(db, `sessions/${code}/public/players/${playerId}`), {
    name: nameTrim,
    wireCount: 0,
    connected: true,
  }), 8000, "Joining room");
  try { onDisconnect(ref(db, `sessions/${code}/public/players/${playerId}/connected`)).set(false); } catch {}
  try { localStorage.setItem(`bb-player-${code}`, playerId); localStorage.setItem(`bb-name-${code}`, nameTrim); } catch {}
  return playerId;
}

export function watchSession(code, callback) {
  if (!code || typeof code !== "string" || code.trim().length === 0) {
    console.warn("watchSession called with empty code:", code);
    setTimeout(() => callback(null), 0);
    return () => {};
  }
  return onValue(ref(db, `sessions/${code}`), (snapshot) => callback(snapshot.val()), (err) => {
    console.error("watchSession error", code, err);
    callback(null);
  });
}

export async function sessionExists(code) {
  if (!code) return false;
  try {
    const snap = await withTimeout(get(ref(db, `sessions/${code}/status`)), 8000, "Checking room");
    return snap.exists();
  } catch (e) {
    console.error("sessionExists failed", e);
    throw e;
  }
}
