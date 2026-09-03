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

export async function createSession({ wireCount = 12, detonatorMax = 4 }) {
  // Retry on collision – 4-char code has ~1.2M combos, but check anyway.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    const existsSnap = await withTimeout(get(ref(db, `sessions/${code}/status`)), 8000, "Checking room code");
    if (existsSnap.exists()) continue;
    await withTimeout(set(ref(db, `sessions/${code}`), {
      status: "lobby",
      config: { wireCount, detonatorMax },
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

export async function joinSession(code, playerName) {
  const nameTrim = playerName.trim();
  const nameLower = nameTrim.toLowerCase();
  // Reconnect: if this name already has a playerId in the lobby, reuse it
  try {
    const playersSnap = await withTimeout(get(ref(db, `sessions/${code}/public/players`)), 5000, "Checking players");
    const players = playersSnap.val() || {};
    const existing = Object.entries(players).find(([, p]) => p && p.name && p.name.trim().toLowerCase() === nameLower);
    if (existing) {
      const [existingId, existingData] = existing;
      await withTimeout(update(ref(db, `sessions/${code}/public/players/${existingId}`), {
        name: nameTrim,
        connected: true,
      }), 5000, "Reconnecting");
      try { onDisconnect(ref(db, `sessions/${code}/public/players/${existingId}/connected`)).set(false); } catch {}
      // Ensure turnOrder contains them if game already started and they were removed
      const sessionSnap = await withTimeout(get(ref(db, `sessions/${code}`)), 5000, "Checking session");
      const sess = sessionSnap.val();
      if (sess && Array.isArray(sess.turnOrder) && !sess.turnOrder.includes(existingId)) {
        // Player rejoining after kick would have turnOrder missing – add back only in lobby
        if (sess.status === "lobby") {
          await withTimeout(update(ref(db, `sessions/${code}`), {
            turnOrder: [...sess.turnOrder, existingId],
          }), 5000, "Restoring turn");
        }
      }
      try { localStorage.setItem(`bb-player-${code}`, existingId); localStorage.setItem(`bb-name-${code}`, nameTrim); } catch {}
      return existingId;
    }
  } catch (e) {
    console.warn("reconnect check failed, creating new player", e);
  }

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
    // Avoid Firebase SecurityError from ref(db, 'sessions/') with empty path
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
