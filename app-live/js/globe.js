/* ════════════════════════════════════════════════════════════════════
   globe.js — Mapa Global de Operaciones Polarix
   Globo terráqueo interactivo estilo Google Earth corporativo (Globe.gl).
   - Texturas NASA Blue Marble (continentes/costas/relieve/agua) vía CDN.
   - Nodos luminosos por proyecto + halos pulsantes.
   - Arcos 3D animados (flujo de partículas) entre operaciones.
   - Clic en proyecto → vuelo suave + zoom + panel ejecutivo + nodo resaltado.
   - Rotación automática lenta. Render perezoso (solo al entrar a #mapa).
   Dependencias: globe.gl (UMD global `Globe`)
   API pública: window.PolarixGlobe.mount() / .setActive(bool)
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── Texturas (assets oficiales de three-globe, servidos por CDN) ──
  const TEX = {
    globe: '//unpkg.com/three-globe/example/img/earth-blue-marble.jpg',
    bump:  '//unpkg.com/three-globe/example/img/earth-topology.png',
    sky:   '//unpkg.com/three-globe/example/img/night-sky.png',
  };

  // ── Paleta de marca ──
  const C = {
    teal:  '#3ECBB0',  // operativo
    blue:  '#4F8DF5',  // expansión
    amber: '#F2B544',  // en obra
    navy:  '#0a1729',
  };

  // ── Operaciones internacionales de Polarix ──
  // nombre · país · ciudad · lat · lng · ventas (USD) · personal · capacidad (m³)
  const PROJECTS = [
    { id:'lima',   nombre:'Centro Logístico Polarix',  pais:'Perú',      ciudad:'Lima',             lat:-12.0464, lng:-77.0428, ventas:48200000, personal:320, capacidad:85000, estado:'sede',      tipo:'Sede Central' },
    { id:'scl',    nombre:'Cold Hub Santiago',         pais:'Chile',     ciudad:'Santiago',         lat:-33.4489, lng:-70.6693, ventas:22400000, personal:140, capacidad:42000, estado:'operativo', tipo:'Almacenamiento' },
    { id:'gye',    nombre:'Terminal Frío Guayaquil',   pais:'Ecuador',   ciudad:'Guayaquil',        lat:-2.1709,  lng:-79.9224, ventas:15800000, personal:96,  capacidad:30000, estado:'operativo', tipo:'Exportación' },
    { id:'bog',    nombre:'Polarix Andina',            pais:'Colombia',  ciudad:'Bogotá',           lat:4.7110,   lng:-74.0721, ventas:19100000, personal:110, capacidad:36000, estado:'operativo', tipo:'Distribución' },
    { id:'mex',    nombre:'Polarix Norteamérica',      pais:'México',    ciudad:'Ciudad de México', lat:19.4326,  lng:-99.1332, ventas:27600000, personal:165, capacidad:52000, estado:'operativo', tipo:'Distribución' },
    { id:'gru',    nombre:'Hub Frío São Paulo',        pais:'Brasil',    ciudad:'São Paulo',        lat:-23.5505, lng:-46.6333, ventas:31200000, personal:190, capacidad:60000, estado:'operativo', tipo:'Almacenamiento' },
    { id:'mia',    nombre:'Gateway Polarix Miami',     pais:'Estados Unidos', ciudad:'Miami',       lat:25.7617,  lng:-80.1918, ventas:24900000, personal:88,  capacidad:40000, estado:'operativo', tipo:'Hub Distribución' },
    { id:'mad',    nombre:'Polarix Europa',            pais:'España',    ciudad:'Madrid',           lat:40.4168,  lng:-3.7038,  ventas:17300000, personal:72,  capacidad:28000, estado:'expansion', tipo:'Apertura 2027' },
    { id:'pty',    nombre:'Zona Franca Polarix',       pais:'Panamá',    ciudad:'Ciudad de Panamá', lat:8.9824,   lng:-79.5199, ventas:12600000, personal:64,  capacidad:22000, estado:'operativo', tipo:'Tránsito' },
    { id:'eze',    nombre:'Polarix Sur',               pais:'Argentina', ciudad:'Buenos Aires',     lat:-34.6037, lng:-58.3816, ventas:14700000, personal:85,  capacidad:26000, estado:'obra',      tipo:'En construcción' },
  ];

  // ── Conexiones (rutas operativas). Hub principal = Lima ──
  const HUB = 'lima';
  const EXTRA_LINKS = [['mia','mad'], ['pty','mex'], ['gru','scl'], ['bog','mia']];

  function projById(id) { return PROJECTS.find(p => p.id === id); }

  function estadoColor(est) {
    return est === 'operativo' || est === 'sede' ? C.teal
         : est === 'expansion' ? C.blue
         : C.amber;
  }
  function estadoLabel(est) {
    return est === 'sede' ? 'Sede central'
         : est === 'operativo' ? 'Operativo'
         : est === 'expansion' ? 'En expansión'
         : 'En construcción';
  }

  function buildArcs() {
    const arcs = [];
    const hub = projById(HUB);
    PROJECTS.forEach(p => {
      if (p.id === HUB) return;
      arcs.push({ startLat:hub.lat, startLng:hub.lng, endLat:p.lat, endLng:p.lng, color:estadoColor(p.estado) });
    });
    EXTRA_LINKS.forEach(([a, b]) => {
      const pa = projById(a), pb = projById(b);
      if (pa && pb) arcs.push({ startLat:pa.lat, startLng:pa.lng, endLat:pb.lat, endLng:pb.lng, color:'#2db59a' });
    });
    return arcs;
  }

  function fmtMoney(n) {
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + n;
  }
  function fmtNum(n) { return n.toLocaleString('es-PE'); }

  // ── Estado del módulo ──
  let globe = null;
  let mounted = false;
  let active = false;
  let selectedId = null;
  let resizeObs = null;
  let hlTimer = null;
  const MAX_VENTAS = Math.max(...PROJECTS.map(p => p.ventas));

  // ── Altura del haz luminoso proporcional a las ventas (look Palantir/FlightRadar) ──
  function pointAlt(p) {
    const base = 0.04 + (p.ventas / MAX_VENTAS) * 0.30;
    return p.id === selectedId ? base + 0.06 : base;
  }
  function pointRad(p) { return p.id === selectedId ? 0.55 : 0.34; }

  // Refrescar las capas que dependen de la selección
  function refreshLayers() {
    if (!globe) return;
    globe.pointsData(PROJECTS).labelsData(PROJECTS);
    globe.ringsData(selectedId ? PROJECTS.filter(p => p.id === selectedId) : PROJECTS);
  }

  // ── Vuelo suave + zoom + panel + resaltado ──
  // IMPORTANTE: re-asignar datos de capa (points/labels/rings) en el MISMO tick que
  // pointOfView cancela el tween de cámara en globe.gl. Por eso volamos primero y
  // diferimos el resaltado (crecer el haz + enfocar el halo) hasta terminar el vuelo.
  function focusProject(p) {
    selectedId = p.id;
    openPanel(p);
    if (globe) {
      globe.controls().autoRotate = false;
      setRotateBtn(false);
      globe.pointOfView({ lat: p.lat, lng: p.lng, altitude: 1.05 }, 1200);
      clearTimeout(hlTimer);
      hlTimer = setTimeout(refreshLayers, 1280);
    }
  }

  // ── Panel lateral ejecutivo ──
  function openPanel(p) {
    const panel = document.getElementById('pg-panel');
    if (!panel) return;
    const col = estadoColor(p.estado);
    const maxCap = Math.max(...PROJECTS.map(x => x.capacidad));
    const capPct = Math.round((p.capacidad / maxCap) * 100);
    panel.innerHTML = `
      <button class="pg-panel-close" id="pg-panel-close" aria-label="Cerrar">&times;</button>
      <div class="pg-panel-flag" style="--c:${col}">${estadoLabel(p.estado)}</div>
      <h2 class="pg-panel-title">${p.nombre}</h2>
      <div class="pg-panel-loc">
        <span>${p.ciudad}, ${p.pais}</span>
        <span class="pg-panel-coord">${p.lat.toFixed(2)}°, ${p.lng.toFixed(2)}°</span>
      </div>
      <div class="pg-panel-type">${p.tipo}</div>

      <div class="pg-stats">
        <div class="pg-stat">
          <div class="pg-stat-lbl">Ventas anuales</div>
          <div class="pg-stat-val">${fmtMoney(p.ventas)}</div>
        </div>
        <div class="pg-stat">
          <div class="pg-stat-lbl">Personal</div>
          <div class="pg-stat-val">${fmtNum(p.personal)}</div>
        </div>
      </div>

      <div class="pg-cap">
        <div class="pg-cap-head">
          <span>Capacidad instalada</span>
          <b>${fmtNum(p.capacidad)} m³</b>
        </div>
        <div class="pg-cap-track"><div class="pg-cap-bar" style="width:${capPct}%;background:${col}"></div></div>
      </div>

      <div class="pg-panel-foot">
        <span class="pg-dot-sm" style="--c:${col}"></span>
        Nodo operativo Polarix · Red Global
      </div>`;
    panel.classList.add('open');
    const close = document.getElementById('pg-panel-close');
    if (close) close.addEventListener('click', closePanel);
  }

  // defer=true cuando hay un pointOfView en curso en el mismo tick (no romper el vuelo)
  function closePanel(defer) {
    const panel = document.getElementById('pg-panel');
    if (panel) panel.classList.remove('open');
    selectedId = null;
    clearTimeout(hlTimer);
    if (defer) hlTimer = setTimeout(refreshLayers, 1280);
    else refreshLayers();
  }

  // ── Botón de rotación ──
  function setRotateBtn(on) {
    const b = document.getElementById('pg-rotate');
    if (!b) return;
    b.classList.toggle('off', !on);
    b.querySelector('.pg-rotate-txt').textContent = on ? 'Rotación' : 'Pausado';
  }

  function dims() {
    const wrap = document.getElementById('globe-canvas');
    return wrap ? { w: wrap.clientWidth, h: wrap.clientHeight } : { w: 0, h: 0 };
  }

  // ── Inicialización del globo ──
  function initGlobe() {
    const el = document.getElementById('globe-canvas');
    if (!el || typeof Globe === 'undefined') return false;
    const { w, h } = dims();

    globe = Globe()(el)
      .width(w).height(h)
      .backgroundImageUrl(TEX.sky)
      .globeImageUrl(TEX.globe)
      .bumpImageUrl(TEX.bump)
      .showAtmosphere(true)
      .atmosphereColor('#5fa8ff')
      .atmosphereAltitude(0.20)
      // ── Arcos 3D con flujo de partículas ──
      .arcsData(buildArcs())
      .arcColor('color')
      .arcAltitude(0.28)
      .arcStroke(0.55)
      .arcDashLength(0.4)
      .arcDashGap(0.18)
      .arcDashInitialGap(() => Math.random())
      .arcDashAnimateTime(2600)
      .arcsTransitionDuration(0)
      // ── Halos pulsantes ──
      .ringsData(PROJECTS)
      .ringLat('lat').ringLng('lng')
      .ringColor(p => (t => `rgba(${hexRgb(estadoColor(p.estado))},${1 - t})`))
      .ringMaxRadius(4)
      .ringPropagationSpeed(2)
      .ringRepeatPeriod(1400)
      // ── Nodos luminosos (haces WebGL · altura = ventas) ──
      .pointLat('lat').pointLng('lng')
      .pointColor(p => estadoColor(p.estado))
      .pointAltitude(pointAlt)
      .pointRadius(pointRad)
      .pointResolution(18)
      .pointsTransitionDuration(700)
      .pointsData(PROJECTS)
      .onPointClick(p => focusProject(p))
      .onPointHover(p => { document.body.style.cursor = p ? 'pointer' : 'default'; })
      // ── Etiquetas de ciudad ──
      .labelLat('lat').labelLng('lng')
      .labelText('ciudad')
      .labelColor(p => p.id === selectedId ? '#ffffff' : 'rgba(226,238,255,0.85)')
      .labelSize(p => p.id === selectedId ? 1.15 : 0.9)
      .labelDotRadius(0)
      .labelAltitude(p => pointAlt(p) + 0.01)
      .labelResolution(2)
      .labelsData(PROJECTS)
      .onLabelClick(p => focusProject(p));

    // Iluminación / controles
    const controls = globe.controls();
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.32;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 180;
    controls.maxDistance = 520;

    // Punto de vista inicial: Latinoamérica en perspectiva
    globe.pointOfView({ lat: -10, lng: -72, altitude: 2.45 }, 0);

    // Clic en el océano/vacío → cerrar panel y reanudar
    el.addEventListener('click', (e) => {
      if (e.target === el || e.target.tagName === 'CANVAS') {
        closePanel();
        controls.autoRotate = true;
        setRotateBtn(true);
      }
    });

    // Resize responsivo
    resizeObs = new ResizeObserver(() => {
      if (!active) return;
      const d = dims();
      globe.width(d.w).height(d.h);
    });
    resizeObs.observe(el);

    return true;
  }

  function hexRgb(hex) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(',');
  }

  // ── KPIs de cabecera ──
  function fillKpis() {
    const tV = PROJECTS.reduce((s, p) => s + p.ventas, 0);
    const tP = PROJECTS.reduce((s, p) => s + p.personal, 0);
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('pg-kpi-proj', PROJECTS.length);
    set('pg-kpi-pais', new Set(PROJECTS.map(p => p.pais)).size);
    set('pg-kpi-ventas', fmtMoney(tV));
    set('pg-kpi-pers', fmtNum(tP));
  }

  // ── Montaje (perezoso): se llama al entrar a #mapa ──
  function mount() {
    active = true;
    if (!mounted) {
      const ok = initGlobe();
      if (!ok) { setTimeout(mount, 250); active = true; return; } // esperar a Globe.gl
      mounted = true;
      fillKpis();
      wireToolbar();
    } else {
      // re-encajar tamaño al volver a la vista
      const d = dims();
      globe.width(d.w).height(d.h);
      globe.controls().autoRotate = !document.getElementById('pg-rotate')?.classList.contains('off');
    }
  }

  function wireToolbar() {
    const r = document.getElementById('pg-rotate');
    if (r) r.addEventListener('click', () => {
      const c = globe.controls();
      c.autoRotate = !c.autoRotate;
      setRotateBtn(c.autoRotate);
    });
    const home = document.getElementById('pg-home');
    if (home) home.addEventListener('click', () => {
      closePanel(true); // diferir refresh: hay pointOfView en curso
      globe.pointOfView({ lat: -10, lng: -72, altitude: 2.45 }, 1200);
      globe.controls().autoRotate = true;
      setRotateBtn(true);
    });
  }

  function setActive(on) {
    active = on;
    if (globe) {
      // pausar rotación cuando no está visible (ahorra CPU)
      if (!on) globe.controls().autoRotate = false;
    }
  }

  window.PolarixGlobe = { mount, setActive, focus: focusProject, instance: () => globe };
})();
