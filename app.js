/* Pedidos y Catálogo — app web instalable (PWA) conectada a Supabase. */
(function () {
'use strict';

var CFG = window.APP_CONFIG || {};
var $ = function (s) { return document.querySelector(s); };
var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
var money = function (n) { return 'Gs. ' + Math.round(Number(n) || 0).toLocaleString('es-PY', { maximumFractionDigits: 0 }); };
var pad = function (n) { return String(n || 0).padStart(4, '0'); };
var ftime = function (t) { return new Date(t).toLocaleString('es-PY', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
var fdia = function (f) { var p = String(f || '').split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : ''; };
var hoy = function () { return new Date().toLocaleDateString('en-CA'); };
var ESTADO = { pendiente: 'Pendiente', entregado: 'Entregado', cancelado: 'Cancelado' };
var IC_PLUS = '<svg class="ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';
var IC_BELL = '<svg class="ic" viewBox="0 0 24 24"><path d="M6 9a6 6 0 1112 0c0 6 2 7 2 7H4s2-1 2-7"/><path d="M10 20a2 2 0 004 0"/></svg>';
function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

if (!window.supabase || !CFG.url || !CFG.key) {
  document.body.innerHTML = '<p style="padding:24px;font-family:sans-serif">No se pudo cargar la app. Revisá la conexión a internet y volvé a abrirla.</p>';
  return;
}
var sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

var me = { id: null, email: '', nombre: '', rol: 'vendedor' };
var S = { costos: {}, prods: [], clientes: [], peds: [], avisos: [], miembros: [], cfg: { nombre: '' }, tab: 'pedidos', filtro: 'todos', q: '', cat: 'todas', prov: 'todos', catOff: {}, catPrecios: true, ok: false, err: null, delM: null };
var stack = [];
var deferredInstall = null;
var loadT = Date.now();
var authMode = 'in';

/* ---------- utilidades ---------- */
var toastT;
function toast(m, ms) { var t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, ms || 3200); }
function seen() { return Number(ls('visto') || 0); }
function unread() { return S.avisos.filter(function (a) { return a.t > seen() && a.por !== me.id; }).length; }
function who(por, nombre) { return por === me.id ? 'Vos' : (nombre || 'Familia'); }
function cats() { var o = {}; S.prods.forEach(function (p) { o[p.categoria || 'Sin categoría'] = 1; }); return Object.keys(o).sort(function (a, b) { return a.localeCompare(b, 'es'); }); }
function provs() { var o = {}; S.prods.forEach(function (p) { if (p.proveedor) o[p.proveedor] = 1; }); return Object.keys(o).sort(function (a, b) { return a.localeCompare(b, 'es'); }); }
function dlist(id, arr) { return '<datalist id="' + id + '">' + arr.map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') + '</datalist>'; }
/* clientes: se muestra el nombre fantasía (el local); si no tiene, el nombre */
function cliNom(c) { return c.fantasia || c.nombre; }
function cliEtiquetas() {
  var base = S.clientes.map(function (c) { return cliNom(c) + (c.fantasia && c.nombre && c.fantasia.toLowerCase() !== c.nombre.toLowerCase() ? ' · ' + c.nombre : ''); });
  return S.clientes.map(function (c, i) {
    var dup = base.filter(function (b) { return b.toLowerCase() === base[i].toLowerCase(); }).length > 1;
    return { c: c, v: base[i] + (dup ? ' (' + (c.doc || c.tel || c.dir || c.id.slice(0, 4)) + ')' : '') };
  });
}
function cliLinea(c) { return [c.tel, c.doc, c.dir].filter(Boolean).join(' · '); }
function telHref(t) { return 'tel:' + String(t || '').replace(/[^\d+]/g, ''); }
function mapHref(d) { return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(d); }
function faltasTxt(l) { return l && l.length ? ' Stock insuficiente: ' + l.map(function (x) { return x.nombre + ' (faltan ' + x.faltan + ')'; }).join(', ') + '.' : ''; }
var ROLES = { admin: 'Administrador', encargado: 'Encargado', vendedor: 'Vendedor' };
var ROLDESC = { admin: 'Todo, incluido este panel de cuentas.', encargado: 'Todo menos administrar cuentas: mercadería, costos y eliminar pedidos.', vendedor: 'Carga y edita pedidos y clientes. No ve costos ni edita mercadería.' };
function esAdmin() { return me.rol === 'admin'; }
function esGestor() { return me.rol === 'admin' || me.rol === 'encargado'; }
function errMsg(e, def) {
  var m = (e && (e.message || e.error_description)) || '';
  if (/Falta |ya no existe|no autorizado/i.test(m)) return m;
  return def;
}
function show(id) {
  ['login', 'denied', 'app'].forEach(function (k) { $('#' + k).hidden = (k !== id); });
  $('nav').hidden = (id !== 'app');
  $('#fab').hidden = (id !== 'app');
}

/* ---------- imágenes privadas (Storage) ---------- */
var imgCache = new Map();
function imgBlobUrl(path) {
  if (!path) return Promise.resolve(null);
  if (!imgCache.has(path)) {
    imgCache.set(path, sb.storage.from('fotos').download(path).then(function (r) {
      if (r.error || !r.data) throw r.error || new Error('sin foto');
      return URL.createObjectURL(r.data);
    }).catch(function () { imgCache.delete(path); return null; }));
  }
  return imgCache.get(path);
}
function sinFoto(im) {
  if (im.dataset.ph !== undefined) { var d = document.createElement('div'); d.className = 'ph'; d.textContent = im.dataset.ph; im.replaceWith(d); }
  else { im.alt = 'No se pudo cargar la foto'; }
}
function hidratar() {
  document.querySelectorAll('img[data-sp]:not([data-h])').forEach(function (im) {
    im.dataset.h = '1';
    imgBlobUrl(im.dataset.sp).then(function (u) { if (!im.isConnected) return; if (u) im.src = u; else sinFoto(im); });
  });
}
new MutationObserver(hidratar).observe(document.body, { childList: true, subtree: true });
document.addEventListener('error', function (e) { var t = e.target; if (t && t.tagName === 'IMG' && t.dataset && t.dataset.ph !== undefined) sinFoto(t); }, true);
function imgHtml(preview, path, alt) {
  if (preview) return '<img class="photo" alt="' + esc(alt) + '" src="' + esc(preview) + '">';
  if (path) return '<img class="photo" alt="' + esc(alt) + '" data-sp="' + esc(path) + '">';
  return '';
}
function thumb(p) {
  var ini = esc((p.nombre || '?').trim().charAt(0).toUpperCase());
  if (p.imagen) return '<img class="pi" alt="" data-sp="' + esc(p.imagen) + '" data-ph="' + ini + '">';
  return '<div class="ph">' + ini + '</div>';
}
function loadImg(src) { return new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = rej; i.src = src; }); }
async function reducir(file, max, q) {
  if (!file || !/^image\//.test(file.type)) throw new Error('no-img');
  var url = URL.createObjectURL(file);
  try {
    var img = await loadImg(url), s = Math.min(1, max / Math.max(img.width, img.height));
    var c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise(function (r) { c.toBlob(r, 'image/jpeg', q); });
  } finally { URL.revokeObjectURL(url); }
}
async function subirFoto(carpeta, blob) {
  var id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + '-' + Math.random().toString(16).slice(2));
  var path = carpeta + '/' + id + '.jpg';
  var r = await sb.storage.from('fotos').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '3600' });
  if (r.error) throw r.error;
  return path;
}

/* ---------- datos ---------- */
function mapPedido(r) {
  return {
    id: r.id, numero: Number(r.numero), cliente: r.cliente, clienteId: r.cliente_id || null, fecha: r.fecha, estado: r.estado, nota: r.nota || '',
    ticket: r.ticket_path || null, total: Number(r.total) || 0, creadoPor: r.creado_por,
    items: (r.pedido_items || []).slice().sort(function (a, b) { return (a.orden || 0) - (b.orden || 0); }).map(function (i) {
      return { pid: i.producto_id, nombre: i.nombre, precio: Number(i.precio) || 0, cant: i.cantidad, desc: i.descontado || 0 };
    }),
    historial: (r.pedido_historial || []).slice().sort(function (a, b) { return Date.parse(a.creado_en) - Date.parse(b.creado_en); }).map(function (h) {
      return { t: Date.parse(h.creado_en), por: h.por, nombre: h.por_nombre, txt: h.texto };
    })
  };
}
async function cargar() {
  var r = await Promise.all([
    sb.from('productos').select('*').order('nombre'),
    sb.from('pedidos').select('*, pedido_items(*), pedido_historial(*)').order('numero', { ascending: false }).limit(500),
    sb.from('avisos').select('*').order('creado_en', { ascending: false }).limit(60),
    sb.from('negocio').select('*').eq('id', 1).maybeSingle(),
    sb.from('miembros').select('*').order('creado_en'),
    sb.from('clientes').select('*').order('nombre'),
    sb.from('producto_costos').select('*')
  ]);
  var bad = r.slice(0, 6).find(function (x) { return x.error; });
  if (bad) { S.err = bad.error.message || 'error'; throw bad.error; }
  S.err = null;
  S.prods = (r[0].data || []).map(function (p) {
    return { id: p.id, nombre: p.nombre, categoria: p.categoria, proveedor: p.proveedor || '', precio: Number(p.precio) || 0, costo: null, stock: p.stock == null ? null : Number(p.stock), imagen: p.imagen_path || null };
  });
  S.peds = (r[1].data || []).map(mapPedido);
  S.avisos = (r[2].data || []).map(function (a) {
    return { id: a.id, t: Date.parse(a.creado_en), tipo: a.tipo, pedidoId: a.pedido_id, numero: a.numero, cliente: a.cliente, por: a.por, nombre: a.por_nombre, resumen: a.resumen };
  });
  S.cfg = r[3].data || { nombre: '' };
  S.miembros = r[4].data || [];
  var yo2 = S.miembros.find(function (m) { return (m.email || '').toLowerCase() === me.email; });
  if (yo2) {
    me.rol = yo2.rol || 'vendedor';
    if (yo2.activo === false) { mostrarDenegado(true); throw new Error('bloqueada'); }
  }
  S.costos = {};
  ((r[6] && !r[6].error && r[6].data) || []).forEach(function (c) { S.costos[c.producto_id] = Number(c.costo); });
  S.prods.forEach(function (p) { p.costo = S.costos[p.id] == null ? null : S.costos[p.id]; });
  S.clientes = (r[5].data || []).map(function (c) {
    return { id: c.id, nombre: c.nombre || '', fantasia: c.nombre_fantasia || '', tel: c.telefono || '', doc: c.documento || '', dir: c.direccion || '' };
  });
  S.ok = true;
}
var recT;
function recargar() {
  clearTimeout(recT);
  recT = setTimeout(function () { cargar().then(drawAll).catch(function () {}); }, 250);
}
function avisoTexto(a) {
  var q = who(a.por, a.nombre);
  if (a.resumen === 'Eliminó el pedido') return q + ' eliminó el pedido Nº ' + pad(a.numero) + ' de ' + a.cliente;
  return a.tipo === 'nuevo' ? q + ' cargó el pedido Nº ' + pad(a.numero) + ' de ' + a.cliente : q + ' modificó el pedido Nº ' + pad(a.numero) + ' de ' + a.cliente;
}
function suscribir() {
  sb.channel('cambios')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, recargar)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'productos' }, recargar)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'negocio' }, recargar)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'clientes' }, recargar)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'avisos' }, function (pl) {
      var a = pl.new || {};
      if (a.por !== me.id) {
        toast(avisoTexto({ por: a.por, nombre: a.por_nombre, tipo: a.tipo, numero: a.numero, cliente: a.cliente, resumen: a.resumen }), 5000);
        if (navigator.vibrate) { try { navigator.vibrate(120); } catch (e) {} }
      }
      recargar();
    })
    .subscribe();
  document.addEventListener('visibilitychange', function () { if (!document.hidden) recargar(); });
  window.addEventListener('online', recargar);
}

