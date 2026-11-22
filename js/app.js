// WeSec v0.2 – You and me. Stop.
import * as C from './crypto.js';
import { kvGet, kvSet, kvDel, kvClear } from './store.js';
import { qrSVG } from './qr.js';

const B = globalThis.__wesecBackend || (await import('./backend.js'));
const VERSION = '0.2';
const COLORS = ['#a7d8f5', '#f8bfd4', '#cdbdf6', '#a8e6c3', '#fcd0a6', '#9fe3dc', '#f6b3b3', '#d6e8a4']; // pastello
const PHRASES = ['Ricordati il pane', 'Hai una nota nuova', 'Controlla la lista', 'Promemoria'];
const LOCK_HIDDEN_MS = 30000, LOCK_IDLE_MS = 5 * 60000, LIST_N = 25, CHAT_N = 150;

const S = {
  vault: null, pk: null, uid: null, ready: null, initErr: null,
  keys: new Map(), priv: new Map(), pkey: null, watch: new Map(), msgs: new Map(), dec: new Map(), media: new Map(),
  cur: null, inviteOff: null, hiddenAt: 0, picking: false, idleT: 0, keyH: null, saving: Promise.resolve(),
  el: {}, pendingCode: null, scanStop: null,
};
const app = document.getElementById('app');
const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
const modal = document.getElementById('modal');

