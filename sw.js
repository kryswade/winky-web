/* Winky Community — Service Worker for Web Push.
   Host this file next to index.html on GitHub Pages (same folder). */
const BRAND = 'Winky Community';
const ICON = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/72x72/1f4ac.png';

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data ? event.data.text() : '' }; }
  const title = data.title || BRAND;
  const options = {
    body: data.body || 'New message',
    icon: data.icon || ICON,
    badge: ICON,
    tag: data.tag || 'winky',
    renotify: true,
    // Open the project folder (the SW scope), not the domain root.
    data: { url: self.registration.scope }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Scope is the folder where sw.js lives, e.g. https://user.github.io/winky/
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // Focus an already-open Winky tab if present.
      for (const c of list) {
        if (c.url && c.url.indexOf(self.registration.scope) === 0 && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