/* ---------- acceso (login) ---------- */
function setAuthMode(m) {
  authMode = m;
  var email = $('#a-email-w'), pass = $('#a-pass'), pl = $('#a-pass-l'), go = $('#a-go'), sub = $('#auth-sub'), tg = $('#a-toggle'), fg = $('#a-forgot');
  $('#a-msg').textContent = ''; $('#a-msg').className = 'err';
  email.hidden = (m === 'newpass');
  $('#a-email').required = (m !== 'newpass');
  tg.hidden = fg.hidden = (m === 'newpass');
  if (m === 'in') { sub.textContent = 'Entrá con tu email y contraseña.'; pl.textContent = 'Contraseña'; go.textContent = 'Entrar'; tg.textContent = 'Primera vez: crear mi cuenta'; pass.autocomplete = 'current-password'; fg.hidden = false; }
  else if (m === 'up') { sub.textContent = 'Creá tu cuenta con el email que te autorizaron.'; pl.textContent = 'Elegí una contraseña (mínimo 6 caracteres)'; go.textContent = 'Crear cuenta'; tg.textContent = 'Ya tengo cuenta: entrar'; pass.autocomplete = 'new-password'; fg.hidden = true; }
  else { sub.textContent = 'Elegí tu nueva contraseña.'; pl.textContent = 'Nueva contraseña (mínimo 6 caracteres)'; go.textContent = 'Guardar contraseña'; pass.autocomplete = 'new-password'; }
}
function authMsg(t, ok) { var m = $('#a-msg'); m.textContent = t; m.className = ok ? 'ok' : 'err'; }
function traducir(e) {
  var m = (e && e.message) || '';
  if (/Invalid login credentials/i.test(m)) return 'Email o contraseña incorrectos.';
  if (/banned/i.test(m)) return 'Esta cuenta está bloqueada. Hablá con el administrador.';
  if (/not confirmed/i.test(m)) return 'Todavía falta confirmar tu email. Abrí el enlace que te llegó al correo (revisá también spam).';
  if (/already registered/i.test(m)) return 'Ese email ya tiene cuenta. Tocá «Ya tengo cuenta» y entrá con tu contraseña.';
  if (/rate limit|too many/i.test(m)) return 'Se enviaron demasiados mensajes. Esperá unos minutos y probá de nuevo.';
  if (/at least 6|Password should/i.test(m)) return 'La contraseña tiene que tener al menos 6 caracteres.';
  if (/network|fetch/i.test(m)) return 'No hay conexión. Revisá internet y probá de nuevo.';
  return 'No se pudo completar. Probá de nuevo en un momento.';
}
async function onAuthSubmit(e) {
  e.preventDefault();
  var email = $('#a-email').value.trim(), pass = $('#a-pass').value, btn = $('#a-go');
  authMsg('');
  btn.disabled = true;
  try {
    if (authMode === 'in') {
      var r = await sb.auth.signInWithPassword({ email: email, password: pass });
      if (r.error) throw r.error;
      await entrar(r.data.session);
    } else if (authMode === 'up') {
      var r2 = await sb.auth.signUp({ email: email, password: pass, options: { emailRedirectTo: location.origin + location.pathname } });
      if (r2.error) throw r2.error;
      if (r2.data && r2.data.session) await entrar(r2.data.session);
      else authMsg('Te mandamos un correo para confirmar la cuenta. Abrí el enlace y después entrá con tu contraseña.', true);
    } else {
      var r3 = await sb.auth.updateUser({ password: pass });
      if (r3.error) throw r3.error;
      var ss = await sb.auth.getSession();
      if (ss.data.session) await entrar(ss.data.session);
    }
  } catch (err) { authMsg(traducir(err)); }
  finally { btn.disabled = false; }
}
async function onForgot() {
  var email = $('#a-email').value.trim();
  if (!email) { authMsg('Escribí tu email arriba y volvé a tocar «Olvidé mi contraseña».'); $('#a-email').focus(); return; }
  var r = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  if (r.error) authMsg(traducir(r.error)); else authMsg('Si ese email tiene cuenta, te mandamos un enlace para elegir una contraseña nueva.', true);
}
function mostrarDenegado(bloqueada) {
  $('#denied-msg').innerHTML = bloqueada
    ? 'La cuenta <b>' + esc(me.email) + '</b> está bloqueada. Hablá con el administrador.'
    : 'La cuenta <b>' + esc(me.email) + '</b> todavía no está autorizada para usar esta app. Pedile al administrador que te agregue, o entrá con otro email.';
  show('denied');
}
async function entrar(session) {
  if (!session) { show('login'); return; }
  me.id = session.user.id; me.email = (session.user.email || '').toLowerCase();
  var r = await sb.from('miembros').select('*');
  if (r.error) { authMsg('No se pudo comprobar tu acceso. Revisá la conexión.'); show('login'); return; }
  var yo = (r.data || []).find(function (m) { return (m.email || '').toLowerCase() === me.email; });
  if (!yo) { mostrarDenegado(false); return; }
  if (yo.activo === false) { mostrarDenegado(true); return; }
  me.nombre = yo.nombre || me.email.split('@')[0];
  me.rol = yo.rol || 'vendedor';
  S.miembros = r.data;
  show('app');
  drawTop(); drawTab();
  try { await cargar(); } catch (e) { /* el error se muestra en la lista */ }
  drawAll();
  if (!entrar.hecho) { entrar.hecho = true; suscribir(); }
}
async function salir() { try { await sb.auth.signOut(); } catch (e) {} location.reload(); }

/* ---------- dibujo principal ---------- */
function drawTop() {
  var n = unread();
  $('#bell').innerHTML = IC_BELL + (n ? '<span class="badge">' + (n > 9 ? '9+' : n) + '</span>' : '');
  $('#bell').setAttribute('aria-label', n ? 'Avisos, ' + n + ' nuevos' : 'Avisos');
  $('#ttl').textContent = S.cfg.nombre || 'Pedidos y mercadería';
}
function drawTab() {
  ['pedidos', 'clientes', 'merc', 'cat', 'ajustes'].forEach(function (k) { $('#n-' + k).classList.toggle('on', S.tab === k); });
  var tb = $('#toolbar'), fab = $('#fab');
  if (S.tab === 'pedidos') {
    tb.innerHTML = '<input type="search" id="q" placeholder="Buscar cliente o número" value="' + esc(S.q) + '" aria-label="Buscar pedidos">' +
      '<div class="chips">' + [['todos', 'Todos'], ['pendiente', 'Pendientes'], ['entregado', 'Entregados'], ['cancelado', 'Cancelados']].map(function (c) { return '<button class="chip' + (S.filtro === c[0] ? ' on' : '') + '" data-act="filt" data-v="' + c[0] + '">' + c[1] + '</button>'; }).join('') + '</div>';
    fab.innerHTML = IC_PLUS + 'Nuevo pedido'; fab.hidden = false;
  } else if (S.tab === 'clientes') {
    tb.innerHTML = '<input type="search" id="q" placeholder="Buscar por nombre, teléfono, cédula o RUC" value="' + esc(S.q) + '" aria-label="Buscar clientes">';
    fab.innerHTML = IC_PLUS + 'Nuevo cliente'; fab.hidden = false;
  } else if (S.tab === 'merc') {
    tb.innerHTML = '<input type="search" id="q" placeholder="Buscar producto" value="' + esc(S.q) + '" aria-label="Buscar productos">' +
      '<div class="chips">' + ['todas'].concat(cats()).map(function (c) { return '<button class="chip' + (S.cat === c ? ' on' : '') + '" data-act="cat" data-v="' + esc(c) + '">' + (c === 'todas' ? 'Todas' : esc(c)) + '</button>'; }).join('') + '</div>' +
      (provs().length ? '<div class="chips"><span class="chip-l">Proveedor</span>' + ['todos'].concat(provs()).map(function (c) { return '<button class="chip' + (S.prov === c ? ' on' : '') + '" data-act="prov" data-v="' + esc(c) + '">' + (c === 'todos' ? 'Todos' : esc(c)) + '</button>'; }).join('') + '</div>' : '');
    fab.innerHTML = IC_PLUS + 'Nuevo producto'; fab.hidden = !esGestor();
  } else {
    tb.innerHTML = ''; fab.hidden = true;
  }
  drawList();
}
function drawList() {
  var L = $('#list');
  if (S.err && !S.ok) { L.innerHTML = '<div class="empty">No se pudo leer la información (' + esc(S.err) + '). Revisá la conexión y recargá la página.</div>'; return; }
  if (!S.ok) { L.innerHTML = '<p class="muted">Cargando…</p>'; return; }
  L.innerHTML = S.tab === 'pedidos' ? vPedidos() : S.tab === 'clientes' ? vClientes() : S.tab === 'merc' ? vMerc() : S.tab === 'cat' ? vCat() : vAjustes();
  var biz = $('#biz'); if (biz) biz.value = S.cfg.nombre || '';
}
function drawAll() {
  drawTop();
  var enAjustes = S.tab === 'ajustes' && document.activeElement && $('#list').contains(document.activeElement);
  if (!enAjustes) drawList();
  if (S.tab === 'merc') { var ch = $('#toolbar .chips'); if (ch && !(document.activeElement && document.activeElement.id === 'q')) drawTab(); }
  stack.forEach(function (r) { if (r.refresh) r.refresh(); });
}

