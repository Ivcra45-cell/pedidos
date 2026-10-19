/* Service worker: permite instalar la app, abrirla sin conexión (pantallas ya visitadas)
   y mostrar los avisos de pedidos en el teléfono aunque la app esté cerrada.
   Los datos siempre vienen de Supabase; acá solo se guarda el código de la app. */
var VERSION = 'pedidos-v2';
var ARCHIVOS = ['./', 'index.html', 'style.css', 'app.js', 'config.js', 'push.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(ARCHIVOS); }).catch(function () {}).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then(function (res) {
      var copia = res.clone();
      caches.open(VERSION).then(function (c) { c.put(req, copia); });
      return res;
    }).catch(function () { return caches.match(req).then(function (r) { return r || caches.match('index.html'); }); })
  );
});

/* Aviso que llega desde el servidor cuando se carga o modifica un pedido. */
self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (lista) {
    // Si la app está abierta y a la vista, ya muestra el aviso adentro: no se duplica.
    var abierta = lista.some(function (c) { return c.visibilityState === 'visible' && c.focused; });
    if (abierta) return;
    return self.registration.showNotification(d.title || 'Pedidos', {
      body: d.body || '',
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      tag: d.tag || 'pedidos',
      renotify: true,
      vibrate: [200, 100, 200],
      data: { url: d.url || './' }
    });
  }));
});

/* Al tocar el aviso se abre la app (o se vuelve a ella si ya estaba abierta). */
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (lista) {
    for (var i = 0; i < lista.length; i++) { if ('focus' in lista[i]) return lista[i].focus(); }
    return self.clients.openWindow(url);
  }));
});
