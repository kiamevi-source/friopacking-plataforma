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

  // ── Cartera real de proyectos FrioPacking (Perú) ──
  const PROJECTS = [
    { id:'agroberries', nombre:'AGROBERRIES', sup:'Diego Asmat', dep:'Lambayeque', prov:'Lambayeque', ciudad:'Olmos', zona:'Norte', lat:-5.8573, lng:-79.7736, ventas:641560.13, fact:323383.61, avance:53.7, spi:1.0, estado:'EN PLAN', tipo:'Refrigeración' },
    { id:'agrofloral', nombre:'AGROFLORAL', sup:'Luis Goycochea', dep:'Lima', prov:'Cañete', ciudad:'San Vicente de Cañete', zona:'Centro', lat:-13.076, lng:-76.389, ventas:520799.42, fact:415687.02, avance:87.1, spi:0.98, estado:'EN PLAN', tipo:'Mecánica' },
    { id:'arafoods', nombre:'ARAFOODS', sup:'Steve Sarmiento', dep:'Ancash', prov:'Casma', ciudad:'Casma', zona:'Norte', lat:-9.4754, lng:-78.2897, ventas:805597.47, fact:632370.43, avance:98.4, spi:1.0, estado:'EN PLAN', tipo:'Refrigeración' },
    { id:'berry-harvest', nombre:'BERRY HARVEST', sup:'Irwin Gutierrez', dep:'Lambayeque', prov:'Lambayeque', ciudad:'Olmos', zona:'Norte', lat:-6.0173, lng:-79.6127, ventas:347856.25, fact:130401.3, avance:38.9, spi:0.88, estado:'LEVE ATRASO', tipo:'Refrigeración' },
    { id:'bomarea', nombre:'BOMAREA', sup:'Jorvin Paredes', dep:'Lambayeque', prov:'Lambayeque', ciudad:'Olmos', zona:'Norte', lat:-6.1773, lng:-79.7736, ventas:1500000, fact:300000, avance:7.3, spi:0.96, estado:'EN PLAN', tipo:'Civil' },
    { id:'delice', nombre:'DELICE', sup:'Wilson Urbina', dep:'Lima', prov:'Lima', ciudad:'Lurín', zona:'Centro', lat:-12.2759, lng:-76.8736, ventas:360886.11, fact:175954.12, avance:88.2, spi:0.95, estado:'LEVE ATRASO', tipo:'Packing' },
    { id:'frusan', nombre:'FRUSAN', sup:'Victor Ramirez', dep:'Lambayeque', prov:'Lambayeque', ciudad:'Olmos', zona:'Norte', lat:-6.0173, lng:-79.9345, ventas:4008997.04, fact:3536984.79, avance:90.3, spi:0.95, estado:'LEVE ATRASO', tipo:'Refrigeración' },
    { id:'imbarex', nombre:'IMBAREX', sup:'Jean Percy Casas', dep:'Ica', prov:'Pisco', ciudad:'Humay', zona:'Sur', lat:-13.635, lng:-76.002, ventas:853450, fact:406535, avance:82.8, spi:0.97, estado:'EN PLAN', tipo:'Packing' },
    { id:'qpack', nombre:'QPACK', sup:'Jesus Cabrera', dep:'La Libertad', prov:'Ascope', ciudad:'Casa Grande', zona:'Norte', lat:-7.7548, lng:-79.1951, ventas:2856251.96, fact:2242724.21, avance:43.5, spi:0.82, estado:'ATRASADO', tipo:'Packing' },
    { id:'santa-sofia', nombre:'SANTA SOFIA', sup:'Steve Sarmiento', dep:'Ica', prov:'Ica', ciudad:'Subtanjalla', zona:'Sur', lat:-14.0842, lng:-75.7481, ventas:545000, fact:245250, avance:77.7, spi:0.93, estado:'LEVE ATRASO', tipo:'Packing' },
    { id:'smartpacking', nombre:'SMARTPACKING', sup:'Erick Salvador', dep:'La Libertad', prov:'Virú', ciudad:'Virú', zona:'Norte', lat:-8.2522, lng:-78.7537, ventas:75700.16, fact:22710.05, avance:62.8, spi:1.0, estado:'EN PLAN', tipo:'Packing' },
    { id:'ta-export', nombre:'TA EXPORT', sup:'Patrick Vasquez', dep:'Ica', prov:'Ica', ciudad:'Salas', zona:'Sur', lat:-14.1742, lng:-75.6936, ventas:1460000.01, fact:722375.36, avance:46.8, spi:0.82, estado:'ATRASADO', tipo:'Refrigeración' },
    { id:'tal-sa', nombre:'TAL SA', sup:'Dennis Saravia', dep:'La Libertad', prov:'Trujillo', ciudad:'Salaverry', zona:'Norte', lat:-8.227, lng:-78.964, ventas:1700000, fact:425000, avance:63.0, spi:1.0, estado:'EN PLAN', tipo:'Civil' },
    { id:'talsa-pto-morin', nombre:'TALSA PTO. MORIN', sup:'Antero Ávila', dep:'La Libertad', prov:'Virú', ciudad:'Virú', zona:'Norte', lat:-8.4122, lng:-78.592, ventas:352587.8, fact:105776.36, avance:81.0, spi:1.01, estado:'EN PLAN', tipo:'Mecánica' },
    { id:'torre-blanca', nombre:'TORRE BLANCA', sup:'Waldir Saldaña', dep:'Lima', prov:'Huaral', ciudad:'Chancay', zona:'Centro', lat:-11.5619, lng:-77.2683, ventas:718498.3, fact:292015.43, avance:58.7, spi:0.95, estado:'EN PLAN', tipo:'Refrigeración' },
    { id:'tyt', nombre:'TyT', sup:'Luis Silva', dep:'Lima', prov:'Huaral', ciudad:'Huaral', zona:'Centro', lat:-11.1053, lng:-77.2067, ventas:227719.49, fact:136631.69, avance:47.6, spi:0.99, estado:'EN PLAN', tipo:'Refrigeración' },
    { id:'vanguard-prosembra', nombre:'VANGUARD/PROSEMBRA', sup:'Victor Flores', dep:'Ica', prov:'Pisco', ciudad:'Tupac Amaru Inca', zona:'Sur', lat:-13.805, lng:-76.235, ventas:3551664.97, fact:2754312.12, avance:99.5, spi:0.99, estado:'EN PLAN', tipo:'Packing' },
    { id:'viveros-el-tambo', nombre:'VIVEROS EL TAMBO', sup:'Dylan Marquina', dep:'Piura', prov:'Piura', ciudad:'Piura', zona:'Norte', lat:-5.1945, lng:-80.6328, ventas:216754.9, fact:0, avance:27.7, spi:0.92, estado:'LEVE ATRASO', tipo:'Civil' },
    { id:'camposol', nombre:'CAMPOSOL', sup:'Renato Jara', dep:'La Libertad', prov:'Virú', ciudad:'Chao', zona:'Norte', lat:-8.5349, lng:-78.9017, ventas:497385.27, fact:99477.05, avance:13.0, spi:0.87, estado:'LEVE ATRASO', tipo:'Refrigeración' },
    { id:'reiter', nombre:'REITER', sup:'Gustavo Martinez', dep:'Ica', prov:'Chincha', ciudad:'San Antonio', zona:'Norte', lat:-13.25, lng:-76.15, ventas:110710, fact:33213, avance:22.5, spi:1.42, estado:'ADELANTADO', tipo:'Packing' },
    { id:'diamond', nombre:'DIAMOND', sup:'Sin asignar', dep:'La Libertad', prov:'Trujillo', ciudad:'Trujillo', zona:'Norte', lat:-8.115, lng:-79.029, ventas:0, fact:0, avance:0, spi:1, estado:'PAUSA', tipo:'Packing' },
    { id:'branchout', nombre:'BRANCHOUT', sup:'Sin asignar', dep:'Lima', prov:'Lima', ciudad:'Lima', zona:'Centro', lat:-11.886, lng:-77.043, ventas:0, fact:0, avance:0, spi:1, estado:'PAUSA', tipo:'Refrigeración' },
    { id:'oslo', nombre:'OSLO', sup:'Sin asignar', dep:'Lima', prov:'Lima', ciudad:'Lima', zona:'Centro', lat:-11.9966, lng:-76.8874, ventas:0, fact:0, avance:0, spi:1, estado:'PAUSA', tipo:'Refrigeración' },
    { id:'tal-acopio', nombre:'TAL ACOPIO', sup:'Sin asignar', dep:'La Libertad', prov:'Virú', ciudad:'Virú', zona:'Norte', lat:-8.5722, lng:-78.7537, ventas:0, fact:0, avance:0, spi:1, estado:'PAUSA', tipo:'Civil' },
    { id:'prolan', nombre:'PROLAN', sup:'Sin asignar', dep:'Lima', prov:'Lima', ciudad:'Lima', zona:'Centro', lat:-12.1754, lng:-76.9468, ventas:0, fact:0, avance:0, spi:1, estado:'PAUSA', tipo:'Mecánica' },
    { id:'rintisa', nombre:'RINTISA', sup:'Sin asignar', dep:'Lima', prov:'Lima', ciudad:'Lima', zona:'Centro', lat:-12.1754, lng:-77.1392, ventas:0, fact:0, avance:0, spi:1, estado:'PAUSA', tipo:'Mecánica' },
    { id:'agrokasa', nombre:'AGROKASA', sup:'Sin asignar', dep:'Ica', prov:'Ica', ciudad:'Ica', zona:'Sur', lat:-13.9081, lng:-75.7286, ventas:0, fact:0, avance:0, spi:1, estado:'PAUSA', tipo:'Refrigeración' },
    { id:'icyp', nombre:'ICYP', sup:'Sin asignar', dep:'Ica', prov:'Ica', ciudad:'Ica', zona:'Sur', lat:-14.2281, lng:-75.7286, ventas:0, fact:0, avance:0, spi:1, estado:'PAUSA', tipo:'Mecánica' },
    { id:'arca-continental', nombre:'ARCA CONTINENTAL', sup:'Sin asignar', dep:'Lambayeque', prov:'Chiclayo', ciudad:'Chiclayo', zona:'Norte', lat:-6.7714, lng:-79.8409, ventas:0, fact:0, avance:0, spi:1, estado:'PAUSA', tipo:'Refrigeración' },
    { id:'viru', nombre:'VIRÚ', sup:'Sin asignar', dep:'La Libertad', prov:'Virú', ciudad:'Virú', zona:'Norte', lat:-8.4122, lng:-78.9154, ventas:0, fact:0, avance:0, spi:1, estado:'PAUSA', tipo:'Refrigeración' },
    { id:'agrolatina', nombre:'AGROLATINA', sup:'Sin asignar', dep:'Ica', prov:'Nazca', ciudad:'Nazca', zona:'Sur', lat:-14.8294, lng:-74.9286, ventas:0, fact:0, avance:0, spi:1, estado:'PAUSA', tipo:'Refrigeración' },
    { id:'aib', nombre:'AIB', sup:'Sin asignar', dep:'Lima', prov:'Lima', ciudad:'Lima', zona:'Centro', lat:-11.9966, lng:-77.1986, ventas:0, fact:0, avance:0, spi:1, estado:'PAUSA', tipo:'Mecánica' },
  ];

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

  const PERU_BOUNDS = (function () {
    const lats = PROJECTS.map(p => p.lat), lngs = PROJECTS.map(p => p.lng);
    return L.latLngBounds(
      [Math.min(...lats) - 0.6, Math.min(...lngs) - 0.6],
      [Math.max(...lats) + 0.6, Math.max(...lngs) + 0.6]
    );
  })();

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
  }

  function setActive(on) { active = on; }

  window.FrioMap = { mount, setActive, focus: focusProject, focusDept, data: PROJECTS, instance: () => map };
})();