// ---------- utilità DOM (testo sempre come testo, mai HTML) ----------
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.setAttribute('style', v);
    else if (k === 'html') e.innerHTML = v; // solo contenuti generati da noi (QR)
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}
let toastT;
function toast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms);
}
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const newId = () => C.b64u.enc(C.rand(18));
const fmtTime = (ts) => new Date(ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
function fmtDay(ts) {
  const d = new Date(ts), t = new Date(); t.setHours(0, 0, 0, 0);
  const diff = Math.round((t - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
  if (diff === 0) return 'Oggi';
  if (diff === 1) return 'Ieri';
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: d.getFullYear() === t.getFullYear() ? undefined : 'numeric' });
}
function fmtListTime(ts) {
  const day = fmtDay(ts);
  return day === 'Oggi' ? fmtTime(ts) : day === 'Ieri' ? 'ieri' : new Date(ts).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
}
const chatName = (c) => (c && c.name && c.name.trim()) || 'Contatto';
const initial = (c) => chatName(c).trim().charAt(0).toUpperCase();

// ---------- cassaforte locale ----------
function saveVault() {
  const v = S.vault, pk = S.pk;
  if (!v || !pk) return S.saving;
  S.saving = S.saving.then(async () => {
    await kvSet('vault', await C.sealJSON(pk, v, 'vault'));
    const phr = {};
    for (const [id, c] of Object.entries(v.chats)) phr[id] = c.phrase || '';
    await kvSet('phr', phr);
  }).catch(() => toast('Errore nel salvataggio locale'));
  return S.saving;
}
async function chatKey(id) {
  if (!S.keys.has(id)) S.keys.set(id, C.importChatKey(S.vault.chats[id].key));
  return S.keys.get(id);
}

// ---------- avvio ----------
async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  const m = location.hash.match(/[#&]i=([A-Za-z0-9-]+)/);
  if (m) { S.pendingCode = C.normCode(m[1]); history.replaceState(null, '', location.pathname + location.search); }
  S.ready = B.init().then((u) => { S.uid = u; }).catch((e) => { S.initErr = e; console.warn(e); });
  const salt = await kvGet('salt');
  if (!salt) return (isIOS && !standalone()) ? showIOSFirst() : showSetup();
  showLock();
}

function clearKeys() { if (S.keyH) { removeEventListener('keydown', S.keyH); S.keyH = null; } }

function pinScreen({ title, sub, onDone, extra }) {
  clearKeys();
  let val = '', busy = false;
  const dots = h('div', { class: 'dots' }, ...Array.from({ length: 6 }, () => h('i')));
  const msg = h('p', { class: 'pin-sub' }, sub);
  const upd = () => [...dots.children].forEach((d, i) => d.classList.toggle('on', i < val.length));
  const press = async (k) => {
    if (busy) return;
    if (k === '⌫') val = val.slice(0, -1); else if (val.length < 6) val += k;
    upd();
    if (val.length === 6) {
      busy = true;
      const ok = await onDone(val, msg);
      busy = false;
      if (!ok) { val = ''; upd(); dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake'); }
    }
  };
  const keys = h('div', { class: 'keys' },
    ...'123456789'.split('').map((k) => h('button', { onclick: () => press(k) }, k)),
    h('span'), h('button', { onclick: () => press('0') }, '0'),
    h('button', { class: 'ghost', 'aria-label': 'Cancella', onclick: () => press('⌫') }, '⌫'));
  S.keyH = (e) => { if (/^[0-9]$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('⌫'); };
  addEventListener('keydown', S.keyH);
  fill(app, h('div', { class: 'pin' }, h('h1', null, title), msg, dots, keys, extra || null));
}

function showIOSFirst() {
  fill(app, h('div', { class: 'pin' },
    h('h1', null, 'Note'),
    h('p', { class: 'pin-sub', style: 'max-width:320px' }, 'Su iPhone, per ricevere le notifiche, aggiungi prima questa pagina alla schermata Home: tocca Condividi ⬆︎ poi "Aggiungi alla schermata Home". Poi apri Note da lì.'),
    h('p', { class: 'pin-sub', style: 'max-width:320px' }, 'I dati del browser e quelli dell\'icona sono separati: crea il PIN direttamente dall\'icona.'),
    h('button', { class: 'link', onclick: showSetup }, 'Continua comunque nel browser')));
}

function showSetup() {
  pinScreen({
    title: 'Note', sub: 'Scegli un codice di 6 cifre',
    onDone: async (pin) => {
      pinScreen({
        title: 'Note', sub: 'Ripeti il codice',
        onDone: async (pin2, msg) => {
          if (pin2 !== pin) { msg.textContent = 'Non coincide, ricomincia'; setTimeout(showSetup, 900); return false; }
          msg.textContent = '…';
          const salt = C.rand(16);
          S.pk = await C.pinKey(pin, salt);
          S.vault = { v: 1, me: { name: '' }, chats: {}, pending: {}, push: false };
          await kvSet('salt', salt);
          await saveVault();
          await enterApp();
          openWelcome();
          return true;
        },
      });
      return true;
    },
  });
}

function showLock() {
  pinScreen({
    title: 'Note', sub: 'Inserisci il codice',
    onDone: async (pin, msg) => {
      const tries = (await kvGet('tries')) || { n: 0, until: 0 };
      if (Date.now() < tries.until) { msg.textContent = `Riprova tra ${Math.ceil((tries.until - Date.now()) / 1000)} s`; return false; }
      msg.textContent = '…';
      try {
        const pk = await C.pinKey(pin, await kvGet('salt'));
        const v = await C.openJSON(pk, await kvGet('vault'), 'vault');
        await kvSet('tries', { n: 0, until: 0 });
        S.pk = pk; S.vault = v;
        await enterApp();
        return true;
      } catch {
        tries.n++;
        if (tries.n >= 5) tries.until = Date.now() + 30000 * 2 ** (tries.n - 5);
        await kvSet('tries', tries);
        msg.textContent = tries.until > Date.now() ? `Codice errato. Riprova tra ${Math.ceil((tries.until - Date.now()) / 1000)} s` : 'Codice errato';
        return false;
      }
    },
  });
}

function lock() {
  if (!S.vault) return;
  for (const off of S.watch.values()) off.off();
  S.watch.clear();
  if (S.inviteOff) { S.inviteOff(); S.inviteOff = null; }
  stopScan();
  for (const u of S.media.values()) URL.revokeObjectURL(u);
  S.media.clear(); S.msgs.clear(); S.dec.clear(); S.keys.clear(); S.priv.clear(); S.pkey = null;
  S.vault = null; S.pk = null; S.cur = null;
  document.body.classList.remove('in-chat');
  closeModal();
  showLock();
}

// blocco automatico
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { S.hiddenAt = Date.now(); document.body.classList.add('veil'); return; }
  document.body.classList.remove('veil');
  if (S.vault && !S.picking && Date.now() - S.hiddenAt > LOCK_HIDDEN_MS) lock();
  else if (S.vault) markRead();
});
function bumpIdle() {
  clearTimeout(S.idleT);
  if (S.vault) S.idleT = setTimeout(() => { if (!S.picking) lock(); }, LOCK_IDLE_MS);
}
['pointerdown', 'keydown'].forEach((ev) => addEventListener(ev, bumpIdle, { passive: true }));
addEventListener('popstate', () => { if (S.cur && document.body.classList.contains('in-chat')) closeChat(true); });

// ---------- app principale ----------
async function enterApp() {
  clearKeys();
  buildMain();
  bumpIdle();
  await S.ready;
  renderList();
  if (S.initErr) return;
  for (const id of Object.keys(S.vault.chats)) startWatch(id, LIST_N);
  for (const [code, p] of Object.entries(S.vault.pending)) {
    if (Date.now() - p.created > 10 * 60000) { delete S.vault.pending[code]; B.deleteInvite(code); } else watchMyInvite(code);
  }
  saveVault();
  refreshPush();
  if (S.pendingCode) { const c = S.pendingCode; S.pendingCode = null; openAdd('code', c); }
}

function buildMain() {
  const list = h('section', { class: 'pane list-pane' });
  const chat = h('section', { class: 'pane chat-pane' });
  const side = h('aside', { class: 'pane side-pane' });
  S.el = { list, chat, side };
  fill(app, h('div', { class: 'main' }, list, chat, side));
  renderList(); renderChat(); renderSide();
}

function lastInfo(id) {
  const arr = (S.msgs.get(id) || []).filter((m) => m.d.t !== 'err');
  const c = S.vault.chats[id];
  const last = arr[arr.length - 1];
  const unread = arr.filter((m) => !m.mine && m.d.t !== 'hello' && m.ts > (c.lastRead || 0)).length;
  let prev = '🔒 Chat cifrata creata';
  if (last) prev = last.d.t === 'img' ? '📷 Foto' : last.d.t === 'hello' ? '🔒 Chat cifrata creata' : last.d.text;
  if (last && last.mine && last.d.t !== 'hello') prev = 'Tu: ' + prev;
  return { ts: last ? last.ts : c.created, prev, unread };
}

function renderList() {
  if (!S.vault) return;
  const ids = Object.keys(S.vault.chats).map((id) => ({ id, ...lastInfo(id) })).sort((a, b) => b.ts - a.ts);
  const rows = ids.map(({ id, ts, prev, unread }) => {
    const c = S.vault.chats[id];
    return h('button', { class: 'row' + (S.cur === id ? ' sel' : ''), style: `--c:${c.color}`, onclick: () => openChat(id) },
      h('div', { class: 'av' }, initial(c)),
      h('div', { class: 'meta' },
        h('div', { class: 'top' }, h('b', null, chatName(c)), h('time', null, fmtListTime(ts))),
        h('div', { class: 'bot' }, h('span', { class: 'prev' }, prev), unread ? h('span', { class: 'badge' }, unread >= LIST_N ? LIST_N + '+' : unread) : null)));
  });
  fill(S.el.list, 
    h('div', { class: 'bar' },
      h('img', { class: 'brand', src: 'icons/wesec.svg', alt: '' }),
      h('h2', null, 'Chat'),
      h('button', { class: 'icon-btn', title: 'Impostazioni', 'aria-label': 'Impostazioni', onclick: openSettings }, '⚙')),
    S.initErr ? h('div', { class: 'banner' }, 'Non collegato al server. Controlla config.js seguendo la guida, poi ricarica.') : null,
    h('div', { class: 'chats' }, rows.length ? rows : h('div', { class: 'empty' }, 'Nessuna chat. Tocca + per aggiungere il primo contatto.')),
    h('button', { class: 'fab', title: 'Aggiungi contatto', 'aria-label': 'Aggiungi contatto', onclick: () => openAdd('mine') }, '+'));
}

function renderChat() {
  const p = S.el.chat;
  const c = S.cur && S.vault ? S.vault.chats[S.cur] : null;
  if (!c) {
    fill(p, h('div', { class: 'welcome' },
      h('img', { src: 'icons/wesec.svg', alt: '' }), h('b', null, 'WeSec'), h('span', { class: 'slogan' }, 'You and me. Stop.'),
      h('span', null, 'Scegli una chat a sinistra')));
    return;
  }
  const id = S.cur;
  const msgs = h('div', { class: 'msgs' });
  const ta = h('textarea', { rows: 1, placeholder: 'Messaggio', 'aria-label': 'Messaggio' });
  const send = () => {
    const text = ta.value.trim();
    if (!text) return;
    ta.value = ''; ta.style.height = '';
    sendObj(id, { t: 'text', text });
    ta.focus();
  };
  ta.addEventListener('input', () => { ta.style.height = ''; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !coarse) { e.preventDefault(); send(); } });
  const file = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
  file.addEventListener('change', () => { S.picking = false; if (file.files[0]) openPhotoPreview(id, file.files[0]); file.value = ''; });
  p.style.setProperty('--c', c.color);
  fill(p, 
    h('div', { class: 'bar chat-bar', style: `--c:${c.color}` },
      h('button', { class: 'icon-btn back', 'aria-label': 'Indietro', onclick: () => history.back() }, '‹'),
      h('button', { class: 'who', onclick: () => openContact(id) },
        h('div', { class: 'av sm' }, initial(c)),
        h('div', null, h('b', null, chatName(c)),
          c.verified ? h('small', { class: 'ok' }, '🔒 verificato') : h('small', { class: 'warn' }, '⚠ da verificare'))),
      h('button', { class: 'icon-btn', 'aria-label': 'Impostazioni contatto', onclick: () => openContact(id) }, '⋮')),
    msgs,
    h('div', { class: 'composer' },
      h('button', { class: 'icon-btn', title: 'Foto', 'aria-label': 'Foto', onclick: () => { S.picking = true; file.click(); setTimeout(() => { S.picking = false; }, 120000); } }, '＋'),
      file, ta,
      h('button', { class: 'send', 'aria-label': 'Invia', onclick: send }, '➤')));
  S.el.msgs = msgs;
  renderMsgs(true);
}

function renderMsgs(forceBottom) {
  const box = S.el.msgs;
  if (!box || !S.cur) return;
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  const arr = [...(S.msgs.get(S.cur) || []), ...(S.priv.get(S.cur) || []).map((p) => ({ id: 'p' + p.id, ts: p.ts, mine: true, priv: true, d: { t: 'img', priv: true, ...p } }))].sort((a, b) => a.ts - b.ts);
  const out = [];
  let day = '';
  if (arr.length >= CHAT_N) out.push(h('div', { class: 'sys' }, `Sono mostrati gli ultimi ${CHAT_N} messaggi`));
  for (const m of arr) {
    const d = fmtDay(m.ts);
    if (d !== day) { day = d; out.push(h('div', { class: 'day' }, d)); }
    if (m.d.t === 'hello') { out.push(h('div', { class: 'sys' }, m.mine ? '🔒 Chat cifrata creata' : '🔒 Il contatto si è collegato')); continue; }
    const t = h('span', { class: 't' }, (m.priv ? '🔒 Solo tu · ' : '') + fmtTime(m.ts) + (m.priv ? '' : m.mine ? (m.pending ? ' ⏱' : ' ✓') : ''));
    if (m.d.t === 'text') out.push(h('div', { class: 'b' + (m.mine ? ' me' : '') }, h('p', null, m.d.text), t));
    else if (m.d.t === 'img') out.push(h('div', { class: 'b img' + (m.priv ? ' priv' : m.mine ? ' me' : '') }, h('img', { src: m.d.th, alt: 'Foto', onclick: () => openImage(S.cur, m.d) }), t));
    else out.push(h('div', { class: 'sys' }, '⚠ Messaggio non leggibile'));
  }
  fill(box, ...out);
  if (forceBottom || near) box.scrollTop = box.scrollHeight;
}

function renderSide() {
  const p = S.el.side;
  const id = S.cur, c = id && S.vault ? S.vault.chats[id] : null;
  if (!c) { fill(p, h('div', { class: 'welcome' }, h('span', null, 'Media e sicurezza della chat'))); return; }
  const imgs = (S.msgs.get(id) || []).filter((m) => m.d.t === 'img').slice(-24).reverse();
  fill(p, 
    h('h3', null, 'Media con ' + chatName(c)),
    h('div', { class: 'lbl' }, '👁 Visibili a tutti e due'),
    imgs.length ? h('div', { class: 'grid' }, imgs.map((m) => h('img', { src: m.d.th, alt: '', onclick: () => openImage(id, m.d) }))) : h('div', { class: 'lbl' }, 'Ancora nessuna foto'),
    h('div', { class: 'lbl' }, '🔒 Solo per me'),
    (S.priv.get(id) || []).length ? h('div', { class: 'grid' }, [...S.priv.get(id)].reverse().slice(0, 24).map((x) => h('img', { src: x.th, alt: '', onclick: () => openImage(id, { ...x, priv: true }) }))) : h('div', { class: 'lbl' }, 'Nessuna foto privata'),
    h('div', { class: 'lbl' }, 'Sicurezza'),
    h('div', { class: c.verified ? 'ok' : 'warn', style: `--c:${c.color}` }, c.verified ? '🔒 Codice verificato' : '⚠ Codice da verificare'),
    h('button', { class: 'btn sec', onclick: () => openVerify(id) }, 'Verifica codice'),
    h('div', { class: 'lbl' }, '🔔 Frase della notifica'),
    h('div', null, '“' + (c.phrase || 'Hai una nota nuova') + '”'),
    h('button', { class: 'btn sec', onclick: () => openContact(id) }, 'Impostazioni contatto'));
}

function openChat(id) {
  const wasIn = document.body.classList.contains('in-chat');
  S.cur = id;
  document.body.classList.add('in-chat');
  if (!wasIn && innerWidth < 760) history.pushState({ chat: id }, '');
  startWatch(id, CHAT_N);
  renderList(); renderChat(); renderSide(); markRead();
  loadPriv(id).then(() => { if (S.cur === id) { renderMsgs(true); renderSide(); } });
}
function closeChat(fromPop) {
  S.cur = null;
  document.body.classList.remove('in-chat');
  if (!fromPop && history.state && history.state.chat) history.back();
  renderList(); renderChat(); renderSide();
}

function markRead() {
  const id = S.cur;
  if (!id || document.hidden || !S.vault) return;
  if (innerWidth < 760 && !document.body.classList.contains('in-chat')) return;
  const arr = S.msgs.get(id) || [], c = S.vault.chats[id];
  const last = arr.length ? arr[arr.length - 1].ts : 0;
  if (last > (c.lastRead || 0)) { c.lastRead = last; saveVault(); renderList(); }
}

// ---------- ricezione messaggi ----------
function startWatch(id, n) {
  const w = S.watch.get(id);
  if (w && w.n >= n) return;
  if (w) w.off();
  const off = B.watchMessages(id, n, (list) => onMessages(id, list), () => toast('Connessione alla chat non riuscita'));
  S.watch.set(id, { n, off });
}
async function onMessages(id, list) {
  if (!S.vault || !S.vault.chats[id]) return;
  const key = await chatKey(id);
  const out = [];
  for (const m of list) {
    let d = S.dec.get(m.id);
    if (!d) {
      try { d = await C.openJSON(key, { iv: m.iv, ct: m.ct }, id); } catch { d = { t: 'err' }; }
      S.dec.set(m.id, d);
      if (d.t === 'hello' && m.from !== S.uid) onHello(id, d);
    }
    out.push({ ...m, d, mine: m.from === S.uid });
  }
  if (!S.vault) return;
  S.msgs.set(id, out);
  renderList();
  if (S.cur === id) { renderMsgs(false); renderSide(); markRead(); }
}
function onHello(id, d) {
  const c = S.vault.chats[id];
  if (c && !c.name && d.name) {
    c.name = String(d.name).slice(0, 40); saveVault();
    const f = modal.querySelector('input.cname');
    if (f && f.dataset.chat === id && !f.value) f.value = c.name;
    if (S.cur === id) renderChat();
  }
}

// ---------- invio ----------
async function sendObj(id, obj) {
  try {
    const key = await chatKey(id);
    const box = await C.sealJSON(key, obj, id);
    await B.sendMessage(id, box);
    B.notify(id, S.vault.chats[id].token);
  } catch (e) { console.warn(e); toast('Invio non riuscito'); }
}
async function toJpeg(bmp, max, q) {
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * s), hh = Math.round(bmp.height * s);
  const cv = Object.assign(document.createElement('canvas'), { width: w, height: hh });
  cv.getContext('2d').drawImage(bmp, 0, 0, w, hh);
  const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', q));
  return { w, h: hh, bytes: new Uint8Array(await blob.arrayBuffer()), url: cv.toDataURL('image/jpeg', q) };
}
async function sendPhoto(id, file) {
  const c = S.vault.chats[id];
  try {
    toast('Cifro e carico la foto…', 8000);
    const bmp = await createImageBitmap(file);
    const full = await toJpeg(bmp, 1600, 0.82), th = await toJpeg(bmp, 320, 0.6);
    const fid = newId(), key = await chatKey(id);
    const enc = await C.encBytes(key, full.bytes, id + '/' + fid);
    await B.putFile(id, fid, c.token, enc.data);
    await sendObj(id, { t: 'img', id: fid, iv: enc.iv, w: full.w, h: full.h, th: th.url, size: full.bytes.length });
    toast('Foto caricata · visibile a tutti e due');
  } catch (e) { console.warn(e); toast('Foto non inviata'); }
}

