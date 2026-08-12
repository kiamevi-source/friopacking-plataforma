/* ════════════════════════════════════════════════════════════════════
   globe.js — Mapa de Operaciones FrioPacking
   Mapa corporativo estilo Google Maps / Waze / ArcGIS (Leaflet + clustering).
   - Mapa real con calles, avenidas y carreteras (CARTO Voyager + satélite Esri).
   - Revelado progresivo por zoom (clustering inteligente, sin líneas/ruido):
       · Nivel país  → clusters por región (totales en hover).
       · Nivel depto → círculos agrupados (n° obras · avance · cartera).
       · Nivel ciudad→ marcadores individuales (etiqueta sólo en hover).
       · Zoom máximo → calles reales (look Waze / Google Maps).
   - Clic en cluster → zoom + expansión animada. Clic en obra → panel ejecutivo.
   - DATOS REALES: 32 proyectos FrioPacking en Perú.
   Dependencias: leaflet, leaflet.markercluster (UMD global `L`)
   API pública: window.FrioMap.mount() / .setActive(bool)
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── Paleta por estado de obra ──
  const C = {
    teal:  '#3ECBB0',  // En plan
    blue:  '#4F8DF5',  // Adelantado
    amber: '#F2B544',  // Leve atraso
    red:   '#E24B4A',  // Atrasado
    gray:  '#7E8BA3',  // En pausa
  };

  // ── Cartera de proyectos: se llena EN VIVO desde Supabase (ver loadData) ──
  // Antes era una foto estática de junio. Ahora el array arranca vacío y se
  // muta con los proyectos "En progreso" reales + su avance del último reporte.
  // IMPORTANTE: mutar (push), NO reasignar, para no romper window.FrioMap.data.
  const PROJECTS = [];

  // Normalización de tipo de obra (categoria en Supabase)
  const TIPO_FIX = {
    'Refrigeracion':'Refrigeración','Refrigeración':'Refrigeración',
    'Civil':'Civil','Mecanica':'Mecánica','Mecánica':'Mecánica','Packing':'Packing',
  };
  // Color/estado de salud derivado del SPI (los activos son todos "En progreso"
  // en Supabase, así que el semáforo del mapa sale del ritmo, no del estado DB).
  function healthEstado(spi) {
    const s = parseFloat(spi) || 1;
    if (s >= 1.05) return 'ADELANTADO';
    if (s >= 0.95) return 'EN PLAN';
    if (s >= 0.85) return 'LEVE ATRASO';
    return 'ATRASADO';
  }
  function slug(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'proj';
  }

  // ── Carga en vivo desde Supabase (cliente del shell: window.sb) ──
  let dataReady = null;
  async function loadData() {
    const sb = window.sb;
    if (!sb) return false;
    try {
      // Cartera activa = estado 'En progreso' (definición canónica única)
      const { data: projs, error } = await sb.from('proyectos')
        .select('id,nombre,supervisor,departamento,provincia,distrito,zona,lat,lng,venta,facturado,valorizacion_pct,categoria,estado,cod_proyecto,avance_manual')
        .eq('estado', 'En progreso');
      if (error || !projs) return false;
      // Último reporte por proyecto → avance físico + SPI reales
      const { data: reps } = await sb.from('reportes')
        .select('nombre_proyecto,cod_proyecto,fecha_reporte,pct_ejecutado,spi')
        .order('fecha_reporte', { ascending: false });
      const lastByName = {}, lastByCod = {};
      (reps || []).forEach(r => {
        if (r.nombre_proyecto && !lastByName[r.nombre_proyecto]) lastByName[r.nombre_proyecto] = r;
        if (r.cod_proyecto && !lastByCod[r.cod_proyecto]) lastByCod[r.cod_proyecto] = r;
      });
      const rows = projs.filter(p => p.lat != null && p.lng != null).map(p => {
        const last = (p.cod_proyecto && lastByCod[p.cod_proyecto]) || lastByName[p.nombre] || null;
        const avAuto = last && last.pct_ejecutado != null ? parseFloat(last.pct_ejecutado)
                     : (parseFloat(p.valorizacion_pct) || 0);
        const avMan = (p.avance_manual != null && p.avance_manual !== '') ? parseFloat(p.avance_manual) : null;
        const spi = last && last.spi != null ? parseFloat(last.spi) : 1;
        return {
          id: slug(p.cod_proyecto || p.nombre),
          nombre: p.nombre,
          sup: p.supervisor || 'Sin asignar',
          dep: p.departamento || '', prov: p.provincia || '', ciudad: p.distrito || '',
          zona: p.zona || '',
          lat: parseFloat(p.lat), lng: parseFloat(p.lng),
          ventas: parseFloat(p.venta) || 0, fact: parseFloat(p.facturado) || 0,
          avance: Math.max(0, Math.min(100, (avMan != null ? avMan : avAuto) || 0)),
          spi: spi,
          estado: healthEstado(spi),
          tipo: TIPO_FIX[p.categoria] || p.categoria || 'Refrigeración',
        };
      });
      PROJECTS.length = 0;
      PROJECTS.push(...rows);
      recomputeBounds();
      if (mounted && map) { addMarkers(); fillKpis(); if (PROJECTS.length) map.fitBounds(PERU_BOUNDS, { padding: [40, 40] }); }
      return true;
    } catch (e) {
      console.warn('[FrioMap] loadData falló:', e);
      return false;
    }
  }
  function ensureData() {
    if (!dataReady) dataReady = loadData();
    return dataReady;
  }

  function estadoColor(est) {
    return est === 'EN PLAN'     ? C.teal
         : est === 'ADELANTADO'  ? C.blue
         : est === 'LEVE ATRASO' ? C.amber
         : est === 'ATRASADO'    ? C.red
         : C.gray; // PAUSA
  }
  function estadoLabel(est) {
    return est === 'EN PLAN'     ? 'En plan'
         : est === 'ADELANTADO'  ? 'Adelantado'
         : est === 'LEVE ATRASO' ? 'Leve atraso'
         : est === 'ATRASADO'    ? 'Atrasado'
         : 'En pausa'; // PAUSA
  }

  function fmtMoney(n) {
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }

  function statsOf(list) {
    const activos = list.filter(p => p.estado !== 'PAUSA');
    const cartera = list.reduce((s, p) => s + p.ventas, 0);
    const avance = activos.length
      ? Math.round(activos.reduce((s, p) => s + p.avance, 0) / activos.length)
      : 0;
    return { n: list.length, cartera, avance };
  }

  // ── Estado del módulo ──
  let map = null;
  let cluster = null;
  let mounted = false;
  let active = false;
  let resizeObs = null;
  let selectedId = null;
  const markers = {};   // id → L.marker
  let streetLayer = null, satLayer = null, satLabels = null, currentBase = 'street';

  // Encuadre por defecto = Perú completo; se recalcula cuando llega la data.
  let PERU_BOUNDS = L.latLngBounds([-18.6, -81.6], [-3.2, -68.4]);
  function recomputeBounds() {
    if (!PROJECTS.length) return;
    const lats = PROJECTS.map(p => p.lat), lngs = PROJECTS.map(p => p.lng);
    PERU_BOUNDS = L.latLngBounds(
      [Math.min(...lats) - 0.6, Math.min(...lngs) - 0.6],
      [Math.max(...lats) + 0.6, Math.max(...lngs) + 0.6]
    );
  }

  // ── Iconos de marcador (pin de obra) ──
  function markerIcon(p, on) {
    const col = estadoColor(p.estado);
    return L.divIcon({
      className: 'fp-mk-wrap',
      html: `<span class="fp-mk${on ? ' on' : ''}" style="--c:${col}"></span>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
  }

  // ── Icono de cluster (círculo agrupado) ──
  function clusterIcon(c) {
    const kids = c.getAllChildMarkers().map(m => m.options.proj);
    const st = statsOf(kids);
    const size = st.n >= 12 ? 60 : st.n >= 5 ? 50 : 42;
    // color por salud media (avance) de las obras agrupadas
    const tone = st.avance >= 70 ? C.teal : st.avance >= 40 ? C.amber : C.red;
    return L.divIcon({
      className: 'fp-cluster-wrap',
      html: `<div class="fp-cl" style="--c:${tone};width:${size}px;height:${size}px">
               <b>${st.n}</b><i>obras</i>
             </div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }

  // ── Panel lateral ejecutivo ──
  function openPanel(p) {
    const panel = document.getElementById('pg-panel');
    if (!panel) return;
    const col = estadoColor(p.estado);
    const avPct = Math.max(0, Math.min(100, Math.round(p.avance)));
    panel.innerHTML = `
      <button class="pg-panel-close" id="pg-panel-close" aria-label="Cerrar">&times;</button>
      <div class="pg-panel-flag" style="--c:${col}">${estadoLabel(p.estado)}</div>
      <h2 class="pg-panel-title">${p.nombre}</h2>
      <div class="pg-panel-loc">
        <span><b>Cliente:</b> ${p.nombre}</span>
        <span>${p.ciudad}, ${p.prov} · ${p.dep}</span>
      </div>
      <div class="pg-panel-type">${p.tipo} · Zona ${p.zona}</div>

      <div class="pg-stats">
        <div class="pg-stat">
          <div class="pg-stat-lbl">Presupuesto</div>
          <div class="pg-stat-val">${fmtMoney(p.ventas)}</div>
        </div>
        <div class="pg-stat">
          <div class="pg-stat-lbl">Facturado</div>
          <div class="pg-stat-val">${fmtMoney(p.fact)}</div>
        </div>
      </div>

      <div class="pg-cap">
        <div class="pg-cap-head"><span>Avance de obra</span><b>${avPct}%</b></div>
        <div class="pg-cap-track"><div class="pg-cap-bar" style="width:${avPct}%;background:${col}"></div></div>
      </div>

      <div class="pg-stats">
        <div class="pg-stat">
          <div class="pg-stat-lbl">Supervisor</div>
          <div class="pg-stat-val" style="font-size:15px">${p.sup}</div>
        </div>
        <div class="pg-stat">
          <div class="pg-stat-lbl">Estado</div>
          <div class="pg-stat-val" style="font-size:15px;color:${col}">${estadoLabel(p.estado)}</div>
        </div>
      </div>

      <div class="pg-panel-foot">
        <span class="pg-dot-sm" style="--c:${col}"></span>
        Obra FrioPacking · ${p.prov}, ${p.dep}
      </div>`;
    panel.classList.add('open');
    const close = document.getElementById('pg-panel-close');
    if (close) close.addEventListener('click', () => closePanel());
  }

  function closePanel() {
    const panel = document.getElementById('pg-panel');
    if (panel) panel.classList.remove('open');
    if (selectedId && markers[selectedId]) {
      const prev = PROJECTS.find(p => p.id === selectedId);
      markers[selectedId].setIcon(markerIcon(prev, false));
    }
    selectedId = null;
  }

  // ── Clic en obra → vuelo + zoom + panel + resaltado ──
  function focusProject(p) {
    if (selectedId && markers[selectedId]) {
      const prev = PROJECTS.find(x => x.id === selectedId);
      markers[selectedId].setIcon(markerIcon(prev, false));
    }
    selectedId = p.id;
    if (markers[p.id]) markers[p.id].setIcon(markerIcon(p, true));
    openPanel(p);
    if (map) map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 13), { duration: 1.1 });
  }

  // ── Tooltip agregado de cluster (hover) ──
  function clusterTip(st) {
    return `<div class="fp-cltip">
        <strong>${st.n} proyectos</strong>
        <span>Avance prom. <b>${st.avance}%</b></span>
        <span>Cartera <b>${fmtMoney(st.cartera)}</b></span>
      </div>`;
  }

  // ── Capas base ──
  function buildLayers() {
    streetLayer = L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      { subdomains: 'abcd', maxZoom: 20,
        attribution: '&copy; OpenStreetMap &copy; CARTO' }
    );
    satLayer = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19, attribution: 'Imagery &copy; Esri' }
    );
    satLabels = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19, pane: 'shadowPane' }
    );
  }

  function setBase(kind) {
    if (!map) return;
    if (kind === 'sat') {
      map.removeLayer(streetLayer);
      satLayer.addTo(map); satLabels.addTo(map);
      currentBase = 'sat';
    } else {
      map.removeLayer(satLayer); map.removeLayer(satLabels);
      streetLayer.addTo(map);
      currentBase = 'street';
    }
    const btn = document.getElementById('pg-rotate');
    if (btn) btn.querySelector('.pg-rotate-txt').textContent =
      currentBase === 'sat' ? 'Calles' : 'Satélite';
  }

  // ── (Re)construir marcadores desde PROJECTS (al init y al recargar data viva) ──
  function addMarkers() {
    if (!cluster) return;
    cluster.clearLayers();
    for (const k in markers) delete markers[k];
    PROJECTS.forEach(p => {
      const m = L.marker([p.lat, p.lng], { icon: markerIcon(p, false), proj: p });
      m.bindTooltip(
        `<b>${p.nombre}</b><span>${p.ciudad} · ${estadoLabel(p.estado)}</span>`,
        { direction: 'top', offset: [0, -10], className: 'fp-tt', opacity: 1 }
      );
      m.on('click', () => focusProject(p));
      markers[p.id] = m;
      cluster.addLayer(m);
    });
  }

  // ── Inicialización del mapa ──
  function initMap() {
    const el = document.getElementById('globe-canvas');
    if (!el || typeof L === 'undefined' || !L.markerClusterGroup) return false;

    map = L.map(el, {
      zoomControl: false,
      attributionControl: true,
      minZoom: 4, maxZoom: 19,
      worldCopyJump: true,
    });
    L.control.zoom({ position: 'topleft' }).addTo(map);

    buildLayers();
    streetLayer.addTo(map);
    map.fitBounds(PERU_BOUNDS, { padding: [40, 40] });

    cluster = L.markerClusterGroup({
      showCoverageOnHover: false,     // sin polígonos/ruido
      zoomToBoundsOnClick: true,      // clic cluster → zoom + expansión
      spiderfyOnMaxZoom: true,
      maxClusterRadius: 58,
      disableClusteringAtZoom: 11,    // obras individuales a nivel ciudad
      iconCreateFunction: clusterIcon,
    });

    addMarkers();
    map.addLayer(cluster);

    // tooltip agregado al pasar sobre un cluster
    cluster.on('clustermouseover', (e) => {
      const kids = e.layer.getAllChildMarkers().map(m => m.options.proj);
      e.layer.bindTooltip(clusterTip(statsOf(kids)),
        { direction: 'top', offset: [0, -8], className: 'fp-tt fp-tt-cl', opacity: 1 }
      ).openTooltip();
    });

    // clic en el mapa vacío → cerrar panel
    map.on('click', () => closePanel());

    resizeObs = new ResizeObserver(() => { if (active && map) map.invalidateSize(); });
    resizeObs.observe(el);

    return true;
  }

  // ── KPIs de cabecera (nivel país) ──
  function fillKpis() {
    const st = statsOf(PROJECTS);
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('pg-kpi-proj', st.n);
    set('pg-kpi-pais', new Set(PROJECTS.map(p => p.dep)).size);
    set('pg-kpi-ventas', fmtMoney(st.cartera));
    set('pg-kpi-pers', st.avance + '%');
  }

  // ── Encuadre a un departamento (salto desde el globo ejecutivo) ──
  function deptBounds(dep) {
    const ps = PROJECTS.filter(p => p.dep === dep);
    if (!ps.length) return PERU_BOUNDS;
    const lats = ps.map(p => p.lat), lngs = ps.map(p => p.lng);
    return L.latLngBounds(
      [Math.min(...lats) - 0.25, Math.min(...lngs) - 0.25],
      [Math.max(...lats) + 0.25, Math.max(...lngs) + 0.25]
    );
  }

  function focusDept(dep) {
    closePanel();
    if (!map) return;
    map.flyToBounds(deptBounds(dep), { padding: [60, 60], maxZoom: 11, duration: 1.2 });
  }

  function wireToolbar() {
    const t = document.getElementById('pg-rotate');
    if (t) t.addEventListener('click', () => setBase(currentBase === 'sat' ? 'street' : 'sat'));
    const home = document.getElementById('pg-home');
    if (home) home.addEventListener('click', () => {
      closePanel();
      map.flyToBounds(PERU_BOUNDS, { padding: [40, 40], duration: 1.0 });
    });
  }

  // ── Montaje (perezoso): se llama al entrar a #mapa ──
  function mount() {
    active = true;
    // Asegurar que la data viva de Supabase esté cargada antes de construir.
    ensureData().finally(() => {
      if (!mounted) {
        const ok = initMap();
        if (!ok) { setTimeout(mount, 250); return; } // esperar a Leaflet
        mounted = true;
        fillKpis();
        wireToolbar();
        // el contenedor estaba oculto → recalcular tamaño
        setTimeout(() => { if (map) { map.invalidateSize(); map.fitBounds(PERU_BOUNDS, { padding: [40, 40] }); } }, 60);
      } else {
        setTimeout(() => { if (map) map.invalidateSize(); }, 60);
      }
    });
  }

  function setActive(on) { active = on; }

  window.FrioMap = {
    mount, setActive, focus: focusProject, focusDept, data: PROJECTS,
    ready: ensureData,
    reload: () => { dataReady = loadData(); return dataReady; },
    instance: () => map,
  };
})();