function vPedidos() {
  var q = S.q.trim().toLowerCase();
  var l = S.peds.filter(function (p) { return (S.filtro === 'todos' || p.estado === S.filtro) && (!q || (p.cliente || '').toLowerCase().indexOf(q) >= 0 || pad(p.numero).indexOf(q) >= 0 || String(p.numero) === q); })
    .sort(function (a, b) { return (b.numero || 0) - (a.numero || 0); });
  if (!l.length) {
    return S.peds.length ? '<div class="empty">No hay pedidos que coincidan.</div>' :
      '<div class="empty"><span>Todavía no hay pedidos. Cuando se cargue el primero, aparece acá y le llega el aviso al otro teléfono.</span><button class="btn primary" data-act="fab">Cargar el primer pedido</button></div>';
  }
  return '<div class="list">' + l.map(function (p) {
    var n = p.items.length, mod = p.historial.length > 1;
    return '<button class="slip" data-act="openped" data-id="' + esc(p.id) + '"><span class="stub"><small>Nº</small><b>' + pad(p.numero) + '</b></span>' +
      '<span class="slip-main"><strong>' + esc(p.cliente) + '</strong><span class="pill ' + esc(p.estado) + '">' + esc(ESTADO[p.estado] || p.estado) + '</span>' +
      '<span class="meta">' + fdia(p.fecha) + ' · ' + n + ' ítem' + (n === 1 ? '' : 's') + (mod ? ' · <em>modificado</em>' : '') + '</span>' +
      '<span class="amt">' + money(p.total) + '</span></span></button>';
  }).join('') + '</div>';
}
function vClientes() {
  var q = S.q.trim().toLowerCase(), qd = q.replace(/[^0-9a-z]/g, '');
  var l = S.clientes.filter(function (c) {
    if (!q) return true;
    var txt = [c.nombre, c.fantasia, c.tel, c.doc, c.dir].join(' ').toLowerCase();
    return txt.indexOf(q) >= 0 || (qd && (c.doc + c.tel).toLowerCase().replace(/[^0-9a-z]/g, '').indexOf(qd) >= 0);
  }).sort(function (a, b) { return cliNom(a).localeCompare(cliNom(b), 'es'); });
  if (!l.length) return S.clientes.length ? '<div class="empty">No hay clientes que coincidan.</div>' :
    '<div class="empty"><span>Todavía no hay clientes. Cargá cada uno una sola vez (nombre, local, teléfono, cédula o RUC y dirección) y después lo elegís al hacer un pedido.</span><button class="btn primary" data-act="fab">Cargar el primer cliente</button></div>';
  return '<div class="list">' + l.map(function (c) {
    var n = S.peds.filter(function (p) { return p.clienteId === c.id; }).length;
    return '<button class="cli" data-act="editcli" data-id="' + esc(c.id) + '"><span class="ph cini">' + esc(cliNom(c).trim().charAt(0).toUpperCase()) + '</span>' +
      '<span class="cli-b"><strong>' + esc(cliNom(c)) + '</strong>' +
      (c.fantasia && c.nombre && c.fantasia.toLowerCase() !== c.nombre.toLowerCase() ? '<span>' + esc(c.nombre) + '</span>' : '') +
      (cliLinea(c) ? '<small>' + esc(cliLinea(c)) + '</small>' : '<small>Sin más datos</small>') +
      '</span><span class="cli-n">' + n + '<small>pedido' + (n === 1 ? '' : 's') + '</small></span></button>';
  }).join('') + '</div>';
}
function stockTxt(p) {
  if (p.stock == null) return '<small class="stk">Sin stock cargado</small>';
  var cls = p.stock === 0 ? ' cero' : (p.stock <= 5 ? ' low' : '');
  return '<small class="stk' + cls + '">' + (p.stock === 0 ? 'Sin stock' : 'Stock: ' + p.stock.toLocaleString('es-PY')) + '</small>';
}
function vMerc() {
  if (S.prov !== 'todos' && provs().indexOf(S.prov) < 0) S.prov = 'todos';
  var q = S.q.trim().toLowerCase();
  var l = S.prods.filter(function (p) { return (S.cat === 'todas' || (p.categoria || 'Sin categoría') === S.cat) && (S.prov === 'todos' || (p.proveedor || '') === S.prov) && (!q || ((p.nombre || '') + ' ' + (p.proveedor || '')).toLowerCase().indexOf(q) >= 0); });
  if (!l.length) return S.prods.length ? '<div class="empty">No hay productos que coincidan.</div>' :
    '<div class="empty"><span>Todavía no hay mercadería cargada. Cada producto lleva foto, categoría, precio de venta y cantidad en stock.</span>' + (esGestor() ? '<button class="btn primary" data-act="fab">Cargar el primer producto</button>' : '') + '</div>';
  var g = {}; l.forEach(function (p) { var c = p.categoria || 'Sin categoría'; (g[c] = g[c] || []).push(p); });
  return Object.keys(g).sort(function (a, b) { return a.localeCompare(b, 'es'); }).map(function (c) {
    return '<h2 class="cat-h">' + esc(c) + '</h2><div class="grid">' + g[c].sort(function (a, b) { return (a.nombre || '').localeCompare(b.nombre || '', 'es'); }).map(function (p) {
      return '<button class="pcard" data-act="editprod" data-id="' + esc(p.id) + '">' + thumb(p) + '<span class="pc-b"><span>' + esc(p.nombre) + '</span>' + (p.proveedor ? '<small class="prov">' + esc(p.proveedor) + '</small>' : '') + '<b>' + money(p.precio) + '</b>' + stockTxt(p) + '</span></button>';
    }).join('') + '</div>';
  }).join('');
}
function vCat() {
  var cs = cats();
  if (!S.prods.length) return '<div class="empty">Cargá productos en la pestaña Mercadería para armar el catálogo.</div>';
  var on = S.prods.filter(function (p) { return !S.catOff[p.categoria || 'Sin categoría']; });
  var sf = on.filter(function (p) { return !p.imagen; }).length;
  return '<p class="muted">Nombre que sale en el catálogo: <b>' + esc(S.cfg.nombre || 'sin nombre (se cambia en Ajustes)') + '</b></p>' +
    '<h2 class="sec">Categorías a incluir</h2><div class="box checks">' + cs.map(function (c) {
      var n = S.prods.filter(function (p) { return (p.categoria || 'Sin categoría') === c; }).length;
      return '<label><input type="checkbox" data-act="togcat" data-v="' + esc(c) + '"' + (S.catOff[c] ? '' : ' checked') + '>' + esc(c) + '<span class="n">' + n + '</span></label>';
    }).join('') + '</div>' +
    '<div class="box checks" style="margin-top:12px"><label><input type="checkbox" data-act="togprecio"' + (S.catPrecios ? ' checked' : '') + '>Mostrar precios</label></div>' +
    (sf ? '<div class="warnbox" style="margin-top:12px">' + sf + ' producto' + (sf === 1 ? '' : 's') + ' sin foto. Va a salir un recuadro con la inicial.</div>' : '') +
    '<p class="muted">' + on.length + ' producto' + (on.length === 1 ? '' : 's') + ' en el catálogo, ordenados por categoría y nombre.</p>' +
    '<button class="btn primary" style="width:100%" data-act="gencat"' + (on.length ? '' : ' disabled') + ' id="gencat">Generar catálogo en PDF</button>';
}
function vAjustes() {
  var inst = deferredInstall ? '<button class="btn" data-act="instalar">Instalar la app en el teléfono</button>' :
    '<p class="muted" style="margin:0">Para instalarla: en Chrome tocá el menú ⋮ y elegí «Instalar app» o «Agregar a la pantalla principal».</p>';
  return '<div class="ajuste-sec"><h2 class="sec">Negocio</h2>' +
    (esGestor() ? '<label class="field">Nombre del negocio (sale en el catálogo y en los PDF)<input type="text" id="biz" placeholder="Ej.: Dulce Capricho"></label>' :
      '<p class="muted" style="margin:0">Nombre del negocio: <b>' + esc(S.cfg.nombre || 'sin nombre') + '</b></p>') + '</div>' +
    '<div class="ajuste-sec" style="margin-top:22px"><h2 class="sec">Ganancias y ventas</h2><p class="muted" style="margin:0;font-size:13px">Lo vendido por día, semana o mes, la ganancia y la lista de ventas con la hora en que se hicieron y se entregaron.</p><button class="btn primary" data-act="gan">Ver ganancias y ventas</button></div>' +
    (esAdmin() ? '<div class="ajuste-sec" style="margin-top:22px"><h2 class="sec">Administración</h2><p class="muted" style="margin:0;font-size:13px">Cuentas de la app: agregar personas, asignar roles, bloquear y cambiar contraseñas. Solo lo ves vos.</p><button class="btn" data-act="admin">Administrar cuentas</button></div>' : '') +
    '<div class="ajuste-sec" style="margin-top:22px"><h2 class="sec">Ticket</h2><label class="field">Ancho del papel de la impresora<select id="tkw"><option value="80"' + (ls('tkw') === '58' ? '' : ' selected') + '>80 mm (el más común)</option><option value="58"' + (ls('tkw') === '58' ? ' selected' : '') + '>58 mm (angosto)</option></select></label></div>' +
    '<div class="ajuste-sec" style="margin-top:22px"><h2 class="sec">En este teléfono</h2>' + inst + '</div>' +
    '<div class="ajuste-sec" style="margin-top:22px"><h2 class="sec">Cuenta</h2><p class="muted" style="margin:0">Sesión iniciada como ' + esc(me.email) + '</p><p class="muted" style="margin:0">Tu rol: <b>' + esc(ROLES[me.rol] || me.rol) + '</b></p><p class="muted" style="margin:0;font-size:12px">Versión de la app: 27/10 · ganancias</p><button class="btn" data-act="logout">Cerrar sesión</button></div>';
}

/* ---------- hojas (pantallas completas) ---------- */
function openSheet(title, build, backLabel) {
  var el = document.createElement('div'); el.className = 'sheet';
  el.innerHTML = '<div class="sh-in"><div class="sh-top"><button class="ghost" data-act="close" aria-label="Volver">‹ ' + (backLabel || 'Volver') + '</button><h2></h2><span class="sp"></span></div><div class="sh-body"></div></div>';
  el.querySelector('h2').textContent = title;
  document.body.appendChild(el); document.body.classList.add('lock');
  var rec = { el: el, body: el.querySelector('.sh-body'), setTitle: function (t) { el.querySelector('h2').textContent = t; } };
  stack.push(rec); build(rec); return rec;
}
function closeSheet() { var r = stack.pop(); if (r) { r.el.remove(); if (r.onClose) r.onClose(); } if (!stack.length) document.body.classList.remove('lock'); }

function detailHTML(p, rec) {
  var items = p.items.map(function (i) { return '<li><span>' + esc(i.nombre) + '<small>' + i.cant + ' × ' + money(i.precio) + (i.desc > 0 ? ' · stock −' + i.desc : '') + '</small></span><b>' + money(i.cant * i.precio) + '</b></li>'; }).join('');
  var est = ['pendiente', 'entregado', 'cancelado'].map(function (k) { return '<button class="seg' + (p.estado === k ? ' on' : '') + '" data-act="setestado" data-id="' + esc(p.id) + '" data-v="' + k + '">' + ESTADO[k] + '</button>'; }).join('');
  var hist = p.historial.slice().reverse().map(function (h) { return '<li><time>' + ftime(h.t) + '</time><span><b>' + esc(who(h.por, h.nombre)) + '</b> · ' + esc(h.txt) + '</span></li>'; }).join('');
  var cl = p.clienteId && S.clientes.find(function (x) { return x.id === p.clienteId; });
  var clBox = cl ? '<div class="box cli-det">' +
    (cl.nombre && cl.nombre !== p.cliente ? '<div><small>Nombre</small>' + esc(cl.nombre) + '</div>' : '') +
    (cl.tel ? '<div><small>Teléfono</small><a href="' + esc(telHref(cl.tel)) + '">' + esc(cl.tel) + '</a></div>' : '') +
    (cl.doc ? '<div><small>Cédula / RUC</small>' + esc(cl.doc) + '</div>' : '') +
    (cl.dir ? '<div><small>Dirección</small>' + esc(cl.dir) + ' · <a href="' + esc(mapHref(cl.dir)) + '" target="_blank" rel="noopener">Ver en el mapa</a></div>' : '') +
    '</div>' : '';
  return '<div><h3 class="big">' + esc(p.cliente) + '</h3><p class="muted" style="margin:4px 0 0">' + fdia(p.fecha) + '</p></div>' + (clBox.indexOf('<div><small>') >= 0 ? clBox : '') +
    '<div class="seg-w">' + est + '</div>' +
    '<div class="box"><ul class="items">' + items + '</ul><div class="totrow"><span>Total</span><span>' + money(p.total) + '</span></div></div>' +
    (p.nota ? '<div class="box"><b>Nota</b><div style="white-space:pre-wrap;overflow-wrap:anywhere">' + esc(p.nota) + '</div></div>' : '') +
    (p.ticket ? '<div><h3 class="sec">Factura o ticket</h3><button class="ghost" style="padding:0;display:block" data-act="zoom" data-id="' + esc(p.ticket) + '" aria-label="Ver factura en grande"><img class="photo" alt="Factura o ticket del pedido" data-sp="' + esc(p.ticket) + '"></button></div>' : '') +
    '<div class="acts"><button class="btn primary" data-act="printped" data-id="' + esc(p.id) + '">Imprimir</button><button class="btn" data-act="pdfped" data-id="' + esc(p.id) + '">Descargar PDF</button>' +
    '<button class="btn" data-act="editped" data-id="' + esc(p.id) + '">Editar</button>' + (esGestor() ? '<button class="btn danger' + (rec.confirm ? ' arm' : '') + '" data-act="delped" data-id="' + esc(p.id) + '">' + (rec.confirm ? 'Tocá otra vez para eliminar' : 'Eliminar') + '</button>' : '') + '</div>' +
    '<div><h3 class="sec">Historial de cambios</h3><ul class="hist">' + hist + '</ul></div>';
}
function openDetail(id) {
  var rec = openSheet('Pedido', function () {});
  rec.refresh = function () {
    var p = S.peds.find(function (x) { return x.id === id; });
    if (!p) { rec.body.innerHTML = '<div class="empty">Este pedido ya no existe.</div>'; return; }
    rec.setTitle('Pedido Nº ' + pad(p.numero)); rec.body.innerHTML = detailHTML(p, rec);
  };
  rec.refresh();
}

function diff(p, n) {
  var c = [];
  if (p.cliente !== n.cliente) c.push('Cliente: ' + p.cliente + ' → ' + n.cliente);
  if (p.fecha !== n.fecha) c.push('Cambió la fecha');
  var key = function (i) { return i.pid || ('n:' + i.nombre); };
  var a = {}, b = {}; (p.items || []).forEach(function (i) { a[key(i)] = i; }); n.items.forEach(function (i) { b[key(i)] = i; });
  Object.keys(b).forEach(function (k) {
    var i = b[k], o = a[k];
    if (!o) c.push('Agregó ' + i.nombre + ' ×' + i.cant);
    else { if (o.cant !== i.cant) c.push(i.nombre + ': cantidad ' + o.cant + ' → ' + i.cant); if (o.precio !== i.precio) c.push(i.nombre + ': precio ' + money(o.precio) + ' → ' + money(i.precio)); }
  });
  Object.keys(a).forEach(function (k) { if (!b[k]) c.push('Quitó ' + a[k].nombre); });
  if ((p.nota || '') !== (n.nota || '')) c.push('Cambió la nota');
  if ((p.ticket || null) !== (n.ticket || null)) c.push('Cambió la factura o ticket');
  return c;
}