// ---------- foto "solo per me" ----------
async function personalKey() {
  if (!S.pkey) {
    if (!S.vault.me.mkey) { S.vault.me.mkey = C.b64u.enc(C.rand(32)); await saveVault(); }
    S.pkey = C.importChatKey(S.vault.me.mkey);
  }
  return S.pkey;
}
async function loadPriv(id) {
  if (S.priv.has(id)) return S.priv.get(id);
  let arr = [];
  try { const box = await kvGet('priv:' + id); if (box) arr = await C.openJSON(S.pk, box, 'priv:' + id); } catch { arr = []; }
  if (S.vault) S.priv.set(id, arr);
  return arr;
}
async function savePrivList(id) {
  await kvSet('priv:' + id, await C.sealJSON(S.pk, S.priv.get(id) || [], 'priv:' + id));
}
async function savePrivate(id, file) {
  const c = S.vault.chats[id];
  try {
    toast('Cifro e carico la foto…', 8000);
    const bmp = await createImageBitmap(file);
    const full = await toJpeg(bmp, 1600, 0.82), th = await toJpeg(bmp, 320, 0.6);
    const fid = newId();
    const enc = await C.encBytes(await personalKey(), full.bytes, 'me/' + id + '/' + fid);
    await B.putFile(id, fid, c.token, enc.data);
    const arr = await loadPriv(id);
    arr.push({ id: fid, iv: enc.iv, w: full.w, h: full.h, th: th.url, ts: Date.now() });
    await savePrivList(id);
    if (S.cur === id) { renderMsgs(true); renderSide(); }
    toast('Foto caricata · la vedi solo tu 🔒');
  } catch (e) { console.warn(e); toast('Foto non salvata'); }
}
function openPhotoPreview(id, file) {
  const url = URL.createObjectURL(file);
  const c = S.vault.chats[id];
  const box = h('input', { type: 'checkbox', checked: true });
  const hint = h('small');
  const upd = () => { hint.textContent = box.checked ? `La vedete tu e ${chatName(c)}.` : `La vedi solo tu, cifrata con la tua chiave. Potrai renderla visibile più tardi.`; };
  box.addEventListener('change', upd); upd();
  const card = openModal('Carica foto',
    h('img', { src: url, alt: '', class: 'preview' }),
    h('label', { class: 'check' }, box, h('span', null, h('b', null, `👁 Visibile anche a ${chatName(c)}`), hint)),
    h('button', { class: 'btn', onclick: () => { closeModal(); (box.checked ? sendPhoto : savePrivate)(id, file); } }, 'Carica'),
    h('button', { class: 'btn sec', onclick: closeModal }, 'Annulla'));
  const free = () => URL.revokeObjectURL(url);
  card.querySelector('img.preview').addEventListener('load', () => setTimeout(free, 1000), { once: true });
}

