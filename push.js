/* Avisos en el teléfono (notificaciones push).
   Pide el permiso una vez, registra este teléfono en Supabase y listo: desde ahí llegan
   los avisos de pedidos nuevos o modificados aunque la app esté cerrada.
   Se carga desde config.js y no depende del resto de la app. */
(function () {
  'use strict';
  var CFG = window.APP_CONFIG || {};
  var CLAVE_PUBLICA = 'BCwwYD150Ex9owlDzlyugOZJcARs1IEbfg5wGwM-8v5lctf-HX1B6i2SVXMSpqKbk6WfSMztWElnAZW_MT2AMlM';
  if (!CFG.url || !CFG.key || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;

  var ref = (CFG.url.match(/^https:\/\/([^.]+)\./) || [])[1];
  var CLAVE_SESION = 'sb-' + ref + '-auth-token';
  var banner = null;

  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  function jwt(token) {
    try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch (e) { return null; }
  }
  /* Sesión iniciada y con el token vigente (la app lo renueva sola). */
  function sesion() {
    try {
      var s = JSON.parse(localStorage.getItem(CLAVE_SESION) || 'null');
      var p = s && s.access_token ? jwt(s.access_token) : null;
      if (!p || !p.sub || !p.exp || p.exp * 1000 < Date.now() + 30000) return null;
      return { token: s.access_token, uid: p.sub };
    } catch (e) { return null; }
  }
  function appVisible() {
    var a = document.getElementById('app');
    return !!a && !a.hidden && getComputedStyle(a).display !== 'none';
  }
  function aBytes(b64) {
    var pad = '='.repeat((4 - b64.length % 4) % 4);
    var raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function registro() {
    return Promise.race([
      navigator.serviceWorker.ready,
      new Promise(function (_, no) { setTimeout(function () { no(new Error('sw')); }, 10000); })
    ]);
  }

  async function guardar(sub, s) {
    var j = sub.toJSON();
    var r = await fetch(CFG.url + '/rest/v1/push_suscripciones?on_conflict=endpoint', {
      method: 'POST',
      headers: {
        apikey: CFG.key, Authorization: 'Bearer ' + s.token,
        'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify({ user_id: s.uid, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth })
    });
    if (!r.ok) throw new Error('No se pudo registrar el teléfono (código ' + r.status + ').');
  }

  async function suscribirYGuardar() {
    var s = sesion();
    if (!s) throw new Error('Iniciá sesión de nuevo y probá otra vez.');
    var reg = await registro();
    var sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: aBytes(CLAVE_PUBLICA) });
    await guardar(sub, s);
    return reg;
  }

  function quitarBanner() { if (banner) { banner.remove(); banner = null; } }

  function mostrarBanner(texto, conBoton) {
    quitarBanner();
    banner = document.createElement('div');
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Avisos de pedidos');
    banner.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(76px + env(safe-area-inset-bottom,0px));z-index:60;' +
      'background:#1c6b50;color:#fff;padding:12px 14px;border-radius:12px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;' +
      'box-shadow:0 6px 18px rgba(0,0,0,.35);font:500 14px/1.35 system-ui,sans-serif';
    var t = document.createElement('span');
    t.style.cssText = 'flex:1 1 200px;min-width:0';
    t.textContent = texto;
    banner.appendChild(t);
    var fila = document.createElement('span');
    fila.style.cssText = 'display:flex;gap:8px';
    function boton(txt, fuerte, fn) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = txt;
      b.style.cssText = 'min-height:40px;padding:0 14px;border-radius:10px;border:1px solid rgba(255,255,255,.7);font:600 14px system-ui,sans-serif;cursor:pointer;' +
        (fuerte ? 'background:#fff;color:#14513c' : 'background:transparent;color:#fff');
      b.addEventListener('click', fn);
      fila.appendChild(b);
      return b;
    }
    if (conBoton) {
      var act = boton('Activar avisos', true, function () { activar(act); });
      boton('Ahora no', false, function () { ls('push_pospuesto', String(Date.now())); quitarBanner(); });
    } else {
      boton('Entendido', true, function () { ls('push_pista', '1'); quitarBanner(); });
    }
    banner.appendChild(fila);
    document.body.appendChild(banner);
  }

  /* Se llama desde el toque del botón: el permiso solo se puede pedir así. */
  function activar(btn) {
    btn.disabled = true; btn.textContent = 'Activando…';
    Notification.requestPermission().then(function (p) {
      if (p !== 'granted') {
        mostrarBanner('Los avisos quedaron desactivados. Si cambiás de idea, permitilos en los ajustes del sitio del navegador.', false);
        return;
      }
      return suscribirYGuardar().then(function (reg) {
        quitarBanner();
        return reg.showNotification('Avisos activados', {
          body: 'Vas a recibir un aviso cuando haya un pedido nuevo o modificado.',
          icon: 'icon-192.png', badge: 'icon-192.png', tag: 'avisos-activados'
        });
      });
    }).catch(function (e) {
      mostrarBanner((e && e.message) || 'No se pudieron activar los avisos. Probá de nuevo.', true);
    });
  }

  var intentos = 0;
  function iniciar() {
    if (!sesion() || !appVisible()) {
      if (++intentos < 120) setTimeout(iniciar, 2000);   // espera a que se inicie sesión
      return;
    }
    var permiso = Notification.permission;
    if (permiso === 'granted') {
      // Ya permitido: deja registrado este teléfono sin molestar.
      suscribirYGuardar().catch(function () {});
    } else if (permiso === 'default') {
      var pospuesto = Number(ls('push_pospuesto') || 0);
      if (Date.now() - pospuesto > 24 * 3600 * 1000) {
        mostrarBanner('Activá los avisos para enterarte de cada pedido nuevo o modificado, aunque la app esté cerrada.', true);
      }
    } else if (permiso === 'denied' && !ls('push_pista')) {
      mostrarBanner('Los avisos están bloqueados en este teléfono. Para recibirlos, permití las notificaciones de este sitio en los ajustes del navegador.', false);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(iniciar, 1500); });
  else setTimeout(iniciar, 1500);
})();