/* ---------- botones de foto (cámara y galería) ---------- */
function fotoBtns(tiene) {
  return '<div class="fotos"><button class="btn" type="button" data-foto="cam">Sacar foto</button><button class="btn" type="button" data-foto="gal">Elegir de la galería</button>' + (tiene ? '<button class="btn" type="button" data-foto="quit">Quitar</button>' : '') +
    '<input class="hid" type="file" accept="image/*" capture="environment" data-in="cam" tabindex="-1"><input class="hid" type="file" accept="image/*" data-in="gal" tabindex="-1"></div>';
}
function bindFoto(root, onFile, onQuit) {
  ['cam', 'gal'].forEach(function (k) {
    var inp = root.querySelector('[data-in="' + k + '"]'), b = root.querySelector('[data-foto="' + k + '"]');
    if (!inp || !b) return;
    b.addEventListener('click', function () { inp.click(); });
    inp.addEventListener('change', function () { var fl = inp.files && inp.files[0]; inp.value = ''; if (fl) onFile(fl); });
  });
  var q = root.querySelector('[data-foto="quit"]'); if (q) q.addEventListener('click', onQuit);
}

/* ---------- formulario de pedido ---------- */
function openPedidoForm(p) {
  var f = { items: p ? p.items.map(function (i) { return { pid: i.pid, nombre: i.nombre, precio: i.precio, cant: i.cant }; }) : [], ticket: p ? p.ticket : null, blob: null, preview: null };
  openSheet(p ? 'Editar pedido Nº ' + pad(p.numero) : 'Nuevo pedido', function (rec) {
    var etq = cliEtiquetas();
    var cid = p ? p.clienteId : null;
    if (cid && !S.clientes.some(function (c) { return c.id === cid; })) cid = null;
    var cini = cid ? (etq.find(function (e) { return e.c.id === cid; }) || {}).v : '';
    if (!cini && p) { var m0 = etq.find(function (e) { return cliNom(e.c).toLowerCase() === (p.cliente || '').toLowerCase(); }); if (m0) { cid = m0.c.id; cini = m0.v; } }
    var prods = S.prods.slice().sort(function (a, b) { return (a.nombre || '').localeCompare(b.nombre || '', 'es'); });
    rec.body.innerHTML =
      '<label class="field">Cliente<input type="text" id="f-cliente" list="dl-cli" autocomplete="off" placeholder="Escribí el nombre o el local…" value="' + esc(cini || (p ? p.cliente : '')) + '"></label>' + dlist('dl-cli', etq.map(function (e) { return e.v; })) +
      '<div class="cli-pick"><span class="muted" id="f-cinfo"></span><button class="btn" id="f-newcli" type="button">+ Nuevo cliente</button></div>' +
      '<label class="field">Fecha<input type="date" id="f-fecha" value="' + esc(p ? p.fecha : hoy()) + '"></label>' +
      '<h3 class="sec">Mercadería</h3><div class="box" id="f-items"></div>' +
      '<datalist id="dl-prod">' + prods.map(function (x) { return '<option value="' + esc(x.nombre) + '" label="' + esc(money(x.precio) + (x.stock != null ? ' · stock ' + x.stock : '')) + '"></option>'; }).join('') + '</datalist>' +
      '<div class="addrow"><input type="text" id="f-ln" list="dl-prod" autocomplete="off" placeholder="Escribí el producto…" aria-label="Producto"><input type="number" id="f-lp" inputmode="numeric" min="0" step="1" placeholder="Precio (Gs.)" aria-label="Precio en guaraníes"><button class="btn primary" id="f-addl" type="button">Agregar</button></div>' +
      '<p class="muted" style="margin:0;font-size:13px">Elegí una sugerencia para traer su precio, o escribí otro producto con su precio.</p>' +
      '<div class="totrow"><span>Total</span><span id="f-total"></span></div>' +
      '<label class="field">Nota para el pedido<textarea id="f-nota">' + esc(p ? p.nota : '') + '</textarea></label>' +
      '<h3 class="sec">Factura o ticket</h3><div id="f-tk"></div>' +
      '<div class="err" id="f-err" role="alert"></div>' +
      '<button class="btn primary" id="f-save" type="button">' + (p ? 'Guardar cambios' : 'Guardar pedido') + '</button>';
    var $f = function (s) { return rec.body.querySelector(s); };
    function paintCli() {
      var e = etq.find(function (x) { return x.c.id === cid; }), info = $f('#f-cinfo');
      info.textContent = e ? (cliLinea(e.c) || 'Cliente elegido') : (($f('#f-cliente').value.trim()) ? 'Elegí un cliente de la lista o creá uno nuevo.' : '');
    }
    function pickCli() {
      var v = $f('#f-cliente').value.trim().toLowerCase();
      var e = v && etq.find(function (x) { return x.v.toLowerCase() === v; });
      if (!e && v) { var c2 = etq.filter(function (x) { return cliNom(x.c).toLowerCase() === v; }); if (c2.length === 1) e = c2[0]; }
      cid = e ? e.c.id : null; paintCli();
    }
    $f('#f-cliente').addEventListener('input', pickCli);
    $f('#f-newcli').addEventListener('click', function () {
      openClienteForm(null, function (nc) { etq = cliEtiquetas(); $f('#dl-cli').innerHTML = etq.map(function (x) { return '<option value="' + esc(x.v) + '">'; }).join(''); var e = etq.find(function (x) { return x.c.id === nc.id; }); cid = nc.id; $f('#f-cliente').value = e ? e.v : cliNom(nc); paintCli(); }, $f('#f-cliente').value.trim());
    });
    function total() { return f.items.reduce(function (s, i) { return s + (Number(i.precio) || 0) * (Number(i.cant) || 0); }, 0); }
    function paintTotal() { $f('#f-total').textContent = money(total()); }
    function paintItems() {
      var box = $f('#f-items');
      if (!f.items.length) { box.innerHTML = '<span class="muted">Todavía no hay productos en este pedido.</span>'; paintTotal(); return; }
      box.innerHTML = f.items.map(function (i, k) {
        return '<div class="irow"><span class="nm">' + esc(i.nombre) + '</span><button class="rm" type="button" data-k="' + k + '" data-op="rm" aria-label="Quitar ' + esc(i.nombre) + '">✕</button>' +
          '<div class="ctl"><input type="number" inputmode="numeric" min="0" step="1" data-k="' + k + '" data-op="pr" value="' + esc(i.precio) + '" aria-label="Precio de ' + esc(i.nombre) + '">' +
          '<div class="step"><button type="button" data-k="' + k + '" data-op="dec" aria-label="Menos">−</button><input type="number" class="qin" id="q' + k + '" inputmode="numeric" min="1" step="1" data-k="' + k + '" data-op="qt" value="' + i.cant + '" aria-label="Cantidad de ' + esc(i.nombre) + '"><button type="button" data-k="' + k + '" data-op="inc" aria-label="Más">+</button></div>' +
          '<span class="st" id="s' + k + '">' + money(i.precio * i.cant) + '</span></div></div>';
      }).join('');
      paintTotal();
    }
    function upd(k) { var i = f.items[k]; var q = $f('#q' + k), s = $f('#s' + k); if (q && document.activeElement !== q) q.value = i.cant; if (s) s.textContent = money((Number(i.precio) || 0) * i.cant); paintTotal(); }
    $f('#f-items').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-op]'); if (!b) return; var k = Number(b.dataset.k), op = b.dataset.op, i = f.items[k];
      if (op === 'rm') { f.items.splice(k, 1); paintItems(); }
      else if (op === 'inc') { i.cant += 1; upd(k); }
      else if (op === 'dec') { i.cant = Math.max(1, i.cant - 1); upd(k); }
    });
    $f('#f-items').addEventListener('input', function (e) { var t = e.target; if (t.dataset && t.dataset.op === 'qt') { var kq = Number(t.dataset.k), nq = Math.floor(Number(t.value)); if (nq >= 1) { f.items[kq].cant = Math.min(nq, 999999); upd(kq); } return; } if (t.dataset && t.dataset.op === 'pr') { var k = Number(t.dataset.k); f.items[k].precio = Math.round(Number(t.value) || 0); upd(k); } });
    $f('#f-items').addEventListener('focusin', function (e) { if (e.target.dataset && e.target.dataset.op === 'qt') e.target.select(); });
    $f('#f-items').addEventListener('focusout', function (e) { var t = e.target; if (t.dataset && t.dataset.op === 'qt') t.value = f.items[Number(t.dataset.k)].cant; });
    function addItem(it) {
      var ex = f.items.find(function (x) { return it.pid ? x.pid === it.pid : (!x.pid && x.nombre === it.nombre); });
      if (ex) ex.cant += 1; else f.items.push(it); paintItems();
    }
    var ln = $f('#f-ln'), lp = $f('#f-lp');
    function igual() { var v = ln.value.trim().toLowerCase(); return prods.find(function (x) { return (x.nombre || '').trim().toLowerCase() === v; }); }
    ln.addEventListener('input', function () { var m = igual(); if (m) { lp.value = m.precio; lp.dataset.auto = '1'; } else if (lp.dataset.auto === '1') { lp.value = ''; lp.dataset.auto = ''; } });
    lp.addEventListener('input', function () { lp.dataset.auto = ''; });
    function agregar() {
      var n = ln.value.trim(); if (!n) { ln.focus(); return; }
      var m = igual(); var precio = lp.value !== '' ? Math.round(Number(lp.value) || 0) : (m ? Math.round(Number(m.precio) || 0) : 0);
      addItem({ pid: m ? m.id : null, nombre: m ? m.nombre : n, precio: precio, cant: 1 });
      ln.value = ''; lp.value = ''; lp.dataset.auto = ''; ln.focus();
    }
    $f('#f-addl').addEventListener('click', agregar);
    [ln, lp].forEach(function (el) { el.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); agregar(); } }); });
    function paintTk() {
      var box = $f('#f-tk');
      box.innerHTML = imgHtml(f.preview, f.preview ? null : f.ticket, 'Factura o ticket') + fotoBtns(!!(f.preview || f.ticket)) + '<div class="err" data-fe role="alert"></div>';
      bindFoto(box, async function (file) {
        try { f.blob = await reducir(file, 1600, 0.85); if (f.preview) URL.revokeObjectURL(f.preview); f.preview = URL.createObjectURL(f.blob); paintTk(); }
        catch (e) { box.querySelector('[data-fe]').textContent = 'No se pudo leer esa imagen. Probá con otra foto.'; }
      }, function () { if (f.preview) URL.revokeObjectURL(f.preview); f.blob = null; f.preview = null; f.ticket = null; paintTk(); });
    }
    rec.onClose = function () { if (f.preview) URL.revokeObjectURL(f.preview); };
    paintItems(); paintTk(); paintCli();
    $f('#f-save').addEventListener('click', async function () {
      var btn = $f('#f-save'), err = $f('#f-err'); err.textContent = '';
      pickCli();
      var cEl = etq.find(function (x) { return x.c.id === cid; });
      if (!cEl) { err.textContent = $f('#f-cliente').value.trim() ? 'Elegí un cliente de la lista o tocá «+ Nuevo cliente».' : 'Elegí el cliente del pedido.'; $f('#f-cliente').focus(); return; }
      var cliente = cliNom(cEl.c);
      if (!f.items.length) { err.textContent = 'Agregá al menos un producto.'; return; }
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        var ticket = f.ticket || null;
        if (f.blob) ticket = await subirFoto('facturas', f.blob);
        var items = f.items.map(function (i) { return { pid: i.pid || null, nombre: i.nombre, precio: Math.round(Number(i.precio) || 0), cant: Number(i.cant) || 1 }; });
        var tot = items.reduce(function (s, i) { return s + i.precio * i.cant; }, 0);
        var data = { cliente: cliente, fecha: $f('#f-fecha').value || hoy(), nota: $f('#f-nota').value.trim(), items: items, total: tot, ticket: ticket };
        var resumen;
        if (!p) resumen = items.length + ' producto' + (items.length === 1 ? '' : 's') + ' · ' + money(tot);
        else {
          var cambios = diff(p, data);
          if (!cambios.length) { toast('No hay cambios para guardar.'); closeSheet(); return; }
          resumen = cambios.join(' · ');
        }
        var r = await sb.rpc('guardar_pedido', {
          p_id: p ? p.id : null, p_cliente: cliente, p_fecha: data.fecha, p_nota: data.nota, p_ticket: ticket,
          p_items: items.map(function (i) { return { producto_id: i.pid, nombre: i.nombre, precio: i.precio, cantidad: i.cant }; }),
          p_resumen: resumen, p_por_nombre: me.nombre, p_cliente_id: cid
        });
        if (r.error) throw r.error;
        var fl = (r.data && r.data.faltas) || [];
        toast((p ? 'Cambios guardados.' : 'Pedido guardado.') + ' Se avisó al otro teléfono.' + faltasTxt(fl), fl.length ? 7000 : 0);
        closeSheet(); recargar();
      } catch (e) {
        btn.disabled = false; btn.textContent = p ? 'Guardar cambios' : 'Guardar pedido';
        err.textContent = errMsg(e, 'No se pudo guardar. Revisá la conexión y probá de nuevo.');
      }
    });
  }, 'Cancelar');
}