async function makeVisible(id, d) {
  const c = S.vault.chats[id];
  try {
    toast('Rendo visibile la foto…', 8000);
    const enc0 = await B.getFile(id, d.id, c.token);
    const bytes = await C.decBytes(await personalKey(), d.iv, enc0, 'me/' + id + '/' + d.id);
    const fid = newId();
    const enc = await C.encBytes(await chatKey(id), bytes, id + '/' + fid);
    await B.putFile(id, fid, c.token, enc.data);
    await sendObj(id, { t: 'img', id: fid, iv: enc.iv, w: d.w, h: d.h, th: d.th, size: bytes.length });
    S.priv.set(id, (S.priv.get(id) || []).filter((x) => x.id !== d.id));
    await savePrivList(id);
    if (S.cur === id) { renderMsgs(true); renderSide(); }
    toast('Ora la vedete tutti e due 👁');
    return true;
  } catch (e) { console.warn(e); toast('Non riuscito'); return false; }
}

// ---------- finestre ----------
function openModal(title, ...body) {
  stopScan();
  const card = h('div', { class: 'card' },
    h('button', { class: 'icon-btn x', 'aria-label': 'Chiudi', onclick: closeModal }, '✕'),
    title ? h('h3', null, title) : null, ...body);
  modal.className = 'modal';
  fill(modal, card);
  modal.onclick = (e) => { if (e.target === modal) closeModal(); };
  return card;
}
function closeModal() {
  stopScan();
  modal.className = 'modal hidden'; fill(modal);
  if (S.inviteOff && !Object.keys((S.vault || {}).pending || {}).length) { S.inviteOff(); S.inviteOff = null; }
}

