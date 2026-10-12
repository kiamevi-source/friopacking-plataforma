/* ═══════════════════════════════════════════════════════════════════════
   auth.js — sesión de Gerencia para app-live.

   Hace dos cosas:
     1) GUARD    — sin sesión válida, devuelve al login del portal.
     2) INYECTOR — cambia la anon key por el token de sesión en TODA
                   llamada a la instancia PMO, sea fetch crudo o supabase-js.

   Por qué así: app-live arma el header Authorization en ~38 sitios repartidos
   en 15 archivos. Interceptar window.fetch lo resuelve en un punto solo.

   Se carga en index.html Y en cada módulo: los módulos viven en iframes y
   cada iframe tiene su propio window.fetch. Debe ir ANTES que cualquier
   script que hable con Supabase.

   NO toca las llamadas a las instancias Supervisor ni Contratas: esas usan
   su propia anon key y meterles un token de PMO las rompería.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var PMO   = 'https://vsploxglutkbeokumunp.supabase.co';
  var K_TOK = 'fp_ger_token';
  var K_REF = 'fp_ger_refresh';

  /* La anon key sigue haciendo falta como header `apikey` (Supabase la exige
     para enrutar el proyecto). Lo que deja de viajar como identidad es el
     Bearer: ahí va el token de la persona. */
  var ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzcGxveGdsdXRrYmVva3VtdW5wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3OTMyMzEsImV4cCI6MjA5MjM2OTIzMX0.wca52ejPsimIyG-iHS3TFRv4xjZF-55eDWoRR2I9nL0';

  function leer(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function borrar() {
    try { localStorage.removeItem(K_TOK); localStorage.removeItem(K_REF); } catch (e) {}
  }

  /* Ruta del portal: /app-live/… → /  (funciona igual en Vercel y en local) */
  function urlLogin() {
    var p = location.pathname;
    var i = p.indexOf('/app-live/');
    return (i >= 0 ? p.slice(0, i) : '') + '/#gerencia';
  }

  function cuerpo(tok) {
    try {
      var b = tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(b + '==='.slice((b.length + 3) % 4)));
    } catch (e) { return null; }
  }

  /* 30 s de colchón: no sirve un token que expira mientras vuela la petición. */
  function vigente(tok) {
    var p = tok && cuerpo(tok);
    return !!(p && p.exp && p.exp * 1000 > Date.now() + 30000);
  }

  /* Anti-bucle: si el portal no está donde lo esperamos (p. ej. un servidor
     local que sirve app-live como raíz), redirigir sin fin dejaría el
     navegador girando. Al segundo intento seguido, mejor decirlo. */
  function alLogin() {
    borrar();
    var destino = urlLogin();
    var yaVolvi = false;
    try {
      var t = +(sessionStorage.getItem('fp_ger_redir') || 0);
      yaVolvi = (Date.now() - t) < 5000;
      sessionStorage.setItem('fp_ger_redir', String(Date.now()));
    } catch (e) {}

    if (yaVolvi) { avisoSesion(destino); return; }
    try { (window.top || window).location.replace(destino); }
    catch (e) { location.replace(destino); }
  }

  function avisoSesion(destino) {
    var pinta = function () {
      document.body.innerHTML =
        '<div style="font:16px/1.6 system-ui,sans-serif;max-width:32rem;margin:20vh auto;' +
        'padding:2rem;text-align:center;color:#0f172a">' +
        '<h1 style="font-size:1.25rem;margin:0 0 .5rem">Sesión requerida</h1>' +
        '<p style="margin:0 0 1.25rem;color:#475569">Inicia sesión en el portal para entrar a Gerencia.</p>' +
        '<a href="' + destino + '" style="display:inline-block;background:#081860;color:#fff;' +
        'padding:.7rem 1.4rem;border-radius:.5rem;text-decoration:none">Ir al portal</a></div>';
    };
    if (document.body) pinta();
    else document.addEventListener('DOMContentLoaded', pinta);
  }

  var _fetch = window.fetch.bind(window);
  var renovando = null;

  /* Un solo refresh en vuelo aunque diez peticiones lo pidan a la vez. */
  function renovar() {
    var ref = leer(K_REF);
    if (!ref) return Promise.resolve(null);
    if (renovando) return renovando;

    renovando = _fetch(PMO + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { 'apikey': ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: ref })
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.access_token) return null;
        try {
          localStorage.setItem(K_TOK, d.access_token);
          if (d.refresh_token) localStorage.setItem(K_REF, d.refresh_token);
        } catch (e) {}
        return d.access_token;
      })
      .catch(function () { return null; })
      .then(function (t) { renovando = null; return t; });

    return renovando;
  }

  function token() {
    var t = leer(K_TOK);
    if (vigente(t)) return Promise.resolve(t);
    return renovar();
  }

  try { if (leer(K_TOK) || leer(K_REF)) sessionStorage.removeItem('fp_ger_redir'); } catch (e) {}

  window.fetch = function (entrada, opciones) {
    var url = typeof entrada === 'string' ? entrada
            : (entrada && entrada.url) ? entrada.url : '';

    /* Todo lo que no sea PMO pasa intacto: Supervisor, Contratas, CDNs, mapas. */
    if (url.indexOf(PMO) !== 0) return _fetch(entrada, opciones);

    /* El propio login/refresh viaja con apikey, no con sesión. */
    if (url.indexOf('/auth/v1/') !== -1) return _fetch(entrada, opciones);

    return token().then(function (t) {
      if (!t) {
        alLogin();
        return new Response('{"message":"sesión expirada"}',
          { status: 401, headers: { 'Content-Type': 'application/json' } });
      }

      var req = (typeof Request !== 'undefined' && entrada instanceof Request) ? entrada : null;
      var op  = Object.assign({}, opciones || {});
      var h   = new Headers((req ? req.headers : null) || op.headers || {});

      h.set('Authorization', 'Bearer ' + t);
      if (!h.get('apikey')) h.set('apikey', ANON);
      op.headers = h;

      return _fetch(req ? new Request(req, { headers: h }) : entrada, req ? undefined : op)
        .then(function (res) {
          /* Sesión repudiada por el servidor → al login, no a una pantalla vacía. */
          if (res.status === 401) alLogin();
          return res;
        });
    });
  };

  /* Guard de arranque: sin token ni refresh, ni se intenta pintar. */
  if (!leer(K_TOK) && !leer(K_REF)) alLogin();

  /* Utilidades para la UI (quién soy / cerrar sesión). */
  window.FP_AUTH = {
    email: function () { var p = cuerpo(leer(K_TOK) || ''); return (p && p.email) || ''; },
    salir: alLogin
  };
})();
