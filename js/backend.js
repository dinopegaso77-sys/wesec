// WeSec – collegamento a Firebase (messaggi) e al Worker Cloudflare (notifiche e file)
import { CONFIG } from '../config.js';

const V = '10.12.2';
let fb, auth, db, uid;

export async function init() {
  const app = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`);
  const a = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`);
  fb = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`);
  const fa = app.initializeApp(CONFIG.firebase);
  auth = a.getAuth(fa);
  db = fb.getFirestore(fa);
  await a.setPersistence(auth, a.indexedDBLocalPersistence);
  uid = await new Promise((res, rej) => {
    const off = a.onAuthStateChanged(auth, (u) => {
      if (u) { off(); res(u.uid); } else a.signInAnonymously(auth).catch(rej);
    });
  });
  return uid;
}
export const myId = () => uid;

// ---- inviti ----
export async function createInvite(code, pubA) {
  await fb.setDoc(fb.doc(db, 'invites', code), {
    from: uid, pubA, accepted: false, expires: fb.Timestamp.fromMillis(Date.now() + 10 * 60 * 1000),
  });
}
export function watchInvite(code, cb) {
  return fb.onSnapshot(fb.doc(db, 'invites', code), (s) => cb(s.exists() ? s.data() : null), () => cb(null));
}
export async function getInvite(code) {
  const s = await fb.getDoc(fb.doc(db, 'invites', code));
  return s.exists() ? s.data() : null;
}
export async function acceptInvite(code, inv, chatId, pubB) {
  await fb.setDoc(fb.doc(db, 'chats', chatId), { members: [inv.from, uid], created: fb.serverTimestamp() });
  await fb.updateDoc(fb.doc(db, 'invites', code), { accepted: true, pubB, uidB: uid, chatId });
}
export const deleteInvite = (code) => fb.deleteDoc(fb.doc(db, 'invites', code)).catch(() => {});

// ---- messaggi ----
export async function sendMessage(chatId, box) {
  await fb.addDoc(fb.collection(db, 'chats', chatId, 'messages'), { from: uid, ts: fb.serverTimestamp(), iv: box.iv, ct: box.ct });
}
export function watchMessages(chatId, n, cb, onErr) {
  const q = fb.query(fb.collection(db, 'chats', chatId, 'messages'), fb.orderBy('ts', 'desc'), fb.limit(n));
  return fb.onSnapshot(q, { includeMetadataChanges: false }, (snap) => {
    const list = [];
    snap.forEach((d) => {
      const x = d.data({ serverTimestamps: 'estimate' });
      list.push({ id: d.id, from: x.from, ts: x.ts ? x.ts.toMillis() : Date.now(), iv: x.iv, ct: x.ct, pending: d.metadata.hasPendingWrites });
    });
    cb(list.reverse());
  }, (e) => onErr && onErr(e));
}

// ---- Worker: notifiche e file ----
const W = () => CONFIG.worker.replace(/\/$/, '');
async function post(path, body) {
  const r = await fetch(W() + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('worker ' + r.status);
  return r.json();
}
export async function vapidKey() { const r = await fetch(W() + '/vapid'); return (await r.json()).key; }
export const subscribe = (chat, token, sub) => post('/sub', { chat, token, dev: uid, sub });
export const notify = (chat, token) => post('/notify', { chat, token, dev: uid }).catch(() => {});
export async function putFile(chat, id, token, bytes) {
  const r = await fetch(`${W()}/file/${chat}/${id}`, { method: 'PUT', headers: { 'X-Token': token, 'Content-Type': 'application/octet-stream' }, body: bytes });
  if (!r.ok) throw new Error('upload ' + r.status);
}
export async function getFile(chat, id, token) {
  const r = await fetch(`${W()}/file/${chat}/${id}`, { headers: { 'X-Token': token } });
  if (!r.ok) throw new Error('download ' + r.status);
  return new Uint8Array(await r.arrayBuffer());
}
