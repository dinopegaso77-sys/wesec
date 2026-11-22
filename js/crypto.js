// WeSec – crittografia (solo Web Crypto del browser, nessuna libreria esterna)
const S = crypto.subtle;
const te = new TextEncoder();
const td = new TextDecoder();

export const b64u = {
  enc(buf) {
    const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec(str) {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  },
};

export const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

// Codice invito leggibile: niente lettere ambigue (0/O, 1/I/L)
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function inviteCode(len = 10) {
  const r = rand(len);
  let s = '';
  for (const x of r) s += ALPHA[x % ALPHA.length];
  return s;
}
export const normCode = (s) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const prettyCode = (s) => s.slice(0, 5) + '-' + s.slice(5);

// ---- PIN -> chiave della cassaforte locale ----
export async function pinKey(pin, salt) {
  const base = await S.importKey('raw', te.encode('wesec-pin:' + pin), 'PBKDF2', false, ['deriveKey']);
  return S.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 310000 },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function sealJSON(key, obj, aad = '') {
  const iv = rand(12);
  const ct = await S.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(aad) }, key, te.encode(JSON.stringify(obj)));
  return { iv: b64u.enc(iv), ct: b64u.enc(ct) };
}
export async function openJSON(key, box, aad = '') {
  const pt = await S.decrypt({ name: 'AES-GCM', iv: b64u.dec(box.iv), additionalData: te.encode(aad) }, key, b64u.dec(box.ct));
  return JSON.parse(td.decode(pt));
}

// ---- Scambio chiavi per ogni chat (ECDH P-256) ----
export async function newKeyPair() {
  const kp = await S.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return {
    privJwk: await S.exportKey('jwk', kp.privateKey),
    pub: b64u.enc(await S.exportKey('raw', kp.publicKey)),
  };
}

function sortedPubs(a, b) { return [a, b].sort().join('.'); }

// Dalla mia chiave privata + chiave pubblica dell'altro: chiave messaggi + gettone server
export async function deriveChat(privJwk, myPub, theirPub) {
  const priv = await S.importKey('jwk', privJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const pub = await S.importKey('raw', b64u.dec(theirPub), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = await S.deriveBits({ name: 'ECDH', public: pub }, priv, 256);
  const hk = await S.importKey('raw', shared, 'HKDF', false, ['deriveBits']);
  const salt = new Uint8Array(await S.digest('SHA-256', te.encode(sortedPubs(myPub, theirPub))));
  const bits = async (info) => new Uint8Array(await S.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: te.encode(info) }, hk, 256));
  return { key: b64u.enc(await bits('wesec-msg-v1')), token: b64u.enc(await bits('wesec-srv-v1')) };
}

export const importChatKey = (raw) =>
  S.importKey('raw', b64u.dec(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

export async function encBytes(key, data, aad = '') {
  const iv = rand(12);
  const ct = await S.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(aad) }, key, data);
  return { iv: b64u.enc(iv), data: new Uint8Array(ct) };
}
export async function decBytes(key, iv, data, aad = '') {
  return new Uint8Array(await S.decrypt({ name: 'AES-GCM', iv: b64u.dec(iv), additionalData: te.encode(aad) }, key, data));
}

// ---- Codice di verifica: 12 emoji uguali sui due telefoni ----
const EMOJI = ['🦊','🌵','🚲','🎈','🍋','⚓','🧩','🌙','🎻','🐢','🍄','🔑','🐙','🌻','🚀','🍉',
  '🎲','🦉','🌈','🍩','🐝','🎸','🦋','🍒','🐳','🔔','🍀','🐧','🎯','🌋','🍕','🦁',
  '🚂','🎩','🐞','🌰','🛶','🎁','🦀','🍇','🐼','⛵','🍓','🦒','🎺','🌴','🐸','🍪',
  '🦄','🔥','🐬','🥕','🎨','🦔','🍔','⭐','🐿️','🧲','🍍','🦜','🎃','🌊','🧸','🍭'];
export async function safetyEmoji(pubA, pubB) {
  const h = new Uint8Array(await S.digest('SHA-256', te.encode('wesec-verify:' + sortedPubs(pubA, pubB))));
  let bits = 0n;
  for (let i = 0; i < 9; i++) bits = (bits << 8n) | BigInt(h[i]);
  const out = [];
  for (let i = 0; i < 12; i++) out.push(EMOJI[Number((bits >> BigInt(66 - i * 6)) & 63n)]);
  return out;
}
