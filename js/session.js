import { db } from "./firebase-config.js";
import {
  ref, set, get, onValue,
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
  const playerId = "p_" + Math.random().toString(36).slice(2, 9);
  await withTimeout(set(ref(db, `sessions/${code}/public/players/${playerId}`), {
    name: playerName,
    wireCount: 0,
    connected: true,
  }), 8000, "Joining room");
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