/* ---------- panel de administración (solo administrador) ---------- */
async function api(accion, datos) {
  var r = await sb.functions.invoke('admin', { body: Object.assign({ accion: accion }, datos || {}) });
  if (r.error) {
    var msg = 'No se pudo completar. Revisá la conexión y probá de nuevo.';
    try { var j = await r.error.context.json(); if (j && j.error) msg = j.error; } catch (e) {}
    throw new Error(msg);
  }
  if (r.data && r.data.error) throw new Error(r.data.error);
  return r.data;
}
function rolOpts(sel) { return Object.keys(ROLES).map(function (k) { return '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + ROLES[k] + '</option>'; }).join(''); }
function openAdmin() {
  var rec = openSheet('Administrar cuentas', function () {}, 'Ajustes');
  rec.load = async function () {
    rec.body.innerHTML = '<p class="muted">Cargando…</p>';
    var d;
    try { d = await api('listar'); }
    catch (e) { rec.body.innerHTML = '<div class="empty"><span>' + esc(e.message) + '</span><button class="btn" id="ad-retry">Reintentar</button></div>'; rec.body.querySelector('#ad-retry').addEventListener('click', rec.load); return; }
    var l = d.personas || [];
    rec.body.innerHTML = '<button class="btn primary" id="ad-add">+ Agregar persona</button>' +
      '<div class="list">' + l.map(function (m, i) {
        var est = !m.activo ? '<span class="chip2 bad">Bloqueada</span>' : (!m.cuenta ? '<span class="chip2">Sin cuenta todavía</span>' : '<span class="chip2 ok">Activa</span>');
        return '<button class="cli" data-i="' + i + '"><span class="ph cini">' + esc((m.nombre || m.email).trim().charAt(0).toUpperCase()) + '</span>' +
          '<span class="cli-b"><strong>' + esc(m.nombre || m.email) + (m.yo ? ' (vos)' : '') + '</strong><small>' + esc(m.email) + '</small>' +
          '<span class="chips2"><span class="chip2' + (m.rol === 'admin' ? ' adm' : '') + '">' + esc(ROLES[m.rol] || m.rol) + '</span>' + est + '</span>' +
          (m.ultimo_ingreso ? '<small>Último ingreso: ' + ftime(Date.parse(m.ultimo_ingreso)) + '</small>' : '') + '</span></button>';
      }).join('') + '</div>' +
      '<div class="box"><b>Qué puede hacer cada rol</b><ul class="roles">' + Object.keys(ROLES).map(function (k) { return '<li><b>' + ROLES[k] + ':</b> ' + esc(ROLDESC[k]) + '</li>'; }).join('') + '</ul></div>';
    rec.body.querySelector('#ad-add').addEventListener('click', function () { openAgregar(rec.load); });
    rec.body.querySelectorAll('.cli[data-i]').forEach(function (b) { b.addEventListener('click', function () { openPersona(l[Number(b.dataset.i)], rec.load); }); });
  };
  rec.load();
}
function openAgregar(onDone) {
  openSheet('Agregar persona', function (rec) {
    rec.body.innerHTML =
      '<label class="field">Email<input type="email" id="n-mail" inputmode="email" autocomplete="off" placeholder="persona@gmail.com"></label>' +
      '<label class="field">Nombre<input type="text" id="n-nom" autocomplete="off" placeholder="Ej.: Papá"></label>' +
      '<label class="field">Rol<select id="n-rol">' + rolOpts('vendedor') + '</select></label>' +
      '<p class="muted" id="n-rd" style="margin:-6px 0 0;font-size:13px"></p>' +
      '<label class="field">Contraseña inicial (opcional, mínimo 8 caracteres)<input type="text" id="n-pass" autocomplete="off" placeholder="Si la dejás vacía, la persona crea su cuenta"></label>' +
      '<p class="muted" style="margin:-6px 0 0;font-size:13px">Con contraseña, la cuenta queda lista para entrar ya mismo y se la pasás a la persona. Sin contraseña, tiene que tocar «Primera vez: crear mi cuenta» con este mismo email.</p>' +
      '<div class="err" id="n-err" role="alert"></div><button class="btn primary" id="n-go" type="button">Agregar</button>';
    var $n = function (s) { return rec.body.querySelector(s); };
    function rd() { $n('#n-rd').textContent = ROLDESC[$n('#n-rol').value]; }
    $n('#n-rol').addEventListener('change', rd); rd();
    $n('#n-go').addEventListener('click', async function () {
      var btn = $n('#n-go'), err = $n('#n-err'); err.textContent = ''; btn.disabled = true; btn.textContent = 'Agregando…';
      try {
        await api('crear', { email: $n('#n-mail').value.trim(), nombre: $n('#n-nom').value.trim(), rol: $n('#n-rol').value, password: $n('#n-pass').value });
        toast('Persona agregada.'); closeSheet(); onDone();
      } catch (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = 'Agregar'; }
    });
  }, 'Cancelar');
}
function openPersona(m, onDone) {
  openSheet(m.nombre || m.email, function (rec) {
    var conf = { b: false, d: false };
    rec.body.innerHTML =
      '<p class="muted" style="margin:0">' + esc(m.email) + (m.yo ? ' · es tu cuenta' : '') + '</p>' +
      '<label class="field">Nombre<input type="text" id="p-nom" autocomplete="off" value="' + esc(m.nombre || '') + '"></label>' +
      '<label class="field">Rol<select id="p-rol"' + (m.yo ? ' disabled' : '') + '>' + rolOpts(m.rol) + '</select></label>' +
      '<p class="muted" id="p-rd" style="margin:-6px 0 0;font-size:13px"></p>' +
      '<div class="err" id="p-err" role="alert"></div>' +
      '<button class="btn primary" id="p-save" type="button">Guardar nombre y rol</button>' +
      '<div class="ajuste-sec" style="margin-top:10px"><h3 class="sec">Contraseña</h3>' +
      '<label class="field">' + (m.cuenta ? 'Nueva contraseña (mínimo 8 caracteres)' : 'Esta persona todavía no tiene cuenta. Poné una contraseña para crearla ahora (mínimo 8)') + '<input type="text" id="p-pass" autocomplete="off"></label>' +
      '<button class="btn" id="p-pw" type="button">' + (m.cuenta ? 'Cambiar contraseña' : 'Crear cuenta con esta contraseña') + '</button>' +
      '<p class="muted" style="margin:0;font-size:12px">Si la cambiás, se la tenés que pasar vos a la persona. Todavía puede seguir con la sesión abierta hasta que se venza.</p></div>' +
      (m.yo ? '' : '<div class="ajuste-sec" style="margin-top:10px"><h3 class="sec">Acceso</h3>' +
        '<button class="btn ' + (m.activo ? 'danger' : 'primary') + '" id="p-blk" type="button">' + (m.activo ? 'Bloquear cuenta' : 'Desbloquear cuenta') + '</button>' +
        '<p class="muted" style="margin:0;font-size:12px">' + (m.activo ? 'Al bloquearla deja de ver los datos y no puede volver a entrar ni recibe avisos.' : 'La cuenta está bloqueada. Al desbloquearla puede volver a entrar.') + '</p>' +
        '<button class="btn danger" id="p-del" type="button">Eliminar persona y su cuenta</button></div>');
    var $p = function (s) { return rec.body.querySelector(s); };
    function rd() { $p('#p-rd').textContent = ROLDESC[$p('#p-rol').value]; }
    $p('#p-rol').addEventListener('change', rd); rd();
    async function run(btn, fn, ok, back) {
      var err = $p('#p-err'); err.textContent = ''; btn.disabled = true;
      try { await fn(); toast(ok); if (back) { closeSheet(); } onDone(); } catch (e) { err.textContent = e.message; }
      btn.disabled = false;
    }
    $p('#p-save').addEventListener('click', function () { run(this, function () { return api('editar', { email: m.email, nombre: $p('#p-nom').value.trim(), rol: $p('#p-rol').value }); }, 'Guardado.', true); });
    $p('#p-pw').addEventListener('click', function () {
      var pw = $p('#p-pass').value, self = this;
      if (pw.length < 8) { $p('#p-err').textContent = 'La contraseña tiene que tener al menos 8 caracteres.'; return; }
      run(self, function () { return api('password', { email: m.email, password: pw }); }, m.cuenta ? 'Contraseña cambiada. Pasásela a la persona.' : 'Cuenta creada. Pasale la contraseña a la persona.', true);
    });
    var blk = $p('#p-blk');
    if (blk) blk.addEventListener('click', function () {
      var self = this;
      if (m.activo && !conf.b) { conf.b = true; self.textContent = 'Tocá otra vez para bloquear'; self.classList.add('arm'); setTimeout(function () { if (self.isConnected) { conf.b = false; self.textContent = 'Bloquear cuenta'; self.classList.remove('arm'); } }, 4000); return; }
      run(self, function () { return api('bloquear', { email: m.email, bloqueado: m.activo }); }, m.activo ? 'Cuenta bloqueada.' : 'Cuenta desbloqueada.', true);
    });
    var del = $p('#p-del');
    if (del) del.addEventListener('click', function () {
      var self = this;
      if (!conf.d) { conf.d = true; self.textContent = 'Tocá otra vez para eliminar'; self.classList.add('arm'); setTimeout(function () { if (self.isConnected) { conf.d = false; self.textContent = 'Eliminar persona y su cuenta'; self.classList.remove('arm'); } }, 4000); return; }
      run(self, function () { return api('eliminar', { email: m.email }); }, 'Persona eliminada.', true);
    });
  }, 'Volver');
}

/* ---------- formulario de cliente ---------- */
function openClienteForm(c, onSaved, nombreIni) {
  var f = { confirm: false };
  openSheet(c ? 'Editar cliente' : 'Nuevo cliente', function (rec) {
    rec.body.innerHTML =
      '<label class="field">Nombre y apellido<input type="text" id="c-nom" autocomplete="off" placeholder="Ej.: María González" value="' + esc(c ? c.nombre : (nombreIni || '')) + '"></label>' +
      '<label class="field">Nombre de fantasía (nombre del local)<input type="text" id="c-fan" autocomplete="off" placeholder="Ej.: Despensa Los Pinos" value="' + esc(c ? c.fantasia : '') + '"></label>' +
      '<label class="field">Teléfono<input type="tel" id="c-tel" inputmode="tel" autocomplete="off" placeholder="Ej.: 0981 123 456" value="' + esc(c ? c.tel : '') + '"></label>' +
      '<label class="field">Cédula o RUC<input type="text" id="c-doc" autocomplete="off" placeholder="Ej.: 1234567 o 80012345-6" value="' + esc(c ? c.doc : '') + '"></label>' +
      '<label class="field">Dirección<textarea id="c-dir" rows="2" placeholder="Calle, número, barrio, ciudad">' + esc(c ? c.dir : '') + '</textarea></label>' +
      (c && (c.tel || c.dir) ? '<div class="acts">' + (c.tel ? '<a class="btn" href="' + esc(telHref(c.tel)) + '">Llamar</a>' : '') + (c.dir ? '<a class="btn" href="' + esc(mapHref(c.dir)) + '" target="_blank" rel="noopener">Ver en el mapa</a>' : '') + '</div>' : '') +
      '<div class="err" id="c-err" role="alert"></div>' +
      '<button class="btn primary" id="c-save" type="button">Guardar cliente</button>' +
      (c ? '<button class="btn danger" id="c-del" type="button">Eliminar cliente</button>' : '');
    var $c = function (s) { return rec.body.querySelector(s); };
    $c('#c-save').addEventListener('click', async function () {
      var btn = $c('#c-save'), err = $c('#c-err'); err.textContent = '';
      var row = { nombre: $c('#c-nom').value.trim(), nombre_fantasia: $c('#c-fan').value.trim() || null, telefono: $c('#c-tel').value.trim() || null, documento: $c('#c-doc').value.trim() || null, direccion: $c('#c-dir').value.trim() || null };
      if (!row.nombre) { err.textContent = 'Escribí el nombre del cliente.'; $c('#c-nom').focus(); return; }
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        var r = c ? await sb.from('clientes').update(row).eq('id', c.id).select().single() : await sb.from('clientes').insert(row).select().single();
        if (r.error) throw r.error;
        var d = r.data, nc = { id: d.id, nombre: d.nombre || '', fantasia: d.nombre_fantasia || '', tel: d.telefono || '', doc: d.documento || '', dir: d.direccion || '' };
        var k = S.clientes.findIndex(function (x) { return x.id === nc.id; });
        if (k >= 0) S.clientes[k] = nc; else S.clientes.push(nc);
        toast('Cliente guardado.'); closeSheet();
        if (onSaved) onSaved(nc);
        drawAll(); recargar();
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Guardar cliente';
        err.textContent = /duplicate|unique|23505/i.test((e && (e.message + (e.code || ''))) || '') ? 'Ya hay un cliente con esa cédula o RUC.' : 'No se pudo guardar. Revisá la conexión y probá de nuevo.';
      }
    });
    var d = $c('#c-del');
    if (d) d.addEventListener('click', async function () {
      if (!f.confirm) { f.confirm = true; d.textContent = 'Tocá otra vez para eliminar'; d.classList.add('arm'); setTimeout(function () { if (d.isConnected) { f.confirm = false; d.textContent = 'Eliminar cliente'; d.classList.remove('arm'); } }, 4000); return; }
      var r = await sb.from('clientes').delete().eq('id', c.id);
      if (r.error) { $c('#c-err').textContent = 'No se pudo eliminar.'; return; }
      toast('Cliente eliminado. Sus pedidos anteriores conservan el nombre.'); closeSheet(); recargar();
    });
  }, 'Cancelar');
}

/* ---------- formulario de producto ---------- */
function openProdForm(p) {
  var f = { blob: null, preview: null, imagen: p ? p.imagen : null, confirm: false };
  openSheet(p ? 'Editar producto' : 'Nuevo producto', function (rec) {
    rec.body.innerHTML =
      '<div id="g-img"></div>' +
      '<label class="field">Nombre<input type="text" id="g-nom" autocomplete="off" value="' + esc(p ? p.nombre : '') + '"></label>' +
      '<label class="field">Categoría<input type="text" id="g-cat" list="dl-cat" autocomplete="off" placeholder="Ej.: Bebidas" value="' + esc(p ? p.categoria : '') + '"></label>' + dlist('dl-cat', cats()) +
      '<label class="field">Proveedor (opcional)<input type="text" id="g-prv" list="dl-prv" autocomplete="off" placeholder="Ej.: Arcor" value="' + esc(p ? p.proveedor : '') + '"></label>' + dlist('dl-prv', provs()) +
      '<label class="field">Precio de venta (Gs.)<input type="number" id="g-pre" inputmode="numeric" min="0" step="1" placeholder="Ej.: 15000" value="' + esc(p ? p.precio : '') + '"></label>' +
      (esGestor() ? '<label class="field">Precio de costo (Gs.) · lo que te cuesta comprarlo<input type="number" id="g-cos" inputmode="numeric" min="0" step="1" placeholder="Ej.: 11000" value="' + esc(p && p.costo != null ? p.costo : '') + '"></label>' +
      '<p class="muted" id="g-gan" style="margin:-6px 0 0;font-size:13px"></p>' +
      '<p class="muted" style="margin:0;font-size:12px">El costo lo ven solo el administrador y el encargado. No sale en el catálogo, ni en facturas, ni en tickets.</p>' : '') +
      '<label class="field">Cantidad en stock (vacío si no lo controlás)<input type="number" id="g-stk" inputmode="numeric" min="0" step="1" placeholder="Ej.: 24" value="' + esc(p && p.stock != null ? p.stock : '') + '"></label>' +
      '<div class="err" id="g-err" role="alert"></div>' +
      '<button class="btn primary" id="g-save" type="button">Guardar producto</button>' +
      (p ? '<button class="btn danger" id="g-del" type="button">Eliminar producto</button>' : '');
    var $g = function (s) { return rec.body.querySelector(s); };
    function paint() {
      var box = $g('#g-img');
      box.innerHTML = imgHtml(f.preview, f.preview ? null : f.imagen, 'Foto del producto') + fotoBtns(!!(f.preview || f.imagen)) + '<div class="err" data-fe role="alert"></div>';
      bindFoto(box, async function (file) {
        try { f.blob = await reducir(file, 900, 0.82); if (f.preview) URL.revokeObjectURL(f.preview); f.preview = URL.createObjectURL(f.blob); paint(); }
        catch (e) { box.querySelector('[data-fe]').textContent = 'No se pudo leer esa imagen. Probá con otra foto.'; }
      }, function () { if (f.preview) URL.revokeObjectURL(f.preview); f.blob = null; f.preview = null; f.imagen = null; paint(); });
    }
    rec.onClose = function () { if (f.preview) URL.revokeObjectURL(f.preview); };
    paint();
    function ganancia() {
      var pv = $g('#g-pre').value, co = $g('#g-cos').value, t = $g('#g-gan');
      if (pv === '' || co === '') { t.textContent = ''; return; }
      var g = Math.round(Number(pv)) - Math.round(Number(co)), pc = Number(co) > 0 ? Math.round(g / Number(co) * 100) : null;
      t.textContent = 'Ganancia por unidad: ' + money(g) + (pc !== null ? ' (' + pc + ' % sobre el costo)' : '');
    }
    if ($g('#g-cos')) { $g('#g-pre').addEventListener('input', ganancia); $g('#g-cos').addEventListener('input', ganancia); ganancia(); }
    $g('#g-save').addEventListener('click', async function () {
      var btn = $g('#g-save'), err = $g('#g-err'); err.textContent = '';
      var nombre = $g('#g-nom').value.trim();
      if (!nombre) { err.textContent = 'Escribí el nombre del producto.'; $g('#g-nom').focus(); return; }
      if ($g('#g-pre').value === '') { err.textContent = 'Cargá el precio de venta.'; $g('#g-pre').focus(); return; }
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        var path = f.imagen || null;
        if (f.blob) path = await subirFoto('productos', f.blob);
        var stk = $g('#g-stk').value, cos = $g('#g-cos') ? $g('#g-cos').value : null;
        var row = { nombre: nombre, categoria: $g('#g-cat').value.trim() || 'Sin categoría', proveedor: $g('#g-prv').value.trim() || null, precio: Math.round(Number($g('#g-pre').value) || 0), stock: stk === '' ? null : Math.max(0, Math.round(Number(stk) || 0)), imagen_path: path };
        var r = p ? await sb.from('productos').update(row).eq('id', p.id) : await sb.from('productos').insert(row).select('id').single();
        if (r.error) throw r.error;
        var pidNuevo = p ? p.id : (r.data && r.data.id);
        if (cos !== null && pidNuevo) {
          var rc = cos === '' ? await sb.from('producto_costos').delete().eq('producto_id', pidNuevo)
            : await sb.from('producto_costos').upsert({ producto_id: pidNuevo, costo: Math.max(0, Math.round(Number(cos) || 0)) });
          if (rc.error) throw rc.error;
        }
        toast('Producto guardado.'); closeSheet(); recargar();
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Guardar producto';
        err.textContent = errMsg(e, 'No se pudo guardar. Revisá la conexión y probá de nuevo.');
      }
    });
    var d = $g('#g-del');
    if (d) d.addEventListener('click', async function () {
      if (!f.confirm) { f.confirm = true; d.textContent = 'Tocá otra vez para eliminar'; d.classList.add('arm'); setTimeout(function () { if (d.isConnected) { f.confirm = false; d.textContent = 'Eliminar producto'; d.classList.remove('arm'); } }, 4000); return; }
      var r = await sb.from('productos').delete().eq('id', p.id);
      if (r.error) { $g('#g-err').textContent = 'No se pudo eliminar.'; return; }
      if (p.imagen) { try { await sb.storage.from('fotos').remove([p.imagen]); } catch (e) {} }
      toast('Producto eliminado. Los pedidos anteriores conservan sus datos.'); closeSheet(); recargar();
    });
  }, 'Cancelar');
}

/* ---------- avisos ---------- */
function openAvisos() {
  var rec = openSheet('Avisos', function () {});
  var corte = seen();
  rec.refresh = function () {
    var l = S.avisos.slice().sort(function (a, b) { return b.t - a.t; });
    rec.body.innerHTML = l.length ? l.map(function (a) {
      var nuevo = a.t > corte && a.por !== me.id;
      return '<button class="av ' + esc(a.tipo) + (nuevo ? ' new' : '') + '"' + (a.pedidoId ? ' data-act="avopen" data-id="' + esc(a.pedidoId) + '"' : '') + '><span class="dot" aria-hidden="true">' + (a.tipo === 'nuevo' ? '+' : '✎') + '</span><span class="tx"><span><b>' + esc(avisoTexto(a)) + '</b></span><span>' + esc(a.resumen) + '</span><small>' + ftime(a.t) + '</small></span></button>';
    }).join('') : '<div class="empty">Todavía no hay avisos. Cada pedido nuevo o modificado aparece acá.</div>';
  };
  rec.onClose = function () { ls('visto', String(Date.now())); drawTop(); };
  rec.refresh();
}

/* ---------- PDF ---------- */
async function coverData(path, w, h) {
  var u = await imgBlobUrl(path); if (!u) throw new Error('sin foto');
  var img = await loadImg(u), cw = Math.round(w * 7), ch = Math.round(h * 7);
  var c = document.createElement('canvas'); c.width = cw; c.height = ch; var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, cw, ch);
  var s = Math.max(cw / img.width, ch / img.height), dw = img.width * s, dh = img.height * s; x.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
  return c.toDataURL('image/jpeg', 0.82);
}
async function fitData(path, mw, mh) {
  var u = await imgBlobUrl(path); if (!u) throw new Error('sin foto');
  var img = await loadImg(u), s = Math.min(mw / img.width, mh / img.height);
  var c = document.createElement('canvas'); c.width = img.width; c.height = img.height; var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0);
  return { d: c.toDataURL('image/jpeg', 0.88), w: img.width * s, h: img.height * s };
}
function slug(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30); }
async function pdfCatalogo() {
  var J = window.jspdf && window.jspdf.jsPDF; if (!J) { toast('No se pudo cargar el generador de PDF. Revisá la conexión.'); return; }
  var prods = S.prods.filter(function (p) { return !S.catOff[p.categoria || 'Sin categoría']; });
  if (!prods.length) { toast('Elegí al menos una categoría con productos.'); return; }
  var btn = $('#gencat'); if (btn) { btn.disabled = true; btn.textContent = 'Generando catálogo…'; }
  try {
    var doc = new J({ unit: 'mm', format: 'a4' }), W = 210, H = 297, M = 14, GAP = 6, CW = (W - 2 * M - GAP) / 2, IH = 62, RH = IH + 24, BOT = H - 18;
    var nombre = S.cfg.nombre || 'Catálogo de productos', fecha = new Date().toLocaleDateString('es-PY', { day: 'numeric', month: 'long', year: 'numeric' });
    var g = {}; prods.forEach(function (p) { var c = p.categoria || 'Sin categoría'; (g[c] = g[c] || []).push(p); });
    var names = Object.keys(g).sort(function (a, b) { return a.localeCompare(b, 'es'); });
    function head(first) {
      if (first) { doc.setFont('helvetica', 'bold'); doc.setFontSize(26); doc.setTextColor(24, 35, 29); doc.text(doc.splitTextToSize(nombre, W - 2 * M), M, 28);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.setTextColor(90, 102, 93); doc.text('Catálogo de productos · ' + fecha, M, 40); return 52; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(24, 35, 29); doc.text(nombre, M, 12);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(90, 102, 93); doc.text(fecha, W - M, 12, { align: 'right' }); doc.setDrawColor(210); doc.line(M, 15, W - M, 15); return 22;
    }
    function bar(t, y) { doc.setFillColor(28, 107, 80); doc.roundedRect(M, y, W - 2 * M, 8, 1.5, 1.5, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(255, 255, 255); doc.text(t, M + 3, y + 5.6); }
    var y = head(true);
    for (var ci = 0; ci < names.length; ci++) {
      var cname = names[ci], list = g[cname].sort(function (a, b) { return (a.nombre || '').localeCompare(b.nombre || '', 'es'); });
      if (y + 10 + RH > BOT) { doc.addPage(); y = head(false); }
      bar(cname, y); y += 11;
      for (var r = 0; r < list.length; r += 2) {
        if (y + RH > BOT) { doc.addPage(); y = head(false); bar(cname + ' (continuación)', y); y += 11; }
        for (var col = 0; col < 2; col++) {
          var p = list[r + col]; if (!p) break;
          var x = M + col * (CW + GAP);
          doc.setDrawColor(210); doc.setLineWidth(0.25); doc.roundedRect(x, y, CW, RH - 4, 2, 2, 'S');
          var ok = false;
          if (p.imagen) { try { doc.addImage(await coverData(p.imagen, CW - 2, IH - 2), 'JPEG', x + 1, y + 1, CW - 2, IH - 2); ok = true; } catch (e) {} }
          if (!ok) { doc.setFillColor(233, 238, 233); doc.rect(x + 1, y + 1, CW - 2, IH - 2, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(30); doc.setTextColor(150, 165, 155); doc.text((p.nombre || '?').trim().charAt(0).toUpperCase(), x + CW / 2, y + IH / 2 + 5, { align: 'center' }); }
          doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(24, 35, 29);
          doc.text(doc.splitTextToSize(p.nombre || '', CW - 6).slice(0, 2), x + 3, y + IH + 5);
          if (S.catPrecios) { doc.setFontSize(12); doc.setTextColor(28, 107, 80); doc.text(money(p.precio), x + 3, y + RH - 8); }
        }
        y += RH;
      }
      y += 2;
    }
    var n = doc.getNumberOfPages();
    for (var i = 1; i <= n; i++) { doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(120); doc.text(i + ' / ' + n, W / 2, H - 8, { align: 'center' }); }
    doc.save('catalogo-' + (slug(S.cfg.nombre) || 'productos') + '.pdf');
  } catch (e) { toast('No se pudo generar el catálogo.'); }
  finally { var b = $('#gencat'); if (b) { b.disabled = false; b.textContent = 'Generar catálogo en PDF'; } }
}
async function pdfPedido(p, imprimir) {
  var J = window.jspdf && window.jspdf.jsPDF; if (!J) { toast('No se pudo cargar el generador de PDF. Revisá la conexión.'); return; }
  toast('Preparando PDF…');
  try {
    var doc = new J({ unit: 'mm', format: 'a4' }), W = 210, H = 297, M = 16, K = 1.25;
    var gris = function () { doc.setTextColor(90, 102, 93); }, negro = function () { doc.setTextColor(24, 35, 29); };
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18 * K); negro(); doc.text(doc.splitTextToSize(S.cfg.nombre || 'Pedido', 100), M, 24);
    doc.setFontSize(12 * K); doc.text('Pedido Nº ' + pad(p.numero), W - M, 24, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10 * K); gris();
    doc.text('Fecha: ' + fdia(p.fecha), W - M, 31, { align: 'right' }); doc.text('Estado: ' + (ESTADO[p.estado] || p.estado), W - M, 37, { align: 'right' });
    doc.setDrawColor(200); doc.line(M, 42, W - M, 42);
    doc.setFontSize(9 * K); doc.text('CLIENTE', M, 50); doc.setFont('helvetica', 'bold'); doc.setFontSize(14 * K); negro();
    var cn = doc.splitTextToSize(p.cliente || '', W - 2 * M); doc.text(cn, M, 58);
    var y = 58 + (cn.length - 1) * 7.5 + 9;
    var cl = p.clienteId && S.clientes.find(function (x) { return x.id === p.clienteId; });
    if (cl) {
      var dl = [cl.nombre && cl.nombre !== p.cliente ? cl.nombre : '', cl.tel ? 'Tel.: ' + cl.tel : '', cl.doc ? 'C.I. / RUC: ' + cl.doc : ''].filter(Boolean);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10 * K); gris();
      dl.forEach(function (t) { var ls2 = doc.splitTextToSize(t, W - 2 * M); doc.text(ls2, M, y); y += ls2.length * 5.8; });
      if (dl.length) y += 4;
    }
    y += 6;
    function th() { doc.setFont('helvetica', 'bold'); doc.setFontSize(9 * K); gris(); doc.text('PRODUCTO', M, y); doc.text('CANT.', 118, y, { align: 'right' }); doc.text('PRECIO', 152, y, { align: 'right' }); doc.text('SUBTOTAL', W - M, y, { align: 'right' }); doc.line(M, y + 2.5, W - M, y + 2.5); y += 11; }
    th();
    p.items.forEach(function (i) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10 * K);
      var ln = doc.splitTextToSize(i.nombre || '', 84), hh = ln.length * 5.4;
      if (y + hh > H - 45) { doc.addPage(); y = 22; th(); }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10 * K); negro(); doc.text(ln, M, y);
      doc.text(String(i.cant), 118, y, { align: 'right' }); doc.text(money(i.precio), 152, y, { align: 'right' }); doc.text(money(i.cant * i.precio), W - M, y, { align: 'right' }); y += hh + 4;
    });
    if (y > H - 30) { doc.addPage(); y = 22; }
    doc.line(M, y, W - M, y); y += 10; doc.setFont('helvetica', 'bold'); doc.setFontSize(13 * K); negro(); doc.text('Total', M, y); doc.text(money(p.total), W - M, y, { align: 'right' }); y += 12;
    if (p.nota) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10 * K);
      var nl = doc.splitTextToSize(p.nota, W - 2 * M); if (y + 6 + nl.length * 5.8 > H - 15) { doc.addPage(); y = 22; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9 * K); gris(); doc.text('NOTA', M, y); y += 6; doc.setFont('helvetica', 'normal'); doc.setFontSize(10 * K); negro(); doc.text(nl, M, y);
    }
    if (p.ticket) {
      try { var im = await fitData(p.ticket, W - 2 * M, H - 50); doc.addPage(); doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(90, 102, 93); doc.text('Factura o ticket adjunto · Pedido Nº ' + pad(p.numero), M, 18); doc.addImage(im.d, 'JPEG', M, 26, im.w, im.h); } catch (e) {}
    }
    var nombre = 'pedido-' + pad(p.numero) + '-' + (slug(p.cliente) || 'cliente') + '.pdf';
    if (imprimir) {
      var w = window.open(doc.output('bloburl'), '_blank');
      if (!w) { doc.save(nombre); toast('Se descargó el PDF. Abrilo para imprimirlo.', 5000); }
    } else doc.save(nombre);
  } catch (e) { toast('No se pudo generar el PDF.'); }
}