function openWelcome() {
  const name = h('input', { maxlength: 40, placeholder: 'Es. Dino', value: S.vault.me.name || '' });
  openModal('Benvenuto in WeSec',
    h('div', { class: 'about', style: 'justify-content:center' }, h('img', { src: 'icons/wesec.svg', alt: '' }), h('div', null, h('b', null, 'WeSec'), h('div', { class: 'slogan' }, 'You and me. Stop.'))),
    h('label', { class: 'field' }, h('span', null, 'Il tuo nome (lo vedono solo i tuoi contatti, cifrato)'), name),
    pushBlock(),
    h('button', { class: 'btn', onclick: () => { S.vault.me.name = name.value.trim(); saveVault(); closeModal(); } }, 'Inizia'));
}

function pushBlock() {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (isIOS && !standalone()) return h('p', null, '🔔 Su iPhone le notifiche arrivano solo aprendo Note dall\'icona sulla schermata Home (Condividi ⬆︎ → Aggiungi alla schermata Home).');
  if (!supported) return h('p', null, '🔔 Questo browser non supporta le notifiche.');
  const on = S.vault.push && Notification.permission === 'granted';
  return h('div', null,
    h('p', null, on ? '🔔 Notifiche in codice attive su questo dispositivo.' : '🔔 Le notifiche mostrano solo la frase in codice che scegli per ogni contatto.'),
    on ? null : h('button', { class: 'btn sec', onclick: async (e) => { e.target.disabled = true; if (await enablePush()) e.target.replaceWith(h('p', null, '✓ Notifiche attive')); else e.target.disabled = false; } }, 'Attiva notifiche'));
}

