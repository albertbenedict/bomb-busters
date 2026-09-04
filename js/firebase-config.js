import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCRNmy2x38dr_p7fH-t7BGQ0yFUizSm0mc",
  authDomain: "bomb-busters-744e5.firebaseapp.com",
  projectId: "bomb-busters-744e5",
  storageBucket: "bomb-busters-744e5.firebasestorage.app",
  messagingSenderId: "103619903698",
  appId: "1:103619903698:web:b56df17a0b1ba4ca892d0b",
  databaseURL: "https://bomb-busters-744e5-default-rtdb.asia-southeast1.firebasedatabase.app/",
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);

if (typeof window !== "undefined") {
  window._bombBustersDb = db;
  console.log("[Bomb Busters] Firebase DB ready:", firebaseConfig.databaseURL);
}
