/* ════════════════════════════════════════════════════════════════════
   globe-exec.js — Vista Ejecutiva (MODO 1) + coordinador de modos
   Globo terráqueo cinematográfico (Globe.gl) para storytelling ejecutivo:
     · Globo realista, rotación automática lenta, Perú resaltado.
     · Marcadores por DEPARTAMENTO (no proyectos individuales).
     · Anillos de pulso + arcos de conexión animados desde el hub (Lima).
     · KPIs flotantes consolidados.
     · Clic en departamento → vuelo cinematográfico + salto a Vista Operativa
       (mapa Leaflet FrioMap) ya enfocado en esa región.
   Dependencias: globe.gl (global `Globe`), FrioMap (datos + focusDept).
   API pública: window.FrioGlobe.enter() / .leave() / .showExec() / .showOp()
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const C = { teal: '#3ECBB0', blue: '#4F8DF5', amber: '#F2B544', red: '#E24B4A', gray: '#7E8BA3' };

  function fmtMoney(n) {
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function toneByAvance(a) { return a >= 70 ? C.teal : a >= 40 ? C.amber : C.red; }

  // ── Estado ──
  let world = null;
  let mounted = false;
  let active = false;
  let intro = false;
  let resizeObs = null;
  let DEPTS = [];
  const HUB = { lat: -12.0, lng: -77.0 }; // Lima (hub corporativo)

  // ── Agregar proyectos por departamento (fuente única: FrioMap.data) ──
  function buildDepts() {
    const data = (window.FrioMap && window.FrioMap.data) || [];
    const by = {};
    data.forEach(p => { (by[p.dep] = by[p.dep] || []).push(p); });
    return Object.keys(by).map(dep => {
      const ps = by[dep];
      const lat = ps.reduce((s, p) => s + p.lat, 0) / ps.length;
      const lng = ps.reduce((s, p) => s + p.lng, 0) / ps.length;
      const cartera = ps.reduce((s, p) => s + p.ventas, 0);
      const act = ps.filter(p => p.estado !== 'PAUSA');
      const avance = act.length ? Math.round(act.reduce((s, p) => s + p.avance, 0) / act.length) : 0;
      return { dep, lat, lng, n: ps.length, cartera, avance };
    }).sort((a, b) => b.cartera - a.cartera);
  }

  // ── KPIs flotantes consolidados ──
  function fillKpis() {
    const data = (window.FrioMap && window.FrioMap.data) || [];
    const cartera = data.reduce((s, p) => s + p.ventas, 0);
    const act = data.filter(p => p.estado !== 'PAUSA');
    const avance = act.length ? Math.round(act.reduce((s, p) => s + p.avance, 0) / act.length) : 0;
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('exg-proj', data.length);
    set('exg-dep', DEPTS.length);
    set('exg-cartera', fmtMoney(cartera));
    set('exg-avance', avance + '%');
  }

  // ── Tooltip de departamento (hover) ──
  function deptTip(d) {
    return `<div class="gx-tip">
        <b>${d.dep}</b>
        <span>${d.n} obras · ${fmtMoney(d.cartera)}</span>
        <em>Avance prom. ${d.avance}% · clic para gestionar</em>
      </div>`;
  }

  // ── Tamaño del lienzo del globo ──
  function sizeGlobe() {
    const el = document.getElementById('globe-exec-canvas');
    if (!el || !world) return;
    const w = el.clientWidth, h = el.clientHeight;
    if (w > 0 && h > 0) { world.width(w); world.height(h); }
  }

  // ── Inicialización del globo ──
  function initGlobe() {
    const el = document.getElementById('globe-exec-canvas');
    if (!el || typeof Globe === 'undefined') return false;

    DEPTS = buildDepts();

    world = Globe()
      .backgroundColor('#070d1c')
      .globeImageUrl('//unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
      .bumpImageUrl('//unpkg.com/three-globe/example/img/earth-topology.png')
      .backgroundImageUrl('//unpkg.com/three-globe/example/img/night-sky.png')
      .atmosphereColor('#9fd8ff')
      .atmosphereAltitude(0.18)
      (el);

    // marcadores por departamento (labels WebGL: nombre + punto, clicables)
    world.labelsData(DEPTS)
      .labelLat(d => d.lat)
      .labelLng(d => d.lng)
      .labelText(d => d.dep)
      .labelSize(d => 0.55)
      .labelDotRadius(d => 0.35)
      .labelColor(d => toneByAvance(d.avance))
      .labelResolution(2)
      .labelAltitude(0.012)
      .labelLabel(d => deptTip(d))
      .onLabelClick(d => switchToOperative(d.dep));

    // anillos de pulso bajo cada departamento
    world.ringsData(DEPTS)
      .ringLat(d => d.lat)
      .ringLng(d => d.lng)
      .ringMaxRadius(3.2)
      .ringPropagationSpeed(1.6)
      .ringRepeatPeriod(1400)
      .ringColor(d => {
        const c = toneByAvance(d.avance);
        return t => hexToRgba(c, 1 - t);
      });

    // arcos de conexión animados (hub Lima → cada departamento)
    const arcs = DEPTS.map(d => ({ slat: HUB.lat, slng: HUB.lng, elat: d.lat, elng: d.lng }));
    world.arcsData(arcs)
      .arcStartLat(a => a.slat).arcStartLng(a => a.slng)
      .arcEndLat(a => a.elat).arcEndLng(a => a.elng)
      .arcColor(() => [C.teal, C.blue])
      .arcAltitudeAutoScale(0.4)
      .arcStroke(0.45)
      .arcDashLength(0.4)
      .arcDashGap(0.25)
      .arcDashAnimateTime(2200);

    // Perú resaltado (polígono país)
    fetch('//unpkg.com/three-globe/example/datasets/ne_110m_admin_0_countries.geojson')
      .then(r => r.json())
      .then(({ features }) => {
        if (!world) return;
        const peru = features.filter(f => {
          const p = f.properties || {};
          return p.ADMIN === 'Peru' || p.NAME === 'Peru' || p.ISO_A3 === 'PER';
        });
        world.polygonsData(peru)
          .polygonCapColor(() => 'rgba(62,203,176,0.28)')
          .polygonSideColor(() => 'rgba(62,203,176,0.10)')
          .polygonStrokeColor(() => '#5fe3c8')
          .polygonAltitude(0.012);
      })
      .catch(() => {});

    // controles: rotación automática muy lenta; se detiene al interactuar
    const ctrl = world.controls();
    ctrl.autoRotate = true;
    ctrl.autoRotateSpeed = 0.12;
    ctrl.enableZoom = true;
    ctrl.minDistance = 180;
    ctrl.addEventListener('start', () => { ctrl.autoRotate = false; }); // facilita seleccionar

    sizeGlobe();
    resizeObs = new ResizeObserver(() => sizeGlobe());
    resizeObs.observe(el);

    return true;
  }

  function hexToRgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`;
  }

  // ── Intro cinematográfica (zoom hacia Perú) ──
  function cinematicIntro() {
    if (!world || intro) return;
    intro = true;
    world.pointOfView({ lat: -9.2, lng: -75.0, altitude: 3.4 }, 0);
    setTimeout(() => { if (world) world.pointOfView({ lat: -9.2, lng: -75.0, altitude: 1.9 }, 2400); }, 120);
  }

  function mountGlobe() {
    if (!mounted) {
      const ok = initGlobe();
      if (!ok) { setTimeout(mountGlobe, 250); return; } // esperar a Globe.gl
      mounted = true;
      fillKpis();
      setTimeout(() => { sizeGlobe(); cinematicIntro(); }, 80);
    } else {
      setTimeout(sizeGlobe, 60);
      if (world) world.controls().autoRotate = true;
    }
  }

  // ── Conmutación de modos ──
  function setModeBtn(mode) {
    const e = document.getElementById('mode-exec');
    const o = document.getElementById('mode-op');
    if (e) e.classList.toggle('is-active', mode === 'exec');
    if (o) o.classList.toggle('is-active', mode === 'op');
  }

  function showExec() {
    const ex = document.getElementById('exec-stage');
    const op = document.getElementById('op-stage');
    if (ex) ex.style.display = '';
    if (op) op.style.display = 'none';
    setModeBtn('exec');
    if (window.FrioMap) window.FrioMap.setActive(false);
    mountGlobe();
  }

  function showOp(dep) {
    const ex = document.getElementById('exec-stage');
    const op = document.getElementById('op-stage');
    if (ex) ex.style.display = 'none';
    if (op) op.style.display = '';
    setModeBtn('op');
    if (world) world.controls().autoRotate = false;
    if (window.FrioMap) {
      window.FrioMap.setActive(true);
      window.FrioMap.mount();
      if (dep) setTimeout(() => window.FrioMap.focusDept(dep), 260);
    }
  }

  // ── Clic en departamento: vuelo cinematográfico → Vista Operativa ──
  function switchToOperative(dep) {
    const d = DEPTS.find(x => x.dep === dep);
    if (world && d) {
      world.controls().autoRotate = false;
      world.pointOfView({ lat: d.lat, lng: d.lng, altitude: 0.55 }, 1300);
      setTimeout(() => showOp(dep), 1350);
    } else {
      showOp(dep);
    }
  }

  function wireModes() {
    const e = document.getElementById('mode-exec');
    const o = document.getElementById('mode-op');
    if (e) e.addEventListener('click', () => showExec());
    if (o) o.addEventListener('click', () => showOp());
  }

  // ── Entrada/salida desde el router ──
  function enter() {
    active = true;
    wireModes();
    showExec(); // arranca siempre en Vista Ejecutiva (storytelling)
  }
  function leave() {
    active = false;
    if (world) world.controls().autoRotate = false;
    if (window.FrioMap) window.FrioMap.setActive(false);
  }

  window.FrioGlobe = {
    enter, leave, showExec, showOp, switchToOperative,
    setActive: (on) => { active = on; },
    instance: () => world,
  };
})();
