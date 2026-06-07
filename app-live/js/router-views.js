/* ════════════════════════════════════════════════════════════════════
   router-views.js — Router de vistas con iframe-bridge al legacy
   - "inicio" muestra #view-home (KPIs + paneles)
   - Cualquier otro hash carga index.legacy.html y llama showView() adentro
   - Oculta el chrome del legacy via CSS injection en el iframe
   Dependencias: ninguna (autónomo)
   ════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const HOME_KEY = 'inicio';
  const LEGACY_URL = 'index.legacy.html';

  // ── Alias de hash → nombre de vista real en el legacy ──
  // (el legacy tiene algunas vistas con renderers rotos o con nombres distintos)
  const HASH_ALIAS = {
    'proyectos': 'datos',   // #proyectos del chip apunta a #datos (donde sí se renderiza la lista)
    'clientes':  'datos',
    'hitos':     'briefing',
    'lecciones': 'briefing',
  };

  const homeEl  = document.getElementById('view-home');
  const vistaEl = document.getElementById('view-vista');
  const iframe  = document.getElementById('vista-frame');

  // ── Vistas nativas (no usan el iframe legacy) ──
  // key de hash → { el: contenedor, init: fn que renderiza (idempotente) }
  const NATIVE_VIEWS = {
    servicios: {
      el: document.getElementById('view-servicios'),
      init: () => { if (typeof window.loadServicios === 'function') window.loadServicios(); },
    },
    // Mapa de Operaciones FrioPacking (Leaflet + clustering)
    mapa: {
      el: document.getElementById('view-globe'),
      init:   () => { if (window.FrioGlobe) window.FrioGlobe.enter(); },
      deinit: () => { if (window.FrioGlobe) window.FrioGlobe.leave(); },
    },
  };

  let iframeReady = false;
  let pendingView = null;

  // ── CSS que se inyecta dentro del iframe para ocultar todo el chrome del legacy ──
  // Por defecto oculta TODO el chrome global. Excepción: en Dashboard Gerencial
  // mantenemos los KPIs globales (Facturado, Avance real, SPI Cartera, etc.).
  const HIDE_CHROME_CSS = `
    /* ─── Chrome básico (siempre oculto) ─── */
    header.app, nav.tabs,
    .timemachine, .date-pills,
    .ai-fab, #toast-container, .banner, .head-actions, .cmd-bar,
    /* Anomaly / alert banners globales */
    .anomaly-banner, #anomaly-banner,
    /* Pill bar proactivo (Sin reporte / Valorización / CF Vencidas / Sala) */
    #pmo-action-bar, .pmo-pill, .pmo-pill-dropdown,
    #pmo-bar-ops-btn, #pmo-bell-btn,
    .pmo-sticky-top, .pmo-top-bar { display: none !important; }

    /* ─── KPIs globales y semáforo: ocultos en TODAS las vistas EXCEPTO gerencial ─── */
    /* Usamos :not() para no tocar el display en gerencial — así conserva su layout original */
    body:not([data-pmo-view="gerencial"]) .kpis,
    body:not([data-pmo-view="gerencial"]) #kpis,
    body:not([data-pmo-view="gerencial"]) .semaforo,
    body:not([data-pmo-view="gerencial"]) #semaforo,
    body:not([data-pmo-view="gerencial"]) #semaforo-card,
    body:not([data-pmo-view="gerencial"]) .v15-kpi-wrap,
    body:not([data-pmo-view="gerencial"]) .v15-sem-wrap { display: none !important; }

    body { padding-top: 0 !important; margin: 0 !important; }
    body > *:first-child:not(script) { margin-top: 0 !important; }
    /* Asegurar que el contenedor de vistas use todo el espacio */
    #views { padding: 16px 20px !important; }

    /* ─── Proyectos (v-datos): el legacy colapsa .layout a 1 columna por debajo de
       1080px, pero embebido el iframe mide ~974px, así que los filtros se apilan a
       todo el ancho y empujan las tarjetas hacia abajo (espacio perdido). Forzamos
       el layout de escritorio: filtros estrechos a la izquierda + grid de tarjetas
       en 2 columnas llenando la derecha. Solo cuando hay ancho suficiente (≥820px). ─── */
    /* Filtros reubicados: barra horizontal compacta y sticky arriba en vez de
       columna lateral de 200×810px. Libera todo el ancho para las tarjetas. */
    #v-datos .layout { display: block !important; }
    #v-datos #filters.sidebar {
      width: auto !important; max-height: none !important; position: sticky !important; top: 0 !important; z-index: 6 !important;
      display: flex !important; flex-wrap: wrap !important; align-items: flex-start !important; gap: 10px 20px !important;
      padding: 11px 14px !important; margin: 0 0 14px !important;
      background: linear-gradient(180deg, #fff 0%, #fcfdfe 100%) !important;
      border: 1px solid rgba(15, 23, 42, .08) !important; border-radius: 12px !important;
      box-shadow: 0 1px 2px rgba(15, 23, 42, .05) !important;
    }
    /* Buscador: primer hijo, ancho cómodo */
    #v-datos #filters #f-q { width: 200px !important; height: 32px !important; margin: 0 !important; }
    /* Cada grupo: ancho uniforme → se alinean en columnas (grid). La etiqueta (h3)
       ocupa toda la fila y es plegable; las opciones se muestran como chips debajo. */
    #v-datos #filters .filter-group { display: flex !important; flex-wrap: wrap !important; align-content: flex-start !important; gap: 5px !important; margin: 0 !important; flex: 0 1 188px !important; max-width: 240px !important; }
    #v-datos #filters .filter-group h3 {
      flex: 0 0 100% !important; width: 100% !important; box-sizing: border-box !important;
      font-size: 9.5px !important; letter-spacing: .06em !important; text-transform: uppercase !important;
      color: #64748b !important; font-weight: 700 !important; margin: 0 0 3px !important; padding: 0 0 3px !important;
      display: flex !important; align-items: center !important; gap: 5px !important;
      cursor: pointer !important; user-select: none !important;
      border-bottom: 1px solid rgba(15, 23, 42, .07) !important;
    }
    /* Flecha de plegado al final de la cabecera */
    #v-datos #filters .filter-group h3::after {
      content: '▾' !important; margin-left: auto !important; font-size: 9px !important; color: #94a3b8 !important;
      transition: transform .15s ease !important;
    }
    #v-datos #filters .filter-group.fp-gcol h3::after { transform: rotate(-90deg) !important; }
    #v-datos #filters .filter-group h3:hover { color: #2266b0 !important; }
    /* Grupo plegado: ocultar sus opciones (chips directos o dentro de un <div>) */
    #v-datos #filters .filter-group.fp-gcol .item,
    #v-datos #filters .filter-group.fp-gcol > div { display: none !important; }
    /* Grupo Supervisor: sus items están dentro de un <div> con scroll → fila que envuelve */
    #v-datos #filters .filter-group > div { flex: 0 0 100% !important; width: 100% !important; max-height: 96px !important; overflow-y: auto !important; display: flex !important; flex-wrap: wrap !important; align-content: flex-start !important; gap: 5px !important; padding: 0 !important; }
    /* Opciones como chips */
    #v-datos #filters .item {
      display: inline-flex !important; align-items: center !important; gap: 5px !important;
      padding: 4px 9px !important; margin: 0 !important; font-size: 11px !important; line-height: 1.1 !important;
      border: 1px solid rgba(15, 23, 42, .12) !important; border-radius: 999px !important; cursor: pointer !important; white-space: nowrap !important;
    }
    #v-datos #filters .item:hover { background: rgba(15, 23, 42, .04) !important; }
    #v-datos #filters .item input[type="checkbox"] { width: 12px !important; height: 12px !important; margin: 0 !important; flex-shrink: 0 !important; }
    #v-datos #filters .item .count { color: #94a3b8 !important; font-size: 10px !important; font-weight: 600 !important; }
    /* Botón limpiar, compacto, alineado al centro de la barra */
    #v-datos #filters .btn { align-self: center !important; height: 30px !important; padding: 0 12px !important; margin: 0 !important; white-space: nowrap !important; }
    /* Tarjetas a todo el ancho */
    #v-datos .proj-grid { grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)) !important; }

    /* Botón toggle "Filtros" (inyectado) */
    #v-datos #filters #fp-filter-toggle {
      align-self: center !important; order: -1 !important; height: 32px !important; padding: 0 14px !important;
      border-radius: 8px !important; border: 1px solid rgba(46, 125, 209, .30) !important; background: rgba(46, 125, 209, .08) !important;
      color: #2266b0 !important; font-weight: 700 !important; font-size: 12px !important; cursor: pointer !important; white-space: nowrap !important;
      display: inline-flex !important; align-items: center !important; gap: 6px !important;
    }
    #v-datos #filters #fp-filter-toggle:hover { background: rgba(46, 125, 209, .14) !important; }
    /* Estado colapsado: solo el buscador + el botón; el resto oculto → barra de una sola línea */
    #v-datos.fp-fcol #filters .filter-group:not(:has(#f-q)) { display: none !important; }
    #v-datos.fp-fcol #filters .btn { display: none !important; }

    /* ─── Proyectos: rediseño ejecutivo de tarjetas (estilo Stripe / Linear /
       Airtable). Regla 80% neutro · 15% color corporativo · 5% alerta. El legacy
       satura cada tarjeta con 7+ señales de color (pills, anillo, barra, SPI,
       insight, días, botones) → sensación de urgencia constante. Aquí dejamos UN
       solo elemento dominante con color por tarjeta: el ANILLO DE SCORE. Todo lo
       demás es neutro. El rojo aparece únicamente en severidad real. ─── */
    /* Contenedor: blanco limpio, sin borde ni acento de color, sin glow */
    /* ── v4 equilibrado: 70% blanco · 20% azul corporativo · 10% color de estado ── */
    #v-datos .proj.spc {
      padding: 13px 14px 12px !important;
      border-radius: 14px !important;
      backdrop-filter: none !important;
      background: linear-gradient(180deg, #ffffff 0%, #fcfdfe 100%) !important;
      border: 1px solid rgba(15, 23, 42, .07) !important;
      box-shadow: 0 1px 2px rgba(15, 23, 42, .05), 0 4px 14px -8px rgba(15, 23, 42, .10) !important;
      gap: 9px !important;
      transition: transform .2s ease, box-shadow .2s ease, border-color .2s ease !important;
    }
    #v-datos .proj.spc::after { display: none !important; }   /* sin barra lateral de color */
    #v-datos .proj.spc::before { display: none !important; }  /* sin glow de hover */
    /* Microinteracción de hover: elevación discreta, sin rebote ni pulso */
    #v-datos .proj.spc:hover {
      transform: translateY(-3px) !important;
      box-shadow: 0 2px 4px rgba(15, 23, 42, .06), 0 14px 32px -12px rgba(15, 23, 42, .22) !important;
      border-color: rgba(46, 125, 209, .22) !important;
    }
    /* Anular pulsaciones / parpadeos / rebotes del legacy en las tarjetas */
    #v-datos .proj.spc, #v-datos .proj.spc * { animation: none !important; }

    /* ── Score: recuperado como elemento clave, minimalista ── */
    #v-datos .spc-score { display: flex !important; flex-direction: column !important; align-items: center !important; gap: 1px !important; }
    #v-datos .spc-score .ring-lbl { font-size: 8.5px !important; letter-spacing: .04em !important; text-transform: uppercase !important; color: #94a3b8 !important; font-weight: 700 !important; }
    #v-datos .spc-score svg { width: 40px !important; height: 40px !important; }
    #v-datos .spc-score .ring-bg { stroke: rgba(15, 23, 42, .07) !important; stroke-width: 3.5 !important; }
    #v-datos .spc-score .ring-fg { stroke: #2E7DD1 !important; stroke-width: 3.5 !important; }   /* anillo azul corporativo */
    #v-datos .proj.spc.alert .spc-score .ring-fg,
    #v-datos .proj.spc.critical .spc-score .ring-fg { stroke: #e2685f !important; }   /* rojo SOLO en crítico real */
    #v-datos .spc-score .ring-val { font-size: 13px !important; font-weight: 800 !important; color: #0f1e35 !important; }

    /* Título + chip de estado elegante con fondo suave (sin burbuja de prioridad P1/P2) */
    #v-datos .spc-id h4 { font-size: 15px !important; color: #0f1e35 !important; }
    #v-datos .spc-pill { background: rgba(15, 23, 42, .05) !important; color: #475569 !important; border: 1px solid transparent !important; font-weight: 600 !important; }
    #v-datos .spc-pill.state-ok { background: rgba(34, 161, 122, .10) !important; color: #1a7d5e !important; }
    #v-datos .spc-pill.state-info { background: rgba(46, 125, 209, .10) !important; color: #2266b0 !important; }
    #v-datos .spc-pill.state-warn { background: rgba(214, 158, 46, .12) !important; color: #a9761b !important; }
    #v-datos .spc-pill.state-alert { background: rgba(226, 104, 95, .12) !important; color: #c0453b !important; }
    #v-datos .spc-pill[class*="prio-"] { display: none !important; }   /* fuera la burbuja P1/P2 */
    #v-datos .spc-pills > :nth-child(n+3) { display: none !important; }

    /* Barra de progreso fina · avance en color corporativo */
    #v-datos .spc-track, #v-datos .spc-plan-bar, #v-datos .spc-real-bar { height: 5px !important; border-radius: 4px !important; }
    #v-datos .spc-track { background: rgba(15, 23, 42, .06) !important; }
    #v-datos .spc-plan-bar { background: rgba(46, 125, 209, .14) !important; }
    #v-datos .spc-real-bar { background: #2E7DD1 !important; transition: width .6s cubic-bezier(.4, 0, .2, 1) !important; }
    #v-datos .proj.spc.alert .spc-real-bar,
    #v-datos .proj.spc.critical .spc-real-bar { background: #e2685f !important; }   /* rojo SOLO en crítico */
    #v-datos .spc-plan-tick { height: 9px !important; background: #94a3b8 !important; }
    #v-datos .spc-gap, #v-datos .spc-gap.neg { color: #64748b !important; }

    /* KPIs neutros (sin rojo/ámbar/verde redundante) */
    #v-datos .spc-kpis { gap: 8px !important; padding: 9px 0 1px !important; }
    #v-datos .spc-kpi-v,
    #v-datos .spc-kpi.spi-bad .spc-kpi-v,
    #v-datos .spc-kpi.spi-warn .spc-kpi-v,
    #v-datos .spc-kpi.spi-good .spc-kpi-v { color: #0f1e35 !important; font-size: 13px !important; }

    /* Insight eliminado: repetía info ya presente (días vencido / gap vs plan) */
    #v-datos .spc-insight { display: none !important; }

    /* Footer neutro */
    #v-datos .spc-foot .days, #v-datos .spc-foot .loc { color: #64748b !important; }

    /* Botones uniformes (ghost), sin multicolor */
    #v-datos .pmo-card-btn { padding: 5px 8px !important; font-size: 10.5px !important; background: #fff !important; color: #475569 !important; border: 1px solid rgba(15, 23, 42, .12) !important; font-weight: 600 !important; }
    #v-datos .pmo-card-btn:hover { background: rgba(15, 23, 42, .04) !important; opacity: 1 !important; }

    /* ── Detalle de proyecto (pestaña Ejecutivo): eliminar datos duplicados ── */
    /* SPI ya está grande en el hero → ocultar el tile KPI "⚡ SPI" repetido */
    .exc-kpis .exc-kpi:nth-child(4) { display: none !important; }
    /* Brecha ya está en el grid KPI → ocultar "Brecha actual" repetida al pie de la curva */
    .exc-curve-foot .exc-curve-stat:nth-child(1) { display: none !important; }
    /* La brecha vive en su tile → ocultar el sub "X pts vs plan" del tile Avance Real */
    .exc-kpis .exc-kpi:nth-child(1) .exc-kpi-sub { display: none !important; }

    /* ── Banner de alertas superior eliminado a pedido ── */
    #v15-alerts-panel { display: none !important; }

    /* ── Sparklines ("montes") dentro de cada tile KPI eliminados: ruido visual que
       no aporta lectura (a pedido). Solo se mantiene el valor del indicador. ── */
    .exc-kpi-spark { display: none !important; }
  `;

  // ── Inyectar CSS dentro del iframe cuando carga ──
  function injectChromeHide() {
    try {
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      if (!doc) return;
      if (doc.getElementById('__embed_hide_chrome')) return;
      const style = doc.createElement('style');
      style.id = '__embed_hide_chrome';
      style.textContent = HIDE_CHROME_CSS;
      doc.head.appendChild(style);
    } catch (e) {
      console.warn('[router-views] no se pudo inyectar CSS al iframe:', e);
    }
  }

  // ── Cargar el legacy en el iframe (lazy, primera vez que se navega a una vista) ──
  function ensureIframeLoaded(thenShow) {
    if (iframeReady) { thenShow(); return; }
    pendingView = thenShow;
    if (iframe.src === 'about:blank' || !iframe.src.includes('index.legacy.html')) {
      iframe.src = LEGACY_URL;
    }
  }

  // ── Filtros colapsables (Proyectos): por defecto la barra muestra solo el
  //    buscador + un botón "Filtros". Al hacer click se despliegan los grupos.
  //    El legacy reconstruye #filters.innerHTML en cada renderDatos(), así que
  //    re-inyectamos el botón vía MutationObserver. El estado (clase fp-fcol)
  //    vive en #v-datos, que persiste entre refrescos. ──
  function setupFilterToggle(doc) {
    try {
      const vd = doc.getElementById('v-datos');
      const filters = doc.getElementById('filters');
      if (!vd || !filters) return;
      // Colapsado por defecto (una sola vez, para no revertir si el usuario lo abrió)
      if (!vd.hasAttribute('data-fp-finit')) {
        vd.classList.add('fp-fcol');
        vd.setAttribute('data-fp-finit', '1');
      }
      // (Re)inyectar el botón si falta (renderDatos lo borra al rehacer el innerHTML)
      if (!filters.querySelector('#fp-filter-toggle')) {
        const btn = doc.createElement('button');
        btn.id = 'fp-filter-toggle';
        btn.type = 'button';
        const sync = () => {
          const collapsed = vd.classList.contains('fp-fcol');
          btn.textContent = collapsed ? '☰ Filtros' : '☰ Ocultar';
        };
        btn.addEventListener('click', () => { vd.classList.toggle('fp-fcol'); sync(); });
        sync();
        filters.insertBefore(btn, filters.firstChild);
      }
      // Plegado por grupo: cada cabecera (h3) alterna fp-gcol en su .filter-group.
      // El estado se guarda en vd.__fpFolds (nodo persistente) para sobrevivir a los
      // rebuilds de renderDatos(). El grupo "Supervisor" arranca plegado por defecto.
      if (!vd.__fpFolds) vd.__fpFolds = {};
      filters.querySelectorAll('.filter-group').forEach((g) => {
        if (g.querySelector('#f-q')) return;            // no plegar el buscador
        const h3 = g.querySelector('h3');
        if (!h3) return;
        const key = (h3.textContent || '').toLowerCase().replace(/[^a-záéíóúñ]/g, '');
        if (!key) return;
        if (!(key in vd.__fpFolds)) vd.__fpFolds[key] = key.includes('supervisor');
        g.classList.toggle('fp-gcol', !!vd.__fpFolds[key]);
        if (h3.__fpFold) return;
        h3.__fpFold = true;
        h3.addEventListener('click', () => {
          vd.__fpFolds[key] = !vd.__fpFolds[key];
          g.classList.toggle('fp-gcol', !!vd.__fpFolds[key]);
        });
      });
    } catch (e) { /* no-op */ }
  }

  function observeFilters(doc) {
    try {
      const filters = doc.getElementById('filters');
      if (!filters || filters.__fpObserved) return;
      filters.__fpObserved = true;
      const obs = new MutationObserver(() => setupFilterToggle(doc));
      obs.observe(filters, { childList: true });
    } catch (e) { /* no-op */ }
  }

  // ── Fix de datos: pestaña Operaciones · "Últimos reportes" ──
  // El legacy (renderOps) lee el avance real de cada reporte como r.valp || r.real,
  // pero esos campos NO existen en los objetos de store.reportes (el avance vive en
  // r.av / r.avance). Resultado: cada reporte mostraba "0.0% real · plan X%".
  // renderOps NO es global (vive en el scope del módulo legacy), pero renderModalView
  // SÍ lo es y es el dispatcher que pinta cada pestaña. Sin tocar el legacy: envolvemos
  // renderModalView y, cuando la pestaña activa es 'ops', reescribimos el texto (y el
  // color de severidad) de cada item con el avance correcto. Reusamos la MISMA fuente
  // de datos y orden que el legacy (store.reportes[curProject.name], últimos 8).
  function patchOpsReportReal(win) {
    if (!win || win.__fpOpsPatched) return false;
    if (typeof win.renderModalView !== 'function') return false;
    const orig = win.renderModalView;
    win.renderModalView = function () {
      const r = orig.apply(this, arguments);
      try {
        if (win.curMV === 'ops') {
          const doc = win.document;
          const p = win.curProject;
          const reps = (win.store && win.store.reportes && p && win.store.reportes[p.name]) || [];
          const ordered = reps.slice(-8).reverse();
          const items = doc.querySelectorAll('#mv-ops .exc-tl-item');
          items.forEach((it, i) => {
            const rep = ordered[i];
            if (!rep) return;
            const v = Number(rep.av != null ? rep.av : (rep.avance != null ? rep.avance : (rep.valp || rep.real || 0)));
            const pl = Number(rep.plan || 0);
            const t = it.querySelector('.tl-title');
            if (t) t.textContent = `${v.toFixed(1)}% real · plan ${pl.toFixed(1)}%`;
            // Recalcular color de severidad (estaba calculado con real=0 → siempre "warn")
            it.classList.remove('warn', 'ok', 'info');
            it.classList.add(pl - v > 5 ? 'warn' : v - pl > 3 ? 'ok' : 'info');
          });
        }
      } catch (e) { /* no-op */ }
      return r;
    };
    win.__fpOpsPatched = true;
    return true;
  }

  iframe.addEventListener('load', () => {
    iframeReady = true;
    injectChromeHide();
    disableLegacyAutoNav();
    try {
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      setupFilterToggle(doc);
      observeFilters(doc);
      // Parchear renderOps (puede no estar listo aún → reintento breve)
      const win = iframe.contentWindow;
      if (!patchOpsReportReal(win)) {
        let n = 0;
        const t = setInterval(() => {
          if (patchOpsReportReal(win) || ++n > 40) clearInterval(t);
        }, 150);
      }
    } catch (e) { /* no-op */ }
    if (pendingView) {
      const fn = pendingView;
      pendingView = null;
      // Pequeño delay para que el legacy termine de inicializar su JS
      setTimeout(fn, 200);
    }
  });

  // ── Neutralizar los pop-ups proactivos del legacy que pueden cambiar de vista ──
  // El legacy tiene un sistema "ProactiveAI" que cada 8 minutos analiza datos y
  // muestra notificaciones con botones "Ver valorización" etc. Si el usuario hace
  // click sin querer, la vista cambia. Lo desactivamos: el nuevo shell ya tiene
  // sus propias alertas de cumplimiento en Home.
  function disableLegacyAutoNav() {
    const win = iframe.contentWindow;
    if (!win) return;
    // Reintentar varias veces hasta que ProactiveAI exista (el legacy lo crea con delay)
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      try {
        if (win.ProactiveAI) {
          win.ProactiveAI.analyze = function () {};
          win.ProactiveAI._show = function () {};
          clearInterval(t);
        }
      } catch (e) { /* same-origin OK */ }
      if (tries > 20) clearInterval(t); // 10s max
    }, 500);
  }

  // ── Vistas que tienen versión "Premium" cargada con delay (setTimeout 2.5s+) ──
  // Para estas, esperamos a que el override premium esté registrado antes de re-renderizar
  const PREMIUM_FN = {
    valorizacion:  'renderValorizacionPremium',
    equipos:       'renderEquiposPremium',
    supervisores:  'renderSupervisoresPremium',
    contratistas:  'renderContratistasEvalPremium',
    reportes:      'renderReportesCOC',
    briefing:      'renderBriefingPremium',
    pendientes:    'renderPendientesPremium',
  };

  // ── Cambiar a una vista específica ──
  function gotoLegacyView(name) {
    try {
      const win = iframe.contentWindow;
      const doc = iframe.contentDocument || (win && win.document);
      // Marcar la vista actual en el body del iframe para CSS condicional
      if (doc && doc.body) doc.body.dataset.pmoView = name;

      if (win && typeof win.showView === 'function') {
        win.showView(name);
        // Si la vista tiene versión Premium con carga diferida, esperar y re-renderizar
        if (PREMIUM_FN[name]) waitForPremiumAndRecall(name);
      } else {
        win.location.hash = '#' + name;
      }
    } catch (e) {
      console.warn('[router-views] gotoLegacyView falló:', e);
    }
  }

  // ── Polling: espera a que el override premium esté registrado, luego re-renderiza ──
  // Resuelve el problema de "tengo que refrescar para ver la versión nueva".
  // Caso real: Valorización registra su versión Premium con un setTimeout que puede
  // tardar bastante (depende de la carga de datos de Supabase). Si el usuario entra
  // antes, se ve la versión base ("Inteligencia Financiera") y no se reemplazaba
  // porque la ventana de espera era muy corta. Ampliamos la ventana y, mientras siga
  // activa la vista, re-renderizamos en cuanto el Premium quede registrado.
  let _premiumPoll = null;
  function waitForPremiumAndRecall(name) {
    const win = iframe.contentWindow;
    if (!win) return;
    const expectedFnName = PREMIUM_FN[name];
    if (!expectedFnName) return;

    // Cancelar cualquier sondeo previo (navegación rápida entre vistas)
    if (_premiumPoll) { clearInterval(_premiumPoll); _premiumPoll = null; }

    // ¿El usuario sigue en esta vista? (si navegó a otra, no forzamos re-render)
    const stillActive = () => {
      const h = (location.hash || '').slice(1) || HOME_KEY;
      return (HASH_ALIAS[h] || h) === name;
    };

    let tries = 0;
    const maxTries = 75; // 15 segundos max (200ms * 75) — cubre cargas lentas
    _premiumPoll = setInterval(() => {
      tries++;
      try {
        const premiumFn = win[expectedFnName];
        const registered = win.VIEW_RENDERERS && win.VIEW_RENDERERS[name];
        // Lista para re-renderizar: la función premium existe Y es la registrada
        if (premiumFn && registered === premiumFn) {
          clearInterval(_premiumPoll); _premiumPoll = null;
          if (stillActive()) { try { win.showView(name); } catch (e) { /* noop */ } }
          return;
        }
      } catch (e) { /* same-origin OK */ }
      if (tries >= maxTries || !stillActive()) { clearInterval(_premiumPoll); _premiumPoll = null; }
    }, 200);
  }

  // ── Actualizar estado activo en sidebar y tabs ──
  function updateActive(name) {
    document.querySelectorAll('.nav-item, .tab-item').forEach(el => {
      const dataSection = el.dataset.section;
      const href = (el.getAttribute('href') || '').replace('#', '');
      const matches = dataSection === name || href === name;
      el.classList.toggle('active', matches);
    });
  }

  // ── Ocultar todas las vistas nativas registradas ──
  function hideNativeViews() {
    Object.values(NATIVE_VIEWS).forEach((v) => {
      if (v.el) v.el.style.display = 'none';
      if (typeof v.deinit === 'function') { try { v.deinit(); } catch (e) { /* no-op */ } }
    });
  }

  // ── API principal ──
  function showView(name) {
    name = (name || '').trim();
    if (!name) name = HOME_KEY;

    // Vista HOME: mostrar contenido nativo, ocultar iframe
    if (name === HOME_KEY) {
      homeEl.style.display  = '';
      vistaEl.style.display = 'none';
      hideNativeViews();
      updateActive(HOME_KEY);
      return;
    }

    // Vistas nativas (ej. "servicios"): contenido propio, sin iframe legacy
    if (NATIVE_VIEWS[name]) {
      homeEl.style.display  = 'none';
      vistaEl.style.display = 'none';
      hideNativeViews();
      const v = NATIVE_VIEWS[name];
      if (v.el) v.el.style.display = '';
      updateActive(name);
      try { v.init(); } catch (e) { console.warn('[router-views] native view init falló:', e); }
      return;
    }

    // Resolver alias (ej. "proyectos" → "datos")
    const legacyView = HASH_ALIAS[name] || name;

    // Cualquier otra vista: mostrar iframe, ocultar home
    homeEl.style.display  = 'none';
    vistaEl.style.display = '';
    hideNativeViews();
    updateActive(name);
    ensureIframeLoaded(() => gotoLegacyView(legacyView));
  }

  window.showView = showView;

  // ── Interceptar clicks en elementos navegables ──
  function interceptClicks() {
    const selectors = '.sidebar .nav-item, .tabbar .tab-item, .panel .chip, .panel .action-card, .kpi-card';
    document.querySelectorAll(selectors).forEach(el => {
      el.addEventListener('click', (e) => {
        const href = el.getAttribute('href') || '';
        if (href.startsWith('#') && href.length > 1) {
          e.preventDefault();
          const name = href.slice(1);
          if (location.hash !== '#' + name) {
            location.hash = '#' + name;
            // hashchange disparará showView
          } else {
            showView(name);
          }
        }
      });
    });
  }

  // ── Listener de hashchange ──
  window.addEventListener('hashchange', () => {
    const h = (location.hash || '').slice(1);
    showView(h || HOME_KEY);
  });

  // ── Boot ──
  interceptClicks();
  const initialHash = (location.hash || '').slice(1);
  if (initialHash && initialHash !== HOME_KEY) {
    showView(initialHash);
  } else {
    updateActive(HOME_KEY);
  }
})();