async function getPushSub(create) {
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub || !create) return sub;
  const key = C.b64u.dec(await B.vapidKey());
  try { sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }); }
  catch { const old = await reg.pushManager.getSubscription(); if (old) await old.unsubscribe(); sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }); }
  return sub;
}
async function enablePush() {
  try {
    if ((await Notification.requestPermission()) !== 'granted') { toast('Permesso notifiche negato'); return false; }
    const sub = await getPushSub(true);
    S.vault.push = true; saveVault();
    await subscribeAll(sub);
    return true;
  } catch (e) { console.warn(e); toast('Notifiche non attivate'); return false; }
}
async function subscribeAll(sub, only) {
  const j = sub.toJSON();
  for (const [id, c] of Object.entries(S.vault.chats)) if (!only || only === id) await B.subscribe(id, c.token, j).catch(() => {});
}
async function refreshPush(only) {
  try {
    if (!S.vault.push || !('Notification' in window) || Notification.permission !== 'granted') return;
    const sub = await getPushSub(true);
    if (sub) await subscribeAll(sub, only);
  } catch { /* riprova al prossimo sblocco */ }
}

// --- aggiungi contatto ---
async function openAdd(tab, code) {
  const body = h('div');
  const tabs = h('div', { class: 'tabs' },
    h('button', { class: tab === 'mine' ? 'on' : '', onclick: () => openAdd('mine') }, 'Il mio invito'),
    h('button', { class: tab === 'code' ? 'on' : '', onclick: () => openAdd('code') }, 'Ho un codice'));
  openModal('Aggiungi contatto', tabs, body);
  if (S.initErr) { body.append(h('p', null, 'Non collegato al server: controlla config.js.')); return; }
  await S.ready;
  if (tab === 'mine') showMyInvite(body); else showEnterCode(body, code);
}

async function showMyInvite(body, fresh) {
  let code = Object.keys(S.vault.pending).find((k) => Date.now() - S.vault.pending[k].created < 9 * 60000);
  if (!code || fresh) {
    fill(body, h('p', { class: 'center' }, 'Creo l\'invito…'));
    code = C.inviteCode();
    const kp = await C.newKeyPair();
    S.vault.pending[code] = { ...kp, created: Date.now() };
    await saveVault();
    try { await B.createInvite(code, kp.pub); } catch (e) { console.warn(e); delete S.vault.pending[code]; fill(body, h('p', null, 'Invito non creato. Controlla la connessione.')); return; }
    watchMyInvite(code);
  }
  const link = location.origin + location.pathname + '#i=' + code;
  const left = h('p', { class: 'center' });
  const tick = () => {
    const p = S.vault && S.vault.pending[code];
    if (!p || !left.isConnected) return clearInterval(iv);
    const s = Math.max(0, Math.round((p.created + 10 * 60000 - Date.now()) / 1000));
    left.textContent = s ? `Scade tra ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} · vale una volta` : 'Invito scaduto';
  };
  const iv = setInterval(tick, 1000); tick();
  fill(body, 
    h('p', { class: 'center' }, 'Fai inquadrare il QR o dai questo codice al tuo contatto, di persona.'),
    h('div', { class: 'qr', html: qrSVG(link, 200) }),
    h('div', { class: 'code' }, C.prettyCode(code)), left,
    h('p', { class: 'center' }, '⏳ In attesa che il contatto lo inserisca…'),
    h('button', { class: 'btn sec', onclick: () => showMyInvite(body, true) }, 'Nuovo codice'));
}

function watchMyInvite(code) {
  if (S.inviteOff) S.inviteOff();
  S.inviteOff = B.watchInvite(code, async (inv) => {
    const p = S.vault && S.vault.pending[code];
    if (!p || !inv || !inv.accepted || !inv.pubB || !inv.chatId) return;
    if (S.inviteOff) { S.inviteOff(); S.inviteOff = null; }
    const k = await C.deriveChat(p.privJwk, p.pub, inv.pubB);
    delete S.vault.pending[code];
    B.deleteInvite(code);
    await addChat(inv.chatId, k, p.pub, inv.pubB);
  });
}

