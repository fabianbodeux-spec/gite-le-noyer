// Le Noyer — relief 3D de la vallée de la Lienne.
// Données : relief/lienne.bin (200 × 243 altitudes en décimètres, uint16 little-endian),
// issues des Terrain Tiles ouvertes (Mapzen / AWS, sources SRTM et nationales).
// Aucune dépendance de compilation : Three.js est servi depuis /vendor.

const GRID = { cols: 200, rows: 243, north: 50.370, south: 50.300, west: 5.680, east: 5.770 };
const KM_PER_DEG_LAT = 111.2;
const WIDTH = (GRID.east - GRID.west) * KM_PER_DEG_LAT * Math.cos((50.335 * Math.PI) / 180);
const DEPTH = (GRID.north - GRID.south) * KM_PER_DEG_LAT;
const EXAG = 2.4;
// Position approximative : hameau de Bierleux (OpenStreetMap). À affiner avec les coordonnées exactes.
const HOUSE = { lat: 50.3207, lon: 5.7260 };
const COLORS = { bg: 0x183628, low: 0x1d4030, high: 0x47705a, line: 0xf8f6ef, copper: 0xd2a27c };

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let threePromise, heightPromise, trailPromise;

const loadThree = () => (threePromise ??= import('/vendor/three.module.min.js'));
const loadHeights = () => (heightPromise ??= fetch('/relief/lienne.bin').then((r) => {
  if (!r.ok) throw new Error('relief');
  return r.arrayBuffer();
}).then((buffer) => Float32Array.from(new Uint16Array(buffer), (v) => v / 10)));
const loadTrail = () => (trailPromise ??= fetch('/traces/promenade-12.gpx').then((r) => {
  if (!r.ok) throw new Error('gpx');
  return r.text();
}).then((text) => {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const points = [...doc.getElementsByTagName('trkpt')].map((pt) => ({
    lat: +pt.getAttribute('lat'), lon: +pt.getAttribute('lon'),
    ele: +(pt.getElementsByTagName('ele')[0]?.textContent ?? NaN),
  }));
  let dist = 0;
  points.forEach((p, i) => {
    if (i) dist += haversine(points[i - 1], p);
    p.km = dist;
  });
  return points;
}));

function haversine(a, b) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

const toLocal = (lat, lon) => ({
  x: ((lon - GRID.west) / (GRID.east - GRID.west) - 0.5) * WIDTH,
  z: ((GRID.north - lat) / (GRID.north - GRID.south) - 0.5) * DEPTH,
});

function sampler(heights) {
  const { cols, rows } = GRID;
  return (x, z) => {
    const fx = Math.min(Math.max((x / WIDTH + 0.5) * (cols - 1), 0), cols - 1.001);
    const fz = Math.min(Math.max((z / DEPTH + 0.5) * (rows - 1), 0), rows - 1.001);
    const ix = Math.floor(fx), iz = Math.floor(fz), dx = fx - ix, dz = fz - iz;
    const h = (c, r) => heights[r * cols + c];
    return (h(ix, iz) * (1 - dx) + h(ix + 1, iz) * dx) * (1 - dz) + (h(ix, iz + 1) * (1 - dx) + h(ix + 1, iz + 1) * dx) * dz;
  };
}