/* ---------- ticket angosto (tipo supermercado, para impresora térmica) ---------- */
function tkWrap(txt, n) {
  var out = [], words = String(txt || '').split(/\s+/).filter(Boolean), cur = '';
  words.forEach(function (w) {
    while (w.length > n) { if (cur) { out.push(cur); cur = ''; } out.push(w.slice(0, n)); w = w.slice(n); }
    if (!cur) cur = w; else if ((cur + ' ' + w).length <= n) cur += ' ' + w; else { out.push(cur); cur = w; }
  });
  if (cur) out.push(cur);
  return out;
}
async function pdfTicket(p, imprimir) {
  var J = window.jspdf && window.jspdf.jsPDF; if (!J) { toast('No se pudo cargar el generador de PDF. Revisá la conexión.'); return; }
  try {
    var W = ls('tkw') === '58' ? 58 : 80, M = W === 58 ? 3 : 4, fs = (W === 58 ? 8 : 9) * 1.25;
    var cw = fs * 0.6 * 0.3528, cols = Math.floor((W - 2 * M) / cw), lh = fs * 0.3528 * 1.35;
    var L = [], num = function (n) { return Math.round(Number(n) || 0).toLocaleString('es-PY', { maximumFractionDigits: 0 }); };
    var sep = function () { L.push({ t: new Array(cols + 1).join('-') }); };
    var ctr = function (t, b, big) { tkWrap(t, big ? Math.floor(cols * 0.8) : cols).forEach(function (s) { L.push({ t: s, c: true, b: b, big: big }); }); };
    var two = function (a, b2, bold, big) { var n = big ? Math.floor(cols * 0.8) : cols; if (a.length + b2.length + 1 > n) { L.push({ t: a, b: bold, big: big }); L.push({ t: new Array(Math.max(0, n - b2.length) + 1).join(' ') + b2, b: bold, big: big }); return; } L.push({ t: a + new Array(n - a.length - b2.length + 1).join(' ') + b2, b: bold, big: big }); };
    var nn = (S.cfg.nombre || 'Pedido').trim(), ns = Math.min(1.875, cols / nn.length);
    if (ns >= 1.25) L.push({ t: nn, c: true, b: true, s: ns });
    else tkWrap(nn, Math.floor(cols / 1.25)).forEach(function (t) { L.push({ t: t, c: true, b: true, s: 1.25 }); });
    L.push({ t: '' });
    ctr('PEDIDO Nº ' + pad(p.numero), true);
    ctr('Fecha: ' + fdia(p.fecha));
    sep();
    L.push({ t: 'CLIENTE' });
    tkWrap(p.cliente, cols).forEach(function (s) { L.push({ t: s, b: true }); });
    var cl = p.clienteId && S.clientes.find(function (x) { return x.id === p.clienteId; });
    if (cl) [cl.nombre && cl.nombre !== p.cliente ? cl.nombre : '', cl.tel ? 'Tel: ' + cl.tel : '', cl.doc ? 'CI/RUC: ' + cl.doc : ''].filter(Boolean).forEach(function (t) { tkWrap(t, cols).forEach(function (s) { L.push({ t: s }); }); });
    sep();
    p.items.forEach(function (i) {
      tkWrap(i.nombre, cols).forEach(function (s) { L.push({ t: s }); });
      two('  ' + i.cant + ' x ' + num(i.precio), num(i.cant * i.precio));
    });
    sep();
    two('TOTAL', 'Gs. ' + num(p.total), true, true);
    sep();
    if (p.nota) { L.push({ t: 'NOTA' }); tkWrap(p.nota, cols).forEach(function (s) { L.push({ t: s }); }); sep(); }
    ctr('¡Gracias por su compra!');
    var H = Math.max(60, M * 2 + L.reduce(function (s, r) { return s + lh * (r.s ? r.s * 1.05 : r.big ? 1.3 : 1); }, 0) + 6);
    var doc = new J({ unit: 'mm', format: [W, H] });
    doc.setTextColor(0, 0, 0);
    var y = M + 3;
    L.forEach(function (r) {
      doc.setFont('courier', r.b ? 'bold' : 'normal'); doc.setFontSize(r.s ? fs * r.s : r.big ? fs * 1.25 : fs);
      if (r.t) { if (r.c) doc.text(r.t, W / 2, y, { align: 'center' }); else doc.text(r.t, M, y); }
      y += lh * (r.s ? r.s * 1.05 : r.big ? 1.3 : 1);
    });
    var nombre = 'ticket-' + pad(p.numero) + '-' + (slug(p.cliente) || 'cliente') + '.pdf';
    if (imprimir) {
      var w = window.open(doc.output('bloburl'), '_blank');
      if (!w) { doc.save(nombre); toast('Se descargó el ticket. Abrilo para imprimirlo.', 5000); }
    } else doc.save(nombre);
  } catch (e) { toast('No se pudo generar el ticket.'); }
}

