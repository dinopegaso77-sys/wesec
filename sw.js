// Note (WeSec) – service worker: solo notifiche in codice.
// Il pacchetto push contiene soltanto l'id casuale della chat; la frase da mostrare
// è salvata sul telefono, quindi non passa mai dal server.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

function readPhrases() {
  return new Promise((res) => {
    const r = indexedDB.open('note-db', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onerror = () => res({});
    r.onsuccess = () => {
      try {
        const g = r.result.transaction('kv', 'readonly').objectStore('kv').get('phr');
        g.onsuccess = () => res(g.result || {});
        g.onerror = () => res({});
      } catch (e) { res({}); }
    };
  });
}

self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let chat = '';
    try { chat = (e.data && e.data.json().c) || ''; } catch (x) {}
    const phr = await readPhrases();
    const body = (phr[chat] && phr[chat].trim()) || 'Hai una nota nuova';
    await self.registration.showNotification('Note', {
      body, tag: chat || 'note', renotify: true,
      icon: 'icons/note-192.png', badge: 'icons/note-192.png', data: { c: chat },
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow('./');
  })());
});