function showEnterCode(body, pre) {
  const inp = h('input', { placeholder: 'ABCDE-12345', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', style: 'text-align:center;font:700 22px ui-monospace,monospace;letter-spacing:2px', value: pre ? C.prettyCode(pre) : '' });
  inp.addEventListener('input', () => { const n = C.normCode(inp.value).slice(0, 10); inp.value = n.length > 5 ? C.prettyCode(n) : n; });
  const status = h('p', { class: 'center' });
  let busy = false;
  const go = async () => {
    if (busy) return;
    const code = C.normCode(inp.value);
    if (code.length !== 10) { status.textContent = 'Il codice ha 10 caratteri'; return; }
    status.textContent = 'Collego…';
    busy = true;
    try {
      const inv = await B.getInvite(code);
      if (!inv || inv.accepted || inv.expires.toMillis() < Date.now()) { status.textContent = 'Codice non valido o scaduto'; return; }
      if (inv.from === S.uid) { status.textContent = 'Questo è il tuo stesso invito'; return; }
      const kp = await C.newKeyPair();
      const chatId = newId();
      const k = await C.deriveChat(kp.privJwk, kp.pub, inv.pubA);
      await B.acceptInvite(code, inv, chatId, kp.pub);
      await addChat(chatId, k, kp.pub, inv.pubA);
    } catch (e) { console.warn(e); status.textContent = 'Collegamento non riuscito'; }
    busy = false;
  };
  const scanBtn = 'BarcodeDetector' in window ? h('button', { class: 'btn sec', onclick: () => startScan(body, inp, go) }, '📷 Scansiona QR') : null;
  fill(body, 
    h('p', { class: 'center' }, 'Scrivi il codice che ti ha dato il tuo contatto.'),
    h('label', { class: 'field' }, inp), status,
    h('button', { class: 'btn', onclick: go }, 'Collega'), scanBtn,
    isIOS ? h('p', null, 'Su iPhone, se hai inquadrato il QR con la Fotocamera si apre Safari: torna invece su Note dalla schermata Home e scrivi qui il codice.') : null);
  if (pre) go();
}

async function startScan(body, inp, go) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = h('video', { class: 'scan', playsinline: true, muted: true });
    video.srcObject = stream; await video.play();
    body.prepend(video);
    const det = new BarcodeDetector({ formats: ['qr_code'] });
    let alive = true;
    S.scanStop = () => { alive = false; stream.getTracks().forEach((t) => t.stop()); video.remove(); S.scanStop = null; };
    const loop = async () => {
      if (!alive) return;
      try {
        const r = await det.detect(video);
        const m = r[0] && r[0].rawValue.match(/(?:#i=|WS1:)([A-Za-z0-9-]{10,11})/);
        if (m) { inp.value = C.prettyCode(C.normCode(m[1])); stopScan(); go(); return; }
      } catch { /* continua */ }
      setTimeout(loop, 300);
    };
    loop();
  } catch { toast('Fotocamera non disponibile'); }
}
function stopScan() { if (S.scanStop) S.scanStop(); }

async function addChat(id, k, myPub, theirPub) {
  const used = Object.values(S.vault.chats).map((c) => c.color);
  const color = COLORS.find((c) => !used.includes(c)) || COLORS[Object.keys(S.vault.chats).length % COLORS.length];
  S.vault.chats[id] = { name: '', color, phrase: 'Hai una nota nuova', verified: false, key: k.key, token: k.token, myPub, theirPub, created: Date.now(), lastRead: 0 };
  await saveVault();
  startWatch(id, LIST_N);
  await sendObj(id, { t: 'hello', name: S.vault.me.name || '' });
  refreshPush(id);
  openChat(id);
  openContact(id, true);
  toast('Chat cifrata creata 🔒');
}

// --- impostazioni contatto ---
function openContact(id, isNew) {
  const c = S.vault.chats[id];
  let color = c.color;
  const name = h('input', { maxlength: 40, value: c.name || '', placeholder: 'Nome del contatto', 'data-chat': id, class: 'cname' });
  const phrase = h('input', { maxlength: 60, value: c.phrase || '' });
  const prevTxt = h('span', null, c.phrase || 'Hai una nota nuova');
  phrase.addEventListener('input', () => { prevTxt.textContent = phrase.value.trim() || 'Hai una nota nuova'; });
  const sw = h('div', { class: 'swatches' }, COLORS.map((col) => h('button', {
    class: col === color ? 'on' : '', style: `--c:${col}`, 'aria-label': 'Colore',
    onclick: (e) => { color = col; [...sw.children].forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); },
  })));
  openModal(isNew ? 'Nuovo contatto' : 'Impostazioni contatto',
    isNew ? h('p', { class: 'center' }, 'Dai un nome al contatto e scegli la frase in codice per le notifiche.') : null,
    h('label', { class: 'field' }, h('span', null, 'Nome (resta solo su questo telefono)'), name),
    h('div', { class: 'field' }, h('span', null, 'Colore'), sw),
    h('label', { class: 'field' }, h('span', null, 'Frase della notifica'), phrase),
    h('div', { class: 'chips' }, PHRASES.map((p) => h('button', { onclick: () => { phrase.value = p; prevTxt.textContent = p; } }, p))),
    h('div', { class: 'field' }, h('span', null, 'Anteprima sul telefono'),
      h('div', { class: 'notif' }, h('img', { src: 'icons/note-192.png', alt: '' }), h('div', null, h('small', null, 'Note'), prevTxt))),
    h('button', { class: 'btn', onclick: () => {
      c.name = name.value.trim() || c.name; c.color = color; c.phrase = phrase.value.trim() || 'Hai una nota nuova';
      saveVault(); closeModal(); renderList(); renderChat(); renderSide();
    } }, 'Salva'),
    h('button', { class: 'btn sec', onclick: () => openVerify(id) }, c.verified ? '🔒 Codice verificato · rivedi' : '⚠ Verifica il codice di sicurezza'),
    isNew ? null : h('button', { class: 'btn danger', onclick: () => removeChat(id) }, 'Elimina la chat da questo telefono'));
}

async function openVerify(id) {
  const c = S.vault.chats[id];
  const em = await C.safetyEmoji(c.myPub, c.theirPub);
  const note = h('p', { class: 'center' });
  openModal('Verifica sicurezza',
    h('p', { class: 'center' }, `Confronta queste emoji con quelle sul telefono di ${chatName(c)}, di persona o in videochiamata.`),
    h('div', { class: 'emoji' }, em.map((e) => h('span', null, e))),
    note,
    h('button', { class: 'btn', onclick: () => { c.verified = true; saveVault(); closeModal(); renderChat(); renderSide(); toast('Contatto verificato 🔒'); } }, 'Sono uguali ✓'),
    h('button', { class: 'btn sec', onclick: () => {
      c.verified = false; saveVault(); renderChat(); renderSide();
      note.textContent = '⚠ Se non combaciano, qualcuno potrebbe essersi messo in mezzo. Elimina la chat e rifate l\'invito di persona.';
    } }, 'Non combaciano'));
}

function removeChat(id) {
  const c = S.vault.chats[id];
  openModal('Eliminare la chat?',
    h('p', { class: 'center' }, `La chat con ${chatName(c)} e la sua chiave spariranno da questo telefono. Non si potrà recuperare.`),
    h('button', { class: 'btn danger', onclick: () => {
      const w = S.watch.get(id); if (w) { w.off(); S.watch.delete(id); }
      delete S.vault.chats[id]; S.msgs.delete(id); S.keys.delete(id); S.priv.delete(id); kvDel('priv:' + id);
      saveVault(); closeModal(); closeChat(); toast('Chat eliminata');
    } }, 'Elimina'),
    h('button', { class: 'btn sec', onclick: () => openContact(id) }, 'Annulla'));
}

// --- impostazioni generali ---
function openSettings() {
  const name = h('input', { maxlength: 40, value: S.vault.me.name || '', placeholder: 'Il tuo nome' });
  name.addEventListener('change', () => { S.vault.me.name = name.value.trim(); saveVault(); });
  openModal('Impostazioni',
    h('div', { class: 'about' }, h('img', { src: 'icons/wesec.svg', alt: '' }),
      h('div', null, h('b', null, 'WeSec ' + VERSION), h('div', { class: 'slogan' }, 'You and me. Stop.'))),
    h('div', { class: 'sect' }, h('h4', null, 'Profilo'),
      h('label', { class: 'field' }, h('span', null, 'Il tuo nome, inviato cifrato ai nuovi contatti'), name)),
    h('div', { class: 'sect' }, h('h4', null, 'Notifiche'), pushBlock()),
    h('div', { class: 'sect' }, h('h4', null, 'Sicurezza'),
      h('p', null, `Si blocca da sola dopo ${LOCK_HIDDEN_MS / 1000} secondi fuori dall'app o ${LOCK_IDLE_MS / 60000} minuti senza toccare nulla.`),
      h('button', { class: 'btn sec', onclick: lock }, '🔒 Blocca ora')),
    h('div', { class: 'sect' }, h('h4', null, 'Zona rossa'),
      h('p', null, 'Cancella PIN, chiavi e chat da questo dispositivo. Le chat non si potranno più leggere qui.'),
      h('button', { class: 'btn danger', onclick: wipeAll }, 'Cancella tutto da questo dispositivo')));
}
function wipeAll() {
  const inp = h('input', { placeholder: 'CANCELLA' });
  openModal('Cancellare tutto?',
    h('p', { class: 'center' }, 'Scrivi CANCELLA per confermare. L\'operazione non si può annullare.'),
    h('label', { class: 'field' }, inp),
    h('button', { class: 'btn danger', onclick: async () => {
      if (inp.value.trim().toUpperCase() !== 'CANCELLA') { toast('Scrivi CANCELLA'); return; }
      try { const reg = await navigator.serviceWorker.ready; const s = await reg.pushManager.getSubscription(); if (s) await s.unsubscribe(); } catch { /* niente */ }
      await kvClear(); location.reload();
    } }, 'Cancella tutto'),
    h('button', { class: 'btn sec', onclick: openSettings }, 'Annulla'));
}

// --- foto a schermo intero ---
async function openImage(id, d) {
  const img = h('img', { src: d.th, alt: 'Foto' });
  const close = h('button', { class: 'icon-btn x', 'aria-label': 'Chiudi', onclick: closeModal }, '✕');
  modal.className = 'modal lightbox';
  const del = d.priv ? h('button', { class: 'lb-del', onclick: async () => {
    const arr = S.priv.get(id) || [];
    S.priv.set(id, arr.filter((x) => x.id !== d.id)); await savePrivList(id);
    closeModal(); if (S.cur === id) { renderMsgs(false); renderSide(); } toast('Foto privata tolta da questa chat');
  } }, 'Elimina') : null;
  const share = d.priv ? h('button', { class: 'lb-share', onclick: async (e) => {
    e.target.disabled = true;
    if (await makeVisible(id, d)) closeModal(); else e.target.disabled = false;
  } }, '👁 Rendi visibile a ' + chatName(S.vault.chats[id])) : null;
  fill(modal, img, close, share, del);
  modal.onclick = (e) => { if (e.target === modal) closeModal(); };
  try {
    let url = S.media.get(d.id);
    if (!url) {
      const c = S.vault.chats[id];
      const enc = await B.getFile(id, d.id, c.token);
      const bytes = d.priv
        ? await C.decBytes(await personalKey(), d.iv, enc, 'me/' + id + '/' + d.id)
        : await C.decBytes(await chatKey(id), d.iv, enc, id + '/' + d.id);
      url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
      S.media.set(d.id, url);
    }
    if (img.isConnected) img.src = url;
  } catch (e) { console.warn(e); toast('Foto originale non disponibile'); }
}

boot();