async function buildScene(stage) {
  const [THREE, heights, trail] = await Promise.all([loadThree(), loadHeights(), loadTrail().catch(() => null)]);
  const { cols, rows } = GRID;
  let min = Infinity, max = -Infinity;
  for (const h of heights) { min = Math.min(min, h); max = Math.max(max, h); }
  const base = min;
  const yOf = (meters) => ((meters - base) / 1000) * EXAG;
  const heightAt = sampler(heights);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
  renderer.setClearColor(COLORS.bg);
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  stage.prepend(canvas);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(COLORS.bg, 9, 20);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 60);

  // Relief : grille alignée sur les données (ligne 0 = nord = -z).
  const geometry = new THREE.PlaneGeometry(WIDTH, DEPTH, cols - 1, rows - 1);
  geometry.rotateX(-Math.PI / 2);
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, yOf(heights[i]));
  geometry.computeVertexNormals();

  const material = new THREE.ShaderMaterial({
    extensions: { derivatives: true },
    fog: false,
    uniforms: {
      uBase: { value: base }, uExag: { value: EXAG }, uMin: { value: min }, uMax: { value: max },
      uLow: { value: new THREE.Color(COLORS.low) }, uHigh: { value: new THREE.Color(COLORS.high) },
      uLine: { value: new THREE.Color(COLORS.line) }, uBg: { value: new THREE.Color(COLORS.bg) },
    },
    vertexShader: `
      uniform float uBase; uniform float uExag;
      varying float vElev; varying vec3 vNormal; varying vec2 vUv; varying float vDepth;
      void main() {
        vElev = position.y * 1000.0 / uExag + uBase;
        vNormal = normal; vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uMin; uniform float uMax;
      uniform vec3 uLow; uniform vec3 uHigh; uniform vec3 uLine; uniform vec3 uBg;
      varying float vElev; varying vec3 vNormal; varying vec2 vUv; varying float vDepth;
      float contour(float v, float width) {
        float d = abs(fract(v - 0.5) - 0.5) / max(fwidth(v), 1e-4);
        return 1.0 - min(d / width, 1.0);
      }
      void main() {
        vec3 n = normalize(vNormal);
        float light = clamp(dot(n, normalize(vec3(-0.55, 0.75, -0.35))), 0.0, 1.0);
        vec3 col = mix(uLow, uHigh, smoothstep(uMin, uMax, vElev)) * (0.55 + 0.65 * light);
        col = mix(col, uLine, contour(vElev / 10.0, 1.0) * 0.16);
        col = mix(col, uLine, contour(vElev / 50.0, 1.3) * 0.55);
        vec2 e = min(vUv, 1.0 - vUv);
        float edge = smoothstep(0.0, 0.14, min(e.x, e.y));
        float fogF = smoothstep(9.0, 20.0, vDepth);
        gl_FragColor = vec4(mix(uBg, col, edge * (1.0 - fogF)), 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(geometry, material));

  const lift = 0.018;
  const point3 = (lat, lon, extra = lift) => {
    const { x, z } = toLocal(lat, lon);
    return new THREE.Vector3(x, yOf(heightAt(x, z)) + extra, z);
  };

  // Tracé de la promenade 12, drapé sur le relief.
  let curve = null;
  if (trail?.length > 1) {
    curve = new THREE.CatmullRomCurve3(trail.map((p) => point3(p.lat, p.lon)));
    const tube = new THREE.TubeGeometry(curve, trail.length * 3, 0.014, 6, false);
    scene.add(new THREE.Mesh(tube, new THREE.MeshBasicMaterial({ color: COLORS.copper, fog: false })));
  }

  // Repères : maison et départ du circuit.
  const pin = (anchor, color, radius) => {
    const group = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.28, 6),
      new THREE.MeshBasicMaterial({ color: COLORS.line, transparent: true, opacity: 0.7, fog: false }));
    stem.position.y = 0.14;
    const head = new THREE.Mesh(new THREE.SphereGeometry(radius, 20, 14), new THREE.MeshBasicMaterial({ color, fog: false }));
    head.position.y = 0.28;
    group.add(stem, head);
    group.position.copy(anchor);
    scene.add(group);
    return anchor.clone().setY(anchor.y + 0.28);
  };
  const housePoint = point3(HOUSE.lat, HOUSE.lon, 0);
  const houseTop = pin(housePoint, COLORS.copper, 0.045);
  const startPoint = trail ? point3(trail[0].lat, trail[0].lon, 0) : null;
  const startTop = startPoint ? pin(startPoint, COLORS.line, 0.03) : null;
  const houseAltitude = Math.round(heightAt(housePoint.x, housePoint.z) / 10) * 10;

  // Étiquettes HTML positionnées en projection.
  const labels = [];
  const addLabel = (anchor, html, cls = '') => {
    const el = document.createElement('span');
    el.className = `relief-label ${cls}`;
    el.innerHTML = html;
    el.setAttribute('aria-hidden', 'true');
    stage.append(el);
    labels.push({ el, anchor });
    return el;
  };
  addLabel(houseTop, `<strong>Le Noyer</strong><small>Bierleux, vers ${houseAltitude} m</small>`, 'is-house');
  if (startTop) addLabel(startTop, `<strong>Promenade 12</strong><small>Départ à Trou de Bra</small>`);

  // Caméra orbitale (cible + coordonnées sphériques).
  const view = { target: new THREE.Vector3(), radius: 9, polar: 0.95, azimuth: -0.4 };
  const vec = new THREE.Vector3(), tmp = new THREE.Vector3();
  let width = 0, height = 0, queued = false;

  function render() {
    queued = false;
    vec.setFromSphericalCoords(view.radius, view.polar, view.azimuth).add(view.target);
    camera.position.copy(vec);
    camera.lookAt(view.target);
    renderer.render(scene, camera);
    for (const { el, anchor } of labels) {
      tmp.copy(anchor).project(camera);
      const visible = tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1;
      el.style.opacity = visible ? '' : '0';
      const lx = Math.min(((tmp.x + 1) / 2) * width, width - el.offsetWidth - 22);
      el.style.transform = `translate(${Math.max(lx, 0)}px, ${((1 - tmp.y) / 2) * height}px)`;
    }
  }
  const requestRender = () => { if (!queued) { queued = true; requestAnimationFrame(render); } };

  const resize = () => {
    width = stage.clientWidth; height = stage.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.fov = width < 640 ? 44 : 34;
    // Sur mobile, l'accueil remonte le relief au-dessus du texte.
    if (stage.dataset.reliefShift && width < 800) camera.setViewOffset(width, height, 0, height * 0.2, width, height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    requestRender();
  };
  new ResizeObserver(resize).observe(stage);
  resize();

  stage.classList.add('is-ready');
  return { THREE, view, requestRender, curve, trail, housePoint, startPoint, houseAltitude, scene, yOf, heightAt };
}

/* ---------- Accueil : caméra guidée par le défilement ---------- */
async function initHome(root) {
  const stage = root.querySelector('[data-relief-stage]');
  const ctx = await buildScene(stage);
  const { THREE, view, requestRender, housePoint, startPoint } = ctx;
  const mid = startPoint ? housePoint.clone().lerp(startPoint, 0.5) : housePoint.clone();
  const keys = [
    { target: new THREE.Vector3(0, 0.15, 0), radius: 10.5, polar: 0.82, azimuth: -0.55 },
    { target: mid, radius: 6.2, polar: 1.0, azimuth: -0.1 },
    { target: housePoint.clone().setY(housePoint.y + 0.1), radius: 4.6, polar: 1.04, azimuth: 0.4 },
  ];
  const steps = [...root.querySelectorAll('[data-relief-step]')];
  const ease = (t) => t * t * (3 - 2 * t);
  const apply = (p) => {
    const seg = Math.min(Math.floor(p * 2), 1), t = ease(Math.min(Math.max(p * 2 - seg, 0), 1));
    const a = keys[seg], b = keys[seg + 1];
    view.target.copy(a.target).lerp(b.target, t);
    view.radius = a.radius + (b.radius - a.radius) * t;
    view.polar = a.polar + (b.polar - a.polar) * t;
    view.azimuth = a.azimuth + (b.azimuth - a.azimuth) * t;
    const active = Math.min(Math.floor(p * steps.length), steps.length - 1);
    steps.forEach((s, i) => s.toggleAttribute('data-active', i === active));
    requestRender();
  };

  if (reduceMotion) {
    root.classList.add('is-static');
    apply(0.5);
    steps.forEach((s) => s.setAttribute('data-active', ''));
    return;
  }
  const onScroll = () => {
    const rect = root.getBoundingClientRect();
    const span = rect.height - innerHeight;
    apply(span > 0 ? Math.min(Math.max(-rect.top / span, 0), 1) : 0.5);
  };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  onScroll();
}

/* ---------- Randonnées : relief manipulable + profil altimétrique ---------- */
async function initTrail(root) {
  const stage = root.querySelector('[data-relief-stage]');
  const ctx = await buildScene(stage);
  const { THREE, view, requestRender, curve, trail, startPoint, housePoint } = ctx;
  if (!curve) throw new Error('tracé indisponible');

  const box = new THREE.Box3().setFromPoints(curve.getPoints(120));
  const center = box.getCenter(new THREE.Vector3());
  const presets = {
    ensemble: { target: center, radius: 4.2, polar: 0.92, azimuth: -0.35 },
    noyer: { target: housePoint.clone().lerp(startPoint, 0.55), radius: 6.8, polar: 1.02, azimuth: 2.6 },
  };
  let anim = 0;
  const goTo = (name) => {
    const to = presets[name], from = { target: view.target.clone(), radius: view.radius, polar: view.polar, azimuth: view.azimuth };
    let dAz = to.azimuth - from.azimuth;
    dAz = Math.atan2(Math.sin(dAz), Math.cos(dAz));
    const start = performance.now(), dur = reduceMotion ? 0 : 900;
    cancelAnimationFrame(anim);
    const step = (now) => {
      const t = dur ? Math.min((now - start) / dur, 1) : 1, k = 1 - (1 - t) ** 3;
      view.target.copy(from.target).lerp(to.target, k);
      view.radius = from.radius + (to.radius - from.radius) * k;
      view.polar = from.polar + (to.polar - from.polar) * k;
      view.azimuth = from.azimuth + dAz * k;
      requestRender();
      if (t < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  };
  Object.assign(view, presets.ensemble, { target: presets.ensemble.target.clone() });
  requestRender();

  root.querySelectorAll('[data-relief-view]').forEach((btn) => btn.addEventListener('click', () => goTo(btn.dataset.reliefView)));
  const zoom = (f) => { cancelAnimationFrame(anim); view.radius = Math.min(Math.max(view.radius * f, 1.6), 12); requestRender(); };
  root.querySelector('[data-relief-zoom="in"]')?.addEventListener('click', () => zoom(0.8));
  root.querySelector('[data-relief-zoom="out"]')?.addEventListener('click', () => zoom(1.25));

  // Glisser pour tourner (le défilement vertical tactile reste libre).
  let drag = null;
  stage.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; stage.setPointerCapture(e.pointerId); cancelAnimationFrame(anim); });
  stage.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    view.azimuth -= (e.clientX - drag.x) * 0.006;
    if (e.pointerType === 'mouse') view.polar = Math.min(Math.max(view.polar + (e.clientY - drag.y) * 0.004, 0.35), 1.38);
    drag.x = e.clientX; drag.y = e.clientY;
    requestRender();
  });
  const end = () => { drag = null; };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  stage.addEventListener('keydown', (e) => {
    const moves = { ArrowLeft: () => (view.azimuth += 0.12), ArrowRight: () => (view.azimuth -= 0.12),
      ArrowUp: () => (view.polar = Math.max(view.polar - 0.08, 0.35)), ArrowDown: () => (view.polar = Math.min(view.polar + 0.08, 1.38)),
      '+': () => zoom(0.8), '-': () => zoom(1.25) };
    if (moves[e.key]) { e.preventDefault(); moves[e.key](); requestRender(); }
  });

  // Curseur sur le tracé.
  const cursor = new THREE.Mesh(new THREE.SphereGeometry(0.04, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
  ctx.scene.add(cursor);

  // Profil altimétrique (altitudes du GPX).
  const svg = root.querySelector('[data-relief-profile]');
  const range = root.querySelector('[data-relief-range]');
  const output = root.querySelector('[data-relief-output]');
  const total = trail[trail.length - 1].km;
  const eles = trail.map((p) => p.ele);
  const eMin = Math.min(...eles), eMax = Math.max(...eles);
  const W = 600, H = 120, pad = 6;
  const px = (km) => (km / total) * W;
  const py = (ele) => H - pad - ((ele - eMin) / (eMax - eMin || 1)) * (H - pad * 2);
  const line = trail.map((p, i) => `${i ? 'L' : 'M'}${px(p.km).toFixed(1)},${py(p.ele).toFixed(1)}`).join('');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.innerHTML = `<path class="profile-area" d="${line}L${W},${H}L0,${H}Z"/><path class="profile-line" d="${line}"/>` +
    `<line class="profile-cursor" x1="0" x2="0" y1="0" y2="${H}"/>`;
  const vline = svg.querySelector('.profile-cursor');
  let gain = 0;
  for (let i = 1; i < eles.length; i++) gain += Math.max(eles[i] - eles[i - 1], 0);
  root.querySelector('[data-relief-stats]').innerHTML =
    `<div><strong>${total.toFixed(1).replace('.', ',')} km</strong><span>longueur du GPX</span></div>` +
    `<div><strong>${Math.round(eMin)}–${Math.round(eMax)} m</strong><span>altitudes</span></div>` +
    `<div><strong>≈ ${Math.round(gain / 5) * 5} m</strong><span>dénivelé positif</span></div>`;

  const fmt = (n) => n.toFixed(1).replace('.', ',');
  const setPosition = (ratio) => {
    const km = ratio * total;
    let i = trail.findIndex((p) => p.km >= km);
    if (i < 0) i = trail.length - 1;
    const p = trail[i];
    cursor.position.copy(curve.getPointAt(Math.min(Math.max(i / (trail.length - 1), 0), 1)));
    cursor.position.y += 0.03;
    vline.setAttribute('x1', px(p.km)); vline.setAttribute('x2', px(p.km));
    output.textContent = `km ${fmt(p.km)} · ${Math.round(p.ele)} m`;
    range.setAttribute('aria-valuetext', output.textContent);
    requestRender();
  };
  range.addEventListener('input', () => setPosition(range.value / 1000));
  setPosition(0);
  root.classList.add('has-profile');
}

/* ---------- Démarrage paresseux ---------- */
const roots = document.querySelectorAll('[data-relief]');
if (roots.length && webglAvailable()) {
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      io.unobserve(entry.target);
      const root = entry.target;
      const init = root.dataset.relief === 'trail' ? initTrail : initHome;
      root.classList.add('is-loading');
      init(root).then(() => root.classList.remove('is-loading')).catch((error) => {
        console.warn('Relief 3D indisponible :', error);
        root.classList.remove('is-loading');
        root.classList.add('is-fallback');
      });
    }
  }, { rootMargin: '600px 0px' });
  roots.forEach((r) => io.observe(r));
} else {
  roots.forEach((r) => r.classList.add('is-fallback'));
}