function openFormato(p, imprimir) {
  var im = imprimir ? '1' : '0', ancho = ls('tkw') === '58' ? 58 : 80;
  openSheet(imprimir ? 'Imprimir pedido' : 'Descargar pedido', function (rec) {
    rec.body.innerHTML = '<p class="muted" style="margin:0">¿En qué formato?</p>' +
      '<button class="btn primary fmt" data-act="fmt" data-v="tk" data-im="' + im + '" data-id="' + esc(p.id) + '"><b>Ticket</b><small>Como los de supermercado, para impresora de rollo de ' + ancho + ' mm</small></button>' +
      '<button class="btn fmt" data-act="fmt" data-v="a4" data-im="' + im + '" data-id="' + esc(p.id) + '"><b>Hoja A4</b><small>Pedido completo con la foto de la factura</small></button>' +
      '<p class="muted" style="margin:0;font-size:13px">El ancho del rollo se cambia en Ajustes.</p>';
  }, 'Cancelar');
}

/* ---------- acciones ---------- */
/* ---------- ganancias y ventas (todas las cuentas) ---------- */
function openGanancias() {
  var g = 'dia';
  openSheet('Ganancias', function (rec) {
    var ymd = function (d) { return d.toLocaleDateString('en-CA'); };
    var lunes = function (d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
    function claveActual() { var n = new Date(); return g === 'dia' ? ymd(n) : g === 'semana' ? ymd(lunes(n)) : ymd(new Date(n.getFullYear(), n.getMonth(), 1)); }
    function desde() {
      var n = new Date();
      if (g === 'dia') return ymd(new Date(n.getFullYear(), n.getMonth(), n.getDate() - 13));
      if (g === 'semana') { var l = lunes(n); l.setDate(l.getDate() - 77); return ymd(l); }
      return ymd(new Date(n.getFullYear(), n.getMonth() - 11, 1));
    }
    function etiqueta(f) {
      var p = String(f).split('-').map(Number), d = new Date(p[0], p[1] - 1, p[2]);
      if (g === 'mes') return d.toLocaleDateString('es-PY', { month: 'long', year: 'numeric' });
      if (g === 'semana') return 'Semana del ' + fdia(f);
      return d.toLocaleDateString('es-PY', { weekday: 'short', day: 'numeric', month: 'short' });
    }
    var TIT = { dia: 'Hoy', semana: 'Esta semana', mes: 'Este mes' };
    var gcls = function (n) { return n < 0 ? ' neg' : ''; };
    function tabs() {
      return '<div class="seg-w">' + [['dia', 'Día'], ['semana', 'Semana'], ['mes', 'Mes']].map(function (x) {
        return '<button class="seg' + (g === x[0] ? ' on' : '') + '" data-g="' + x[0] + '">' + x[1] + '</button>';
      }).join('') + '</div>';
    }
    var fdt = function (t) { return new Date(t).toLocaleString('es-PY', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
    function paint(data, ventas) {
      var rows = data.map(function (r) {
        return { f: String(r.periodo).slice(0, 10), n: Number(r.pedidos) || 0, v: Number(r.ventas) || 0, c: Number(r.costo) || 0, gn: Number(r.ganancia) || 0, sc: Number(r.items_sin_costo) || 0 };
      });
      var key = claveActual();
      var cur = rows.find(function (r) { return r.f === key; }) || { f: key, n: 0, v: 0, c: 0, gn: 0, sc: 0 };
      var prev = rows.filter(function (r) { return r.f !== key; });
      var sinCosto = rows.reduce(function (s, r) { return s + r.sc; }, 0);
      var margen = cur.v > 0 ? Math.round(cur.gn / cur.v * 100) + ' %' : '—';
      rec.body.innerHTML = tabs() +
        '<div class="box"><p class="muted" style="margin:0">' + TIT[g] + '</p><p class="gan-big' + gcls(cur.gn) + '">' + money(cur.gn) + '</p><p class="muted" style="margin:0;font-size:13px">de ganancia</p>' +
        '<ul class="items" style="margin-top:8px"><li><span>Total vendido</span><b>' + money(cur.v) + '</b></li><li><span>Costo de la mercadería</span><b>' + money(cur.c) + '</b></li><li><span>Pedidos entregados</span><b>' + cur.n + '</b></li><li><span>Margen</span><b>' + margen + '</b></li></ul></div>' +
        (sinCosto && esGestor() ? '<div class="warnbox">' + sinCosto + ' producto' + (sinCosto === 1 ? '' : 's') + ' vendido' + (sinCosto === 1 ? '' : 's') + ' en este rango no tiene' + (sinCosto === 1 ? '' : 'n') + ' costo cargado, así que su ganancia sale completa. Cargá el costo en Mercadería para que el cálculo sea real.</div>' : '') +
        '<h3 class="sec">Ventas ' + (g === 'dia' ? 'de hoy' : g === 'semana' ? 'de esta semana' : 'de este mes') + '</h3>' +
        (ventas.length ? '<div class="box"><ul class="items">' + ventas.map(function (v) {
          var gn = Number(v.ganancia) || 0;
          return '<li><span><strong>#' + esc(v.numero) + ' · ' + esc(v.cliente) + '</strong><small>Pedido hecho: ' + esc(fdt(v.creado_en)) + (v.cargado_por ? ' · ' + esc(v.cargado_por) : '') + '</small><small>Entregado: ' + esc(fdt(v.entregado_en)) + '</small></span><b>' + money(v.total) + '<small class="' + gcls(gn).trim() + '">ganancia ' + money(gn) + '</small></b></li>';
        }).join('') + '</ul>' + (ventas.length >= 300 ? '<p class="muted" style="font-size:12px;margin:6px 0 0">Se muestran las 300 ventas más recientes.</p>' : '') + '</div>' : '<p class="muted" style="margin:0">Todavía no hay ventas entregadas en este período.</p>') +
        '<h3 class="sec">Períodos anteriores</h3>' +
        (prev.length ? '<div class="box"><ul class="items">' + prev.map(function (r) {
          return '<li><span>' + esc(etiqueta(r.f)) + '<small>' + r.n + ' pedido' + (r.n === 1 ? '' : 's') + ' · vendido ' + money(r.v) + ' · costo ' + money(r.c) + '</small></span><b class="' + gcls(r.gn).trim() + '">' + money(r.gn) + '</b></li>';
        }).join('') + '</ul></div>' : '<p class="muted" style="margin:0">Todavía no hay ventas entregadas en períodos anteriores.</p>') +
        '<p class="muted" style="margin:0;font-size:12px">Solo cuentan los pedidos en estado Entregado; la hora de entrega es cuando se marcó así. La ganancia es precio de venta menos precio de costo actual de cada producto.</p>';
    }
    async function load() {
      rec.body.innerHTML = tabs() + '<p class="muted">Cargando…</p>';
      var gq = g;
      var rs = await Promise.all([sb.rpc('resumen_ganancias', { p_desde: desde(), p_hasta: hoy(), p_agrupar: g }), sb.rpc('ventas_detalle', { p_desde: claveActual(), p_hasta: hoy() })]);
      if (gq !== g) return;
      var r = rs[0].error ? rs[0] : rs[1].error ? rs[1] : rs[0];
      if (r.error) { rec.body.innerHTML = tabs() + '<div class="empty">' + esc(errMsg(r.error, 'No se pudieron calcular las ganancias. Revisá la conexión y probá de nuevo.')) + '</div>'; return; }
      paint(r.data || [], rs[1].data || []);
    }
    rec.body.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-g]'); if (!b || b.dataset.g === g) return;
      g = b.dataset.g; load();
    });
    load();
  }, 'Volver');
}
async function setEstado(p, est) {
  if (p.estado === est) return;
  var r = await sb.rpc('cambiar_estado', { p_id: p.id, p_estado: est, p_por_nombre: me.nombre });
  if (r.error) { toast(errMsg(r.error, 'No se pudo cambiar el estado.')); return; }
  var fl = (r.data && r.data.faltas) || [];
  if (fl.length) toast('Estado cambiado.' + faltasTxt(fl), 7000);
  recargar();
}
document.addEventListener('click', function (e) {
  var b = e.target.closest('[data-act]'); if (!b) return;
  var a = b.dataset.act, id = b.dataset.id, v = b.dataset.v;
  var ped = function () { return S.peds.find(function (x) { return x.id === id; }); };
  if (a === 'tab') { S.tab = v; S.q = ''; drawTab(); }
  else if (a === 'filt') { S.filtro = v; drawTab(); }
  else if (a === 'cat') { S.cat = v; drawTab(); }
  else if (a === 'prov') { S.prov = v; drawTab(); }
  else if (a === 'fab') { if (S.tab === 'merc') { if (esGestor()) openProdForm(); } else if (S.tab === 'clientes') openClienteForm(); else openPedidoForm(); }
  else if (a === 'bell') openAvisos();
  else if (a === 'close') closeSheet();
  else if (a === 'openped') openDetail(id);
  else if (a === 'avopen') { if (ped()) openDetail(id); else toast('Ese pedido ya no existe.'); }
  else if (a === 'editcli') { var cc = S.clientes.find(function (x) { return x.id === id; }); if (cc) openClienteForm(cc); }
  else if (a === 'editprod') { var pr = S.prods.find(function (x) { return x.id === id; }); if (pr) { if (esGestor()) openProdForm(pr); else toast('Solo un encargado o administrador puede editar la mercadería.'); } }
  else if (a === 'editped') { var pe = ped(); if (pe) openPedidoForm(pe); }
  else if (a === 'setestado') { var ps = ped(); if (ps) setEstado(ps, v); }
  else if (a === 'pdfped') { var pp = ped(); if (pp) openFormato(pp, false); }
  else if (a === 'fmt') { var pf = ped(); if (pf) { closeSheet(); if (v === 'tk') pdfTicket(pf, b.dataset.im === '1'); else pdfPedido(pf, b.dataset.im === '1'); } }
  else if (a === 'printped') { var pq = ped(); if (pq) openFormato(pq, true); }
  else if (a === 'zoom') openSheet('Factura o ticket', function (r) { r.body.innerHTML = '<img class="zoom" alt="Factura o ticket" data-sp="' + esc(id) + '">'; });
  else if (a === 'delped') {
    var rec = stack[stack.length - 1], pd = ped(); if (!pd || !rec) return;
    if (!rec.confirm) { rec.confirm = true; rec.refresh(); setTimeout(function () { if (rec.confirm && rec.el.isConnected) { rec.confirm = false; rec.refresh(); } }, 4000); return; }
    sb.rpc('eliminar_pedido', { p_id: id, p_por_nombre: me.nombre }).then(function (r) {
      if (r.error) { toast(errMsg(r.error, 'No se pudo eliminar.')); return; }
      toast('Pedido eliminado. Se devolvió el stock.'); closeSheet(); recargar();
    });
  }
  else if (a === 'togcat') { S.catOff[v] = !b.checked; drawList(); }
  else if (a === 'togprecio') { S.catPrecios = b.checked; drawList(); }
  else if (a === 'gencat') pdfCatalogo();
  else if (a === 'logout') salir();
  else if (a === 'instalar') { if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; drawList(); } }
  else if (a === 'admin') { if (esAdmin()) openAdmin(); }
  else if (a === 'gan') openGanancias();
});
document.addEventListener('input', function (e) { var t = e.target; if (t.id === 'q') { S.q = t.value; drawList(); } });
document.addEventListener('change', function (e) {
  var t = e.target;
  if (t.id === 'tkw') { ls('tkw', t.value); toast('Listo. Los próximos tickets salen en ' + t.value + ' mm.'); }
  if (t.id === 'biz' && esGestor()) {
    var nombre = t.value.trim();
    sb.from('negocio').update({ nombre: nombre }).eq('id', 1).then(function (r) {
      if (r.error) { toast('No se pudo guardar el nombre.'); return; }
      S.cfg.nombre = nombre; drawTop(); toast('Nombre guardado.');
    });
  }
});
window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredInstall = e; if (S.tab === 'ajustes' && S.ok) drawList(); });

/* ---------- arranque ---------- */
$('#auth-form').addEventListener('submit', onAuthSubmit);
$('#a-toggle').addEventListener('click', function () { setAuthMode(authMode === 'in' ? 'up' : 'in'); });
$('#a-forgot').addEventListener('click', onForgot);
$('#denied-out').addEventListener('click', salir);
sb.auth.onAuthStateChange(function (ev) { if (ev === 'PASSWORD_RECOVERY') { show('login'); setAuthMode('newpass'); } });
if ('serviceWorker' in navigator) { window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); }); }
(async function () {
  setAuthMode('in');
  var r = await sb.auth.getSession();
  if (authMode === 'newpass') return;
  if (r.data && r.data.session) await entrar(r.data.session); else show('login');
})();
})();
