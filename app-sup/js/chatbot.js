/* ════════════════════════════════════════════════════════════════════
   chatbot.js — Asistente PMO FrioPacking (Opción A · diseño B-ready)

   Arquitectura en 2 capas claramente separadas para poder enchufar un
   LLM (Opción B) más adelante SIN rehacer nada:

     1. TOOLS  → window.PMOChat.tools : funciones async que consultan la
                 data LIVE de Supabase y devuelven datos estructurados.
                 Estas son las "herramientas" que un LLM invocaría como
                 function-calls en la Opción B. Reutilizables al 100%.

     2. BRAIN  → router de intenciones por palabras clave (Opción A).
                 En la Opción B se reemplaza por el LLM, que decide qué
                 tool llamar. La UI y las tools quedan intactas.

   - Autónomo: solo depende de window.sb (core.js). Crea su propia UI.
   - Responsive: panel flotante en escritorio, hoja inferior en móvil.
   - Multiusuario: sin estado atado al navegador (solo consulta; el
     historial vive en memoria de la sesión).
   - Portable: pensado para soltarse en las 3 apps (cada una apunta a su
     propio Supabase vía window.sb).
   Dependencias: core.js (window.sb), lucide (opcional).
   ════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  // Configuración (multi-app) — window.FP_CHAT_CFG
  //   Sin config  → PMO completo usando window.sb (100% compatible).
  //   Con config  → cliente Supabase propio + capacidades (caps) y marca.
  //   Forma:
  //     window.FP_CHAT_CFG = {
  //       sbUrl, sbKey,                       // cliente propio (opcional)
  //       brand: { title, subtitle, greet },  // marca de la UI
  //       caps:  { financials, valorizacion, servicios, evalSup,
  //                evalCon, personal }        // qué puede responder
  //     }
  // ─────────────────────────────────────────────────────────────
  const CFG = window.FP_CHAT_CFG || {};
  const CAPS = Object.assign({
    financials: true,   // venta/facturado/valorizacion_pct en proyectos
    valorizacion: true, // herramienta de valorización/facturación
    servicios: true,    // tabla portafolio_servicios
    evalSup: true,      // tabla evaluacion_supervisores
    evalCon: true,      // tabla evaluacion_contratistas
    personal: true,     // dotación (reportes.personal_total)
  }, CFG.caps || {});
  const BRAND = Object.assign({
    title: 'Asistente PMO',
    subtitle: 'Datos en vivo · FrioPacking',
    greet: '¡Hola! 👋 Soy tu <b>Asistente PMO</b>. Consulto la información en vivo de proyectos, reportes, valorización y servicios.<br>¿Qué necesitas saber?',
  }, CFG.brand || {});

  // Token de sesión: si la app guarda un JWT (p.ej. app-sup en
  // localStorage['sb_token']), el RLS escopa los datos al usuario logueado.
  // Se lee EN CADA request para no quedar con un token caducado.
  function storedToken() {
    if (!CFG.sbTokenKey) return CFG.sbToken || null;
    try { return localStorage.getItem(CFG.sbTokenKey); } catch (e) { return null; }
  }

  // Shim PostgREST mínimo (thenable) para apps que NO cargan supabase-js
  // (p.ej. app-sup usa fetch crudo). Soporta solo lo que usan las tools:
  // .from(table).select(cols)[.eq()/.gte()/.order()] → await {data,error}.
  // apikey = clave anon; Authorization = token de sesión si existe (RLS).
  function restClient(url, apikey, getToken) {
    const base = url.replace(/\/+$/, '') + '/rest/v1/';
    return {
      from(table) {
        const params = [];
        const b = {
          select(cols) { params.push('select=' + encodeURIComponent(cols)); return b; },
          eq(col, val) { params.push(`${col}=eq.${encodeURIComponent(val)}`); return b; },
          gte(col, val) { params.push(`${col}=gte.${encodeURIComponent(val)}`); return b; },
          order(col, opts) { params.push(`order=${col}.${opts && opts.ascending === false ? 'desc' : 'asc'}`); return b; },
          then(resolve, reject) {
            const tok = (getToken && getToken()) || apikey;
            const u = base + table + '?' + params.join('&');
            fetch(u, { headers: { apikey: apikey, Authorization: 'Bearer ' + tok } })
              .then(r => r.json().then(j => (r.ok ? { data: j, error: null } : { data: null, error: j })))
              .then(resolve, reject);
          },
        };
        return b;
      },
    };
  }

  // Cliente: con creds en cfg → shim REST (apikey anon + token de sesión).
  // Sin creds → window.sb global (app-live, 100% compatible).
  let _client = null;
  function client() {
    if (_client) return _client;
    if (CFG.sbUrl && CFG.sbKey) {
      _client = restClient(CFG.sbUrl, CFG.sbKey, storedToken);
      return _client;
    }
    _client = window.sb || null;
    return _client;
  }

  // ─────────────────────────────────────────────────────────────
  // Utilidades
  // ─────────────────────────────────────────────────────────────
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const norm = (s) => String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quitar acentos
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();

  const nf = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 0 });
  const money = (v) => 'S/ ' + nf.format(Math.round(Number(v) || 0));
  const pct = (v) => (Number(v) || 0).toFixed(1) + '%';

  function parseSpi(s) {
    if (s == null || s === '') return null;
    let v = parseFloat(String(s).replace(',', '.').replace('%', ''));
    if (!isFinite(v)) return null;
    if (v > 3) v = v / 100; // venía como porcentaje
    return v;
  }

  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function daysUntil(iso) {
    if (!iso) return null;
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const d = new Date(iso); d.setHours(0, 0, 0, 0);
    if (isNaN(d)) return null;
    return Math.round((d - t) / 86400000);
  }
  const monthsShort = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return String(iso);
    return `${d.getDate()} ${monthsShort[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
  }

  // ─────────────────────────────────────────────────────────────
  // CAPA 1 · DATA (cache con TTL) + TOOLS
  // ─────────────────────────────────────────────────────────────
  const TTL = 3 * 60 * 1000; // 3 min
  const cache = { proyectos: null, reportes: null, servicios: null, evalCon: null, evalSup: null, ts: {} };

  function fresh(key) { return cache[key] && (Date.now() - (cache.ts[key] || 0) < TTL); }

  async function q(key, table, cols, builder) {
    if (fresh(key)) return cache[key];
    const sb = client();
    if (!sb) throw new Error('Sin conexión a la base de datos.');
    let query = sb.from(table).select(cols);
    if (builder) query = builder(query);
    const { data, error } = await query;
    if (error) throw error;
    cache[key] = data || [];
    cache.ts[key] = Date.now();
    return cache[key];
  }

  // Columnas seguras en TODAS las apps (Supervisor no tiene las financieras).
  const PROJ_COLS_BASE = 'id,nombre,estado,supervisor,zona,fecha_ini_contractual,fecha_fin_contractual,activo,cod_proyecto';
  const PROJ_COLS_FIN = ',asistente,categoria,departamento,provincia,distrito,venta,facturado,por_facturar,valorizacion_pct,fecha_fin_real';

  const data = {
    proyectos: () => q('proyectos', 'proyectos',
      PROJ_COLS_BASE + (CAPS.financials ? PROJ_COLS_FIN : ''),
      (qb) => qb.eq('activo', true)),
    reportes: () => q('reportes', 'reportes',
      'nombre_proyecto,supervisor,fecha_reporte,pct_planificado,pct_ejecutado,spi,desfase_dias,personal_total,contratas_activas',
      (qb) => qb.gte('fecha_reporte', new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10)).order('fecha_reporte', { ascending: false })),
    servicios: () => q('servicios', 'portafolio_servicios',
      'cliente,especialidad,situacion,estado,supervisor,contratista,fecha_inicio,fecha_fin'),
    evalCon: () => q('evalCon', 'evaluacion_contratistas',
      'contratista,supervisor,especialidad,puntaje_final,clasificacion,periodo'),
    evalSup: () => q('evalSup', 'evaluacion_supervisores',
      'supervisor_nombre,cargo,promedio,periodo'),
  };

  // Último reporte por proyecto (mapa nombre→reporte más reciente)
  function lastReportByProject(reportes) {
    const map = {};
    reportes.forEach((r) => {
      const k = (r.nombre_proyecto || '').trim().toUpperCase();
      if (!k) return;
      if (!map[k] || (r.fecha_reporte > map[k].fecha_reporte)) map[k] = r;
    });
    return map;
  }

  const isEnProgreso = (p) => (p.estado || '').trim().toLowerCase() === 'en progreso';

  // ── TOOLS: cada una devuelve datos estructurados (B-ready) ──
  const tools = {
    async resumen() {
      const [projs, reps] = await Promise.all([data.proyectos(), data.reportes()]);
      const last = lastReportByProject(reps);
      const today = todayISO();
      const reportedToday = new Set(reps.filter(r => r.fecha_reporte === today).map(r => (r.nombre_proyecto || '').trim().toUpperCase()));
      const enProg = projs.filter(isEnProgreso);
      const sinReporte = enProg.filter(p => !reportedToday.has((p.nombre || '').trim().toUpperCase()));
      const cartera = projs.reduce((a, p) => a + (Number(p.venta) || 0), 0);
      const facturado = projs.reduce((a, p) => a + (Number(p.facturado) || 0), 0);
      const cfVenc = projs.filter(p => {
        const d = daysUntil(p.fecha_fin_contractual);
        if (d == null || d >= 0) return false;
        // Con datos financieros excluimos los ya valorizados; sin ellos, solo fecha.
        return CAPS.financials ? (Number(p.valorizacion_pct) || 0) < 99 : true;
      });
      return { totalActivos: projs.length, enProgreso: enProg.length, sinReporte, cartera, facturado, cfVenc, last, fin: CAPS.financials };
    },
    async sinReporte() {
      const [projs, reps] = await Promise.all([data.proyectos(), data.reportes()]);
      const today = todayISO();
      const reportedToday = new Set(reps.filter(r => r.fecha_reporte === today).map(r => (r.nombre_proyecto || '').trim().toUpperCase()));
      return projs.filter(isEnProgreso).filter(p => !reportedToday.has((p.nombre || '').trim().toUpperCase()));
    },
    async cfVencidas() {
      const projs = await data.proyectos();
      return projs.filter(p => {
        const d = daysUntil(p.fecha_fin_contractual);
        if (d == null || d >= 0) return false;
        return CAPS.financials ? (Number(p.valorizacion_pct) || 0) < 99 : true;
      }).sort((a, b) => daysUntil(a.fecha_fin_contractual) - daysUntil(b.fecha_fin_contractual));
    },
    async porVencer(dias) {
      const lim = dias || 14;
      const projs = await data.proyectos();
      return projs.map(p => ({ p, d: daysUntil(p.fecha_fin_contractual) }))
        .filter(x => x.d != null && x.d >= 0 && x.d <= lim)
        .sort((a, b) => a.d - b.d);
    },
    async proyecto(name) {
      const [projs, reps] = await Promise.all([data.proyectos(), data.reportes()]);
      const p = findProject(norm(name), projs);
      if (!p) return null;
      const last = lastReportByProject(reps)[(p.nombre || '').trim().toUpperCase()] || null;
      return { p, last };
    },
    async porSupervisor(name) {
      const [projs, reps] = await Promise.all([data.proyectos(), data.reportes()]);
      const ns = norm(name);
      const sup = uniqList(projs.map(p => p.supervisor)).find(s => norm(s).includes(ns) || ns.includes(norm(s)));
      if (!sup) return null;
      const list = projs.filter(p => norm(p.supervisor) === norm(sup));
      const last = lastReportByProject(reps);
      return { sup, list, last };
    },
    async valorizacion() {
      const projs = await data.proyectos();
      const cartera = projs.reduce((a, p) => a + (Number(p.venta) || 0), 0);
      const facturado = projs.reduce((a, p) => a + (Number(p.facturado) || 0), 0);
      const porFacturar = projs.reduce((a, p) => a + (Number(p.por_facturar) || (Number(p.venta) || 0) - (Number(p.facturado) || 0)), 0);
      const sinValorizar = projs.filter(p => (Number(p.facturado) || 0) === 0 && (Number(p.valorizacion_pct) || 0) > 10);
      const baja = projs.filter(p => {
        const v = Number(p.venta) || 0, f = Number(p.facturado) || 0;
        return f > 0 && v > 0 && (f / v) < 0.3 && (Number(p.valorizacion_pct) || 0) > 30;
      });
      return { cartera, facturado, porFacturar, sinValorizar, baja };
    },
    async servicios() {
      const s = await data.servicios();
      const by = (key) => s.reduce((m, r) => { const k = (r[key] || '—').trim(); m[k] = (m[k] || 0) + 1; return m; }, {});
      const pend = s.filter(r => /pend|licit/i.test(r.situacion || ''));
      return { total: s.length, situacion: by('situacion'), estado: by('estado'), pendientes: pend };
    },
    async contratistas(top) {
      const ev = await data.evalCon();
      // Quedarnos con la evaluación más reciente por contratista
      const byC = {};
      ev.forEach(r => {
        const k = (r.contratista || '').trim();
        if (!k) return;
        if (!byC[k] || (r.periodo || '') > (byC[k].periodo || '')) byC[k] = r;
      });
      return Object.values(byC).sort((a, b) => (Number(b.puntaje_final) || 0) - (Number(a.puntaje_final) || 0)).slice(0, top || 8);
    },
    async supervisores(top) {
      const ev = await data.evalSup();
      const byS = {};
      ev.forEach(r => {
        const k = (r.supervisor_nombre || '').trim();
        if (!k) return;
        if (!byS[k] || (r.periodo || '') > (byS[k].periodo || '')) byS[k] = r;
      });
      return Object.values(byS).sort((a, b) => (Number(b.promedio) || 0) - (Number(a.promedio) || 0)).slice(0, top || 8);
    },
    async personal() {
      const [projs, reps] = await Promise.all([data.proyectos(), data.reportes()]);
      const last = lastReportByProject(reps);
      let total = 0; const bySup = {};
      projs.forEach(p => {
        const r = last[(p.nombre || '').trim().toUpperCase()];
        const n = r ? (Number(r.personal_total) || 0) : 0;
        total += n;
        const s = (p.supervisor || '—').trim();
        bySup[s] = (bySup[s] || 0) + n;
      });
      return { total, bySup };
    },
  };

  function uniqList(arr) { return [...new Set(arr.filter(Boolean).map(s => String(s).trim()))]; }

  function findProject(n, projs) {
    const stop = new Set(['el', 'la', 'los', 'las', 'de', 'del', 'en', 'y', 'a', 'proyecto', 'obra', 'como', 'va', 'esta', 'el', 'que', 'spi', 'avance', 'un', 'una', 'el', 'estado', 'info', 'datos', 'dame', 'muestra', 'ver']);
    const qt = n.split(' ').filter(t => t.length >= 3 && !stop.has(t));
    let best = null, bestScore = 0;
    projs.forEach(p => {
      const name = norm(p.nombre || '');
      if (!name) return;
      let score = 0;
      qt.forEach(t => { if (name.includes(t)) score += t.length; });
      if (name.length > 5 && n.includes(name)) score += name.length;
      if (score > bestScore) { bestScore = score; best = p; }
    });
    return bestScore >= 4 ? best : null;
  }

  // Avance + SPI legibles de un proyecto (a partir de su último reporte)
  function projVitals(p, last) {
    const av = last && last.pct_ejecutado != null ? Number(last.pct_ejecutado) : (Number(p.valorizacion_pct) || null);
    const plan = last && last.pct_planificado != null ? Number(last.pct_planificado) : null;
    const spi = last ? parseSpi(last.spi) : null;
    return { av, plan, spi };
  }

  // ─────────────────────────────────────────────────────────────
  // CAPA 2 · BRAIN (router de intenciones) → se reemplaza por LLM en B
  // ─────────────────────────────────────────────────────────────
  const has = (n, ...kw) => kw.some(k => n.includes(k));

  async function answer(raw) {
    const n = norm(raw);
    if (!n) return { html: 'Escríbeme una pregunta sobre los proyectos 🙂' };

    // Ayuda
    if (has(n, 'ayuda', 'que puedes', 'que sabes', 'opciones', 'help', 'menu', 'que hago')) return helpMsg();

    // Resumen / estado general
    if (has(n, 'resumen', 'como vamos', 'estado general', 'panorama', 'como va todo', 'situacion general', 'overview', 'reporte del dia', 'como estamos'))
      return fmtResumen(await tools.resumen());

    // Sin reporte
    if (has(n, 'sin reporte', 'no reporto', 'no reportaron', 'falta reporte', 'pendiente de reporte', 'no han reportado'))
      return fmtList('Proyectos sin reporte hoy', await tools.sinReporte(), p => `${esc(p.nombre)} · <span class="cb-dim">${esc(p.supervisor || 's/sup')}</span>`, 'clipboard-x');

    // CF vencidas
    if (has(n, 'cf vencid', 'vencidas', 'vencido', 'fin contractual', 'contractual pasad', 'pasaron de fecha'))
      return fmtList(CAPS.financials ? 'CF vencidas (sin valorización completa)' : 'Proyectos con fecha contractual vencida', await tools.cfVencidas(),
        p => `${esc(p.nombre)} · <span class="cb-bad">${Math.abs(daysUntil(p.fecha_fin_contractual))}d vencido</span>${CAPS.financials ? ` · val ${pct(p.valorizacion_pct)}` : (p.supervisor ? ` · <span class="cb-dim">${esc(p.supervisor)}</span>` : '')}`, 'calendar-x-2');

    // Por vencer / próximos
    if (has(n, 'por vencer', 'proximos a vencer', 'proximos vencimientos', 'vencen', 'a punto de vencer', 'cerca de vencer')) {
      const m = n.match(/(\d+)\s*(dia|d)/); const dias = m ? parseInt(m[1]) : 14;
      const arr = await tools.porVencer(dias);
      return fmtList(`Vencen en ≤${dias} días`, arr.map(x => x.p),
        (p) => { const d = daysUntil(p.fecha_fin_contractual); return `${esc(p.nombre)} · <span class="${d <= 3 ? 'cb-bad' : 'cb-warn'}">${d === 0 ? 'hoy' : 'en ' + d + 'd'}</span> · ${fmtDate(p.fecha_fin_contractual)}`; }, 'clock');
    }

    // Valorización / facturación
    if (CAPS.valorizacion && has(n, 'valoriz', 'facturac', 'facturado', 'por cobrar', 'por facturar', 'cobranza', 'cartera', 'ingresos', 'venta total'))
      return fmtValorizacion(await tools.valorizacion());

    // Servicios / portafolio
    if (CAPS.servicios && has(n, 'servicio', 'portafolio', 'contratado', 'licitacion'))
      return fmtServicios(await tools.servicios());

    // Contratistas
    if (CAPS.evalCon && has(n, 'contratista', 'contratas', 'mejor empresa', 'ranking de contratista', 'evaluacion de contratista'))
      return fmtRankCon(await tools.contratistas(8));

    // Supervisores (ranking)
    if (CAPS.evalSup && has(n, 'ranking de supervisor', 'mejor supervisor', 'evaluacion de supervisor', 'puntaje supervisor', 'desempeno supervisor'))
      return fmtRankSup(await tools.supervisores(8));

    // Personal / dotación
    if (CAPS.personal && has(n, 'personal', 'dotacion', 'cuanta gente', 'cuantos trabajadores', 'mano de obra', 'equipos de trabajo'))
      return fmtPersonal(await tools.personal());

    // Por supervisor concreto (si menciona "supervisor X" o un nombre de supervisor)
    if (has(n, 'supervisor', 'a cargo de', 'proyectos de')) {
      const r = await tools.porSupervisor(raw);
      if (r) return fmtSupervisor(r);
    }

    // SPI explícito
    if (has(n, 'spi')) {
      const r = await tools.proyecto(raw);
      if (r) return fmtProyecto(r);
      // SPI global: peores
      const [projs, reps] = await Promise.all([data.proyectos(), data.reportes()]);
      const last = lastReportByProject(reps);
      const rows = projs.map(p => ({ p, spi: parseSpi((last[(p.nombre || '').trim().toUpperCase()] || {}).spi) }))
        .filter(x => x.spi != null).sort((a, b) => a.spi - b.spi).slice(0, 8);
      return fmtList('Proyectos con peor SPI', rows.map(x => x.p), (p) => {
        const s = parseSpi((last[(p.nombre || '').trim().toUpperCase()] || {}).spi);
        return `${esc(p.nombre)} · <span class="${s < 0.85 ? 'cb-bad' : s < 0.95 ? 'cb-warn' : 'cb-ok'}">SPI ${s.toFixed(2)}</span>`;
      }, 'activity');
    }

    // Búsqueda de proyecto por nombre (último recurso)
    const r = await tools.proyecto(raw);
    if (r) return fmtProyecto(r);
    const sup = await tools.porSupervisor(raw);
    if (sup) return fmtSupervisor(sup);

    // Fallback
    return { html: `No identifiqué la consulta. Prueba con algo como:<br>${suggestionChips(defaultChips())}<div class="cb-hint">o escribe <b>ayuda</b> para ver todo lo que puedo responder.</div>` };
  }

  // ─────────────────────────────────────────────────────────────
  // Formateadores de respuesta (presentación)
  // ─────────────────────────────────────────────────────────────
  // Sugerencias según capacidades activas.
  function defaultChips() {
    const c = ['Resumen del día', 'Sin reporte', 'CF vencidas'];
    if (CAPS.valorizacion) c.push('Valorización');
    if (CAPS.evalCon) c.push('Ranking contratistas');
    else if (CAPS.personal) c.push('Personal');
    return c;
  }

  function helpMsg() {
    let li = `
        <li><b>Resumen del día</b> — panorama general</li>
        <li><b>Proyectos sin reporte</b> · <b>CF vencidas</b> · <b>por vencer</b></li>`;
    if (CAPS.valorizacion) li += `\n        <li><b>Valorización</b> / facturación / por cobrar</li>`;
    if (CAPS.servicios) li += `\n        <li><b>Servicios</b> (portafolio) · contratado/pendiente</li>`;
    li += `\n        <li><b>SPI</b> de un proyecto, o el avance de "<i>nombre del proyecto</i>"</li>`;
    let rank = [];
    if (CAPS.evalCon) rank.push('contratistas');
    if (CAPS.evalSup) rank.push('supervisores');
    li += `\n        <li><b>Supervisor X</b> — sus proyectos${rank.length ? ` · <b>ranking</b> de ${rank.join('/')}` : ''}</li>`;
    if (CAPS.personal) li += `\n        <li><b>Personal</b> / dotación por supervisor</li>`;
    return {
      html: `Soy el <b>${esc(BRAND.title)}</b>. Consulto la data en vivo. Pregúntame por:
      <ul class="cb-ul">${li}
      </ul>
      ${suggestionChips(defaultChips())}`
    };
  }

  function kpiRow(items) {
    return `<div class="cb-kpis">${items.map(k => `<div class="cb-kpi"><div class="cb-kpi-v ${k.cls || ''}">${k.v}</div><div class="cb-kpi-l">${esc(k.l)}</div></div>`).join('')}</div>`;
  }

  function fmtResumen(r) {
    const fpct = r.cartera ? (r.facturado / r.cartera * 100) : 0;
    let html = kpiRow([
      { l: 'Activos', v: r.totalActivos },
      { l: 'En progreso', v: r.enProgreso },
      { l: 'Sin reporte', v: r.sinReporte.length, cls: r.sinReporte.length ? 'cb-warn' : 'cb-ok' },
      { l: r.fin ? 'CF vencidas' : 'CF vencida', v: r.cfVenc.length, cls: r.cfVenc.length ? 'cb-bad' : 'cb-ok' },
    ]);
    if (r.fin) html += `<div class="cb-line"><b>Cartera:</b> ${money(r.cartera)} · <b>Facturado:</b> ${money(r.facturado)} <span class="cb-dim">(${pct(fpct)})</span></div>`;
    if (r.sinReporte.length) html += `<div class="cb-line cb-warn">⚠ ${r.sinReporte.length} en progreso sin reporte hoy.</div>`;
    if (r.cfVenc.length) html += `<div class="cb-line cb-bad">⛔ ${r.cfVenc.length} con fecha contractual vencida.</div>`;
    if (!r.sinReporte.length && !r.cfVenc.length) html += `<div class="cb-line cb-ok">✓ Todo en orden operativo.</div>`;
    return { html };
  }

  function fmtList(title, arr, rowFn, icon) {
    if (!arr || !arr.length) return { html: `<div class="cb-ok">✓ ${esc(title)}: ninguno.</div>` };
    const shown = arr.slice(0, 12);
    let html = `<div class="cb-title">${esc(title)} <span class="cb-count">${arr.length}</span></div><div class="cb-rows">`;
    html += shown.map(p => `<div class="cb-r"><i data-lucide="${icon || 'dot'}"></i><span>${rowFn(p)}</span></div>`).join('');
    html += '</div>';
    if (arr.length > shown.length) html += `<div class="cb-hint">+${arr.length - shown.length} más…</div>`;
    return { html };
  }

  function fmtProyecto(r) {
    const { p, last } = r;
    const v = projVitals(p, last);
    const d = daysUntil(p.fecha_fin_contractual);
    let html = `<div class="cb-title">${esc(p.nombre)}${p.cod_proyecto ? ` <span class="cb-dim">${esc(p.cod_proyecto)}</span>` : ''}</div>`;
    html += kpiRow([
      { l: 'Avance', v: v.av != null ? pct(v.av) : '—' },
      { l: 'Plan', v: v.plan != null ? pct(v.plan) : '—' },
      { l: 'SPI', v: v.spi != null ? v.spi.toFixed(2) : '—', cls: v.spi == null ? '' : v.spi < 0.85 ? 'cb-bad' : v.spi < 0.95 ? 'cb-warn' : 'cb-ok' },
    ]);
    html += `<div class="cb-kv"><b>Estado:</b> ${esc(p.estado || '—')}</div>`;
    html += `<div class="cb-kv"><b>Supervisor:</b> ${esc(p.supervisor || '—')}${p.asistente ? ` · asist. ${esc(p.asistente)}` : ''}</div>`;
    const ubic = [p.distrito, p.provincia, p.departamento].filter(Boolean).join(', ');
    if (ubic) html += `<div class="cb-kv"><b>Ubicación:</b> ${esc(ubic)}</div>`;
    if (CAPS.financials) html += `<div class="cb-kv"><b>Venta:</b> ${money(p.venta)} · <b>Facturado:</b> ${money(p.facturado)} <span class="cb-dim">(${pct(p.venta ? (p.facturado / p.venta * 100) : 0)})</span></div>`;
    html += `<div class="cb-kv"><b>Fin contractual:</b> ${fmtDate(p.fecha_fin_contractual)}${d != null ? ` · <span class="${d < 0 ? 'cb-bad' : d <= 3 ? 'cb-warn' : 'cb-dim'}">${d < 0 ? Math.abs(d) + 'd vencido' : 'en ' + d + 'd'}</span>` : ''}</div>`;
    if (last) html += `<div class="cb-hint">Último reporte: ${fmtDate(last.fecha_reporte)}${last.personal_total != null ? ` · ${last.personal_total} personas` : ''}</div>`;
    else html += `<div class="cb-hint cb-warn">Sin reportes recientes.</div>`;
    return { html };
  }

  function fmtSupervisor(r) {
    const { sup, list, last } = r;
    const cartera = list.reduce((a, p) => a + (Number(p.venta) || 0), 0);
    let html = `<div class="cb-title">Supervisor: ${esc(sup)}</div>`;
    html += kpiRow(CAPS.financials ? [{ l: 'Proyectos', v: list.length }, { l: 'Cartera', v: money(cartera) }] : [{ l: 'Proyectos', v: list.length }]);
    html += '<div class="cb-rows">';
    html += list.slice(0, 12).map(p => {
      const s = parseSpi((last[(p.nombre || '').trim().toUpperCase()] || {}).spi);
      return `<div class="cb-r"><i data-lucide="folder"></i><span>${esc(p.nombre)} · <span class="cb-dim">${esc(p.estado || '—')}</span>${s != null ? ` · <span class="${s < 0.85 ? 'cb-bad' : s < 0.95 ? 'cb-warn' : 'cb-ok'}">SPI ${s.toFixed(2)}</span>` : ''}</span></div>`;
    }).join('');
    html += '</div>';
    if (list.length > 12) html += `<div class="cb-hint">+${list.length - 12} más…</div>`;
    return { html };
  }

  function fmtValorizacion(r) {
    const fpct = r.cartera ? (r.facturado / r.cartera * 100) : 0;
    let html = kpiRow([
      { l: 'Cartera', v: money(r.cartera) },
      { l: 'Facturado', v: money(r.facturado), cls: 'cb-ok' },
      { l: 'Por facturar', v: money(r.porFacturar), cls: 'cb-warn' },
    ]);
    html += `<div class="cb-line"><b>Facturación:</b> ${pct(fpct)} de la cartera</div>`;
    if (r.sinValorizar.length) html += `<div class="cb-line cb-bad">⛔ ${r.sinValorizar.length} con avance pero sin facturar.</div>`;
    if (r.baja.length) html += `<div class="cb-line cb-warn">⚠ ${r.baja.length} con facturación baja (&lt;30%).</div>`;
    const top = r.sinValorizar.slice(0, 6);
    if (top.length) {
      html += '<div class="cb-rows">' + top.map(p => `<div class="cb-r"><i data-lucide="dollar-sign"></i><span>${esc(p.nombre)} · <span class="cb-dim">val ${pct(p.valorizacion_pct)}</span></span></div>`).join('') + '</div>';
    }
    return { html };
  }

  function fmtServicios(r) {
    const top = (obj, k) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, k);
    let html = kpiRow([
      { l: 'Servicios', v: r.total },
      { l: 'Pendientes', v: r.pendientes.length, cls: r.pendientes.length ? 'cb-warn' : 'cb-ok' },
    ]);
    html += `<div class="cb-kv"><b>Situación:</b> ${top(r.situacion, 4).map(([k, v]) => `${esc(k)} ${v}`).join(' · ')}</div>`;
    html += `<div class="cb-kv"><b>Estado:</b> ${top(r.estado, 5).map(([k, v]) => `${esc(k)} ${v}`).join(' · ')}</div>`;
    if (r.pendientes.length) {
      html += '<div class="cb-rows">' + r.pendientes.slice(0, 8).map(s => `<div class="cb-r"><i data-lucide="layers"></i><span>${esc(s.cliente || '—')} · <span class="cb-dim">${esc(s.especialidad || '')}</span></span></div>`).join('') + '</div>';
    }
    return { html };
  }

  function fmtRankCon(arr) {
    if (!arr.length) return { html: 'Sin evaluaciones de contratistas registradas.' };
    const medal = ['🥇', '🥈', '🥉'];
    let html = `<div class="cb-title">Top contratistas</div><div class="cb-rows">`;
    html += arr.map((c, i) => `<div class="cb-r"><span class="cb-rank">${medal[i] || (i + 1)}</span><span>${esc(c.contratista)} · <span class="cb-ok">${(Number(c.puntaje_final) || 0).toFixed(1)}</span>${c.clasificacion ? ` <span class="cb-dim">(${esc(c.clasificacion)})</span>` : ''}</span></div>`).join('');
    html += '</div>';
    return { html };
  }

  function fmtRankSup(arr) {
    if (!arr.length) return { html: 'Sin evaluaciones de supervisores registradas.' };
    const medal = ['🥇', '🥈', '🥉'];
    let html = `<div class="cb-title">Ranking supervisores</div><div class="cb-rows">`;
    html += arr.map((s, i) => `<div class="cb-r"><span class="cb-rank">${medal[i] || (i + 1)}</span><span>${esc(s.supervisor_nombre)} · <span class="cb-ok">${(Number(s.promedio) || 0).toFixed(1)}</span>${s.cargo ? ` <span class="cb-dim">${esc(s.cargo)}</span>` : ''}</span></div>`).join('');
    html += '</div>';
    return { html };
  }

  function fmtPersonal(r) {
    const top = Object.entries(r.bySup).sort((a, b) => b[1] - a[1]).slice(0, 8);
    let html = kpiRow([{ l: 'Personal total', v: r.total }]);
    html += '<div class="cb-rows">' + top.map(([s, n]) => `<div class="cb-r"><i data-lucide="users"></i><span>${esc(s)} · <b>${n}</b></span></div>`).join('') + '</div>';
    return { html };
  }

  function suggestionChips(list) {
    return `<div class="cb-chips">${list.map(t => `<button class="cb-chip" data-q="${esc(t)}">${esc(t)}</button>`).join('')}</div>`;
  }

  // ─────────────────────────────────────────────────────────────
  // UI (responsive · premium light)
  // ─────────────────────────────────────────────────────────────
  function injectCss() {
    if (document.getElementById('cb-css')) return;
    const s = document.createElement('style');
    s.id = 'cb-css';
    s.textContent = `
      #cb-fab{position:fixed;right:22px;bottom:22px;z-index:99998;width:58px;height:58px;border-radius:50%;border:none;cursor:pointer;
        background:linear-gradient(135deg,#0f1e35 0%,#1c3a63 100%);color:#fff;box-shadow:0 10px 30px -8px rgba(15,30,53,.55);
        display:flex;align-items:center;justify-content:center;transition:transform .18s ease,box-shadow .18s ease}
      #cb-fab:hover{transform:translateY(-2px) scale(1.04);box-shadow:0 16px 40px -10px rgba(15,30,53,.6)}
      #cb-fab svg{width:26px;height:26px;stroke-width:2}
      #cb-fab .cb-dot{position:absolute;top:12px;right:13px;width:10px;height:10px;border-radius:50%;background:#3ECBB0;border:2px solid #fff}
      #cb-panel{position:fixed;right:22px;bottom:92px;z-index:99999;width:380px;max-width:calc(100vw - 28px);height:560px;max-height:calc(100vh - 120px);
        background:#fff;border-radius:18px;box-shadow:0 24px 64px -16px rgba(15,30,53,.4),0 2px 8px rgba(15,30,53,.1);
        border:1px solid rgba(15,30,53,.08);display:none;flex-direction:column;overflow:hidden;font-family:Manrope,system-ui,sans-serif}
      #cb-panel.cb-open{display:flex;animation:cb-up .22s cubic-bezier(.16,1,.3,1) both}
      @keyframes cb-up{from{opacity:0;transform:translateY(12px) scale(.98)}to{opacity:1;transform:none}}
      .cb-head{padding:14px 16px;background:linear-gradient(135deg,#0f1e35 0%,#1c3a63 100%);color:#fff;display:flex;align-items:center;gap:11px}
      .cb-head .cb-av{width:36px;height:36px;border-radius:50%;background:rgba(62,203,176,.22);display:flex;align-items:center;justify-content:center}
      .cb-head .cb-av svg{width:20px;height:20px;color:#5fe6cd}
      .cb-head h4{margin:0;font-size:15px;font-weight:800;letter-spacing:.2px}
      .cb-head p{margin:1px 0 0;font-size:11px;opacity:.7;font-weight:600}
      .cb-head .cb-x{margin-left:auto;background:rgba(255,255,255,.12);border:none;color:#fff;width:30px;height:30px;border-radius:9px;cursor:pointer;font-size:18px;line-height:1}
      .cb-head .cb-x:hover{background:rgba(255,255,255,.22)}
      .cb-body{flex:1;overflow-y:auto;padding:16px;background:#f7f9fc;display:flex;flex-direction:column;gap:12px}
      .cb-msg{display:flex;gap:9px;align-items:flex-start;max-width:100%}
      .cb-msg.cb-user{flex-direction:row-reverse}
      .cb-bub{padding:10px 13px;border-radius:14px;font-size:13.3px;line-height:1.5;color:#0f1e35;max-width:84%;word-wrap:break-word;overflow-wrap:anywhere}
      .cb-bot .cb-bub{background:#fff;border:1px solid rgba(15,30,53,.08);border-top-left-radius:4px;box-shadow:0 1px 2px rgba(15,30,53,.05)}
      .cb-user .cb-bub{background:linear-gradient(135deg,#0f1e35,#1c3a63);color:#fff;border-top-right-radius:4px}
      .cb-ico{width:28px;height:28px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:#e7f6f2}
      .cb-ico svg{width:16px;height:16px;color:#0ea5a4}
      .cb-foot{padding:11px 12px;border-top:1px solid rgba(15,30,53,.07);background:#fff;display:flex;gap:8px;align-items:center}
      .cb-foot input{flex:1;border:1px solid rgba(15,30,53,.14);border-radius:11px;padding:10px 13px;font-size:13.5px;outline:none;font-family:inherit;background:#f7f9fc}
      .cb-foot input:focus{border-color:#3ECBB0;background:#fff;box-shadow:0 0 0 3px rgba(62,203,176,.14)}
      .cb-foot button{width:40px;height:40px;border-radius:11px;border:none;cursor:pointer;background:linear-gradient(135deg,#0f1e35,#1c3a63);color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0}
      .cb-foot button:hover{opacity:.92}.cb-foot button svg{width:18px;height:18px}
      /* contenido de respuestas */
      .cb-kpis{display:flex;gap:8px;margin:2px 0 8px;flex-wrap:wrap}
      .cb-kpi{flex:1;min-width:62px;background:#f3f6fb;border:1px solid rgba(15,30,53,.06);border-radius:10px;padding:7px 8px;text-align:center}
      .cb-kpi-v{font-size:16px;font-weight:800;color:#0f1e35;line-height:1.1}
      .cb-kpi-l{font-size:9.5px;text-transform:uppercase;letter-spacing:.04em;color:#7689a3;font-weight:700;margin-top:2px}
      .cb-title{font-weight:800;font-size:13.5px;color:#0f1e35;margin:0 0 7px;display:flex;align-items:center;gap:7px}
      .cb-count{background:#0f1e35;color:#fff;border-radius:999px;font-size:10.5px;padding:1px 8px;font-weight:700}
      .cb-rows{display:flex;flex-direction:column;gap:5px;margin-top:5px}
      .cb-r{display:flex;align-items:center;gap:7px;font-size:12.5px;color:#26384f}
      .cb-r svg{width:13px;height:13px;color:#8aa0bb;flex-shrink:0}
      .cb-rank{width:20px;text-align:center;flex-shrink:0;font-size:12px}
      .cb-kv{font-size:12.6px;color:#26384f;margin:2px 0}
      .cb-line{font-size:12.8px;margin:4px 0;color:#26384f}
      .cb-hint{font-size:11.5px;color:#7689a3;margin-top:6px}
      .cb-dim{color:#7689a3}.cb-ok{color:#0e9f6e;font-weight:700}.cb-warn{color:#c2790a;font-weight:700}.cb-bad{color:#d8453c;font-weight:700}
      .cb-ul{margin:6px 0 0;padding-left:18px}.cb-ul li{margin:3px 0;font-size:12.8px}
      .cb-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}
      .cb-chip{border:1px solid rgba(15,30,53,.14);background:#fff;border-radius:999px;padding:5px 11px;font-size:11.5px;font-weight:600;color:#1c3a63;cursor:pointer;font-family:inherit}
      .cb-chip:hover{background:#0f1e35;color:#fff;border-color:#0f1e35}
      .cb-typing{display:flex;gap:4px;padding:4px 2px}
      .cb-typing span{width:7px;height:7px;border-radius:50%;background:#b7c4d6;animation:cb-bounce 1.2s infinite}
      .cb-typing span:nth-child(2){animation-delay:.15s}.cb-typing span:nth-child(3){animation-delay:.3s}
      @keyframes cb-bounce{0%,60%,100%{transform:translateY(0);opacity:.5}30%{transform:translateY(-5px);opacity:1}}
      /* Móvil: hoja casi completa */
      @media (max-width:640px){
        #cb-panel{right:0;left:0;bottom:0;width:100%;max-width:100%;height:86vh;max-height:86vh;border-radius:18px 18px 0 0}
        #cb-fab{right:16px;bottom:16px}
      }
    `;
    document.head.appendChild(s);
  }

  let panel, body, input, opened = false;

  function build() {
    injectCss();
    const fab = document.createElement('button');
    fab.id = 'cb-fab';
    fab.setAttribute('aria-label', BRAND.title);
    fab.innerHTML = `<i data-lucide="message-circle"></i><span class="cb-dot"></span>`;
    fab.addEventListener('click', toggle);
    document.body.appendChild(fab);

    panel = document.createElement('div');
    panel.id = 'cb-panel';
    panel.innerHTML = `
      <div class="cb-head">
        <div class="cb-av"><i data-lucide="sparkles"></i></div>
        <div><h4>${esc(BRAND.title)}</h4><p>${esc(BRAND.subtitle)}</p></div>
        <button class="cb-x" aria-label="Cerrar">×</button>
      </div>
      <div class="cb-body" id="cb-body"></div>
      <div class="cb-foot">
        <input id="cb-input" type="text" placeholder="Pregunta sobre tus proyectos…" autocomplete="off">
        <button id="cb-send" aria-label="Enviar"><i data-lucide="send"></i></button>
      </div>`;
    document.body.appendChild(panel);

    body = panel.querySelector('#cb-body');
    input = panel.querySelector('#cb-input');
    panel.querySelector('.cb-x').addEventListener('click', toggle);
    panel.querySelector('#cb-send').addEventListener('click', send);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    body.addEventListener('click', (e) => {
      const chip = e.target.closest('.cb-chip');
      if (chip) { input.value = chip.dataset.q; send(); }
    });

    if (window.lucide) lucide.createIcons();

    // requireToken: mostrar el FAB solo cuando hay sesión (login),
    // ocultarlo y cerrar el panel al cerrar sesión. Sin tocar la app.
    if (CFG.requireToken) {
      const sync = () => {
        const ok = !!storedToken();
        fab.style.display = ok ? 'flex' : 'none';
        if (!ok && opened) toggle();
      };
      sync();
      setInterval(sync, 1500);
    }
  }

  function toggle() {
    opened = !opened;
    panel.classList.toggle('cb-open', opened);
    const dot = document.querySelector('#cb-fab .cb-dot');
    if (opened) {
      if (dot) dot.style.display = 'none';
      if (!body.dataset.greeted) { greet(); body.dataset.greeted = '1'; }
      setTimeout(() => input && input.focus(), 250);
    }
  }

  function greet() {
    addBot({ html: `${BRAND.greet}${suggestionChips(defaultChips())}` });
  }

  function scrollDown() { body.scrollTop = body.scrollHeight; }

  function addUser(text) {
    const el = document.createElement('div');
    el.className = 'cb-msg cb-user';
    el.innerHTML = `<div class="cb-bub">${esc(text)}</div>`;
    body.appendChild(el); scrollDown();
  }

  function addBot(res) {
    const el = document.createElement('div');
    el.className = 'cb-msg cb-bot';
    el.innerHTML = `<div class="cb-ico"><i data-lucide="sparkles"></i></div><div class="cb-bub">${res.html}</div>`;
    body.appendChild(el);
    if (window.lucide) lucide.createIcons();
    scrollDown();
  }

  function addTyping() {
    const el = document.createElement('div');
    el.className = 'cb-msg cb-bot cb-typing-wrap';
    el.innerHTML = `<div class="cb-ico"><i data-lucide="sparkles"></i></div><div class="cb-bub"><div class="cb-typing"><span></span><span></span><span></span></div></div>`;
    body.appendChild(el);
    if (window.lucide) lucide.createIcons();
    scrollDown();
    return el;
  }

  async function send() {
    const text = (input.value || '').trim();
    if (!text) return;
    input.value = '';
    addUser(text);
    const typing = addTyping();
    try {
      const res = await answer(text);
      typing.remove();
      addBot(res);
    } catch (e) {
      typing.remove();
      addBot({ html: `<span class="cb-bad">No pude obtener los datos.</span> ${esc(String(e.message || e)).slice(0, 120)}` });
      console.error('[chatbot]', e);
    }
  }

  // ── API pública (B-ready): expone tools y un hook para responder ──
  const API = {
    tools,          // funciones de datos (function-calls para Opción B)
    answer,         // cerebro actual (se reemplaza por LLM en B)
    caps: CAPS,     // capacidades activas en esta instancia
    open: () => { if (!opened) toggle(); },
    refresh: () => { Object.keys(cache.ts).forEach(k => cache.ts[k] = 0); }, // invalida cache
  };
  window.PMOChat = API;   // compat
  window.FPChat = API;    // nombre genérico multi-app

  // ── Boot ──
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
