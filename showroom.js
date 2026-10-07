// Estudio 3D del hero: modelos .glb reales (Sketchfab, CC Attribution) en un set tipo fotografía de autos.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

// size: medida (en metros de escena) que ocupa el lado más largo del conjunto
export const CLASSICS = [
  {
    id: "alfa-giulia", name: "Alfa Romeo Giulia Sprint", year: "1965", spec: "1.6 L 4 en línea",
    file: "models/alfa-pair.glb", size: 9.2, ready: true,
    credit: { title: "1965 Alfa Romeo Giulia Sprint", author: "dagtholander", url: "https://sketchfab.com/3d-models/1965-alfa-romeo-giulia-sprint-3b30a0277a7b45a58496c843e6588212" },
  },
];

// Entorno de estudio: sala oscura con softboxes, para reflejos largos y limpios en la pintura y el cromo.
function studioEnvironment(renderer) {
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x101412);
  const room = new THREE.Mesh(new THREE.BoxGeometry(30, 14, 30), new THREE.MeshBasicMaterial({ color: 0x1a1f1c, side: THREE.BackSide }));
  room.position.y = 6;
  env.add(room);
  const panel = (w, h, intensity, pos, rot, tint = 0xffffff) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(tint).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.rotation.set(...rot);
    env.add(m);
  };
  panel(16, 5, 9, [0, 12.5, 0], [Math.PI / 2, 0, 0]);                 // softbox cenital
  panel(1.6, 10, 12, [-11, 5, 2], [0, Math.PI / 2, 0]);                 // tira lateral izquierda
  panel(1.6, 10, 12, [11, 5, -2], [0, -Math.PI / 2, 0]);                // tira lateral derecha
  panel(12, 4, 4, [0, 4, -14], [0, 0, 0], 0xffe2b8);                  // fondo cálido
  panel(8, 3, 6, [4, 3, 14], [0, Math.PI, 0]);                      // relleno frontal
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.02).texture;
  pmrem.dispose();
  return tex;
}

function contactShadowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, "rgba(0,0,0,0.85)");
  grad.addColorStop(0.45, "rgba(0,0,0,0.45)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

// Ajustes de material para que la pintura, el cromo y las llantas lean como objetos reales.
function tuneMaterials(root, envMap) {
  root.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    for (const m of [].concat(o.material)) {
      const n = (m.name || o.name || "").toLowerCase();
      m.envMap = envMap;
      if (n.includes("body")) {
        if ("clearcoat" in m) { m.clearcoat = 1; m.clearcoatRoughness = 0.04; }
        m.roughness = Math.min(Math.max(m.roughness ?? 0.4, 0.28), 0.45);
        m.envMapIntensity = 1.1;
      } else if (n.includes("chrome")) {
        m.metalness = 1; m.roughness = 0.08; m.envMapIntensity = 1.4;
      } else if (n.includes("tire")) {
        m.roughness = Math.max(m.roughness ?? 0.8, 0.82); m.envMapIntensity = 0.5;
      } else if (n.includes("glass")) {
        m.envMapIntensity = 1.6;
      } else {
        m.envMapIntensity = 0.9;
      }
      m.needsUpdate = true;
    }
  });
}

function placeOnGround(root, size) {
  const box = new THREE.Box3().setFromObject(root);
  const dims = box.getSize(new THREE.Vector3());
  root.scale.multiplyScalar(size / Math.max(dims.x, dims.z));
  root.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(root);
  const c = b.getCenter(new THREE.Vector3());
  root.position.x -= c.x;
  root.position.z -= c.z;
  root.position.y -= b.min.y;
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(root);
}

const cssColor = (el, name, fallback) => {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  try { return new THREE.Color(v || fallback); } catch { return new THREE.Color(fallback); }
};

export function mountShowroom(container, opts = {}) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = opts.exposure ?? 1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  container.appendChild(renderer.domElement);
  renderer.domElement.style.touchAction = "pan-y";

  const scene = new THREE.Scene();
  const envMap = studioEnvironment(renderer);
  scene.environment = envMap;

  // el fondo y la niebla toman el color de la página para que el piso se disuelva en ella
  const bg = cssColor(document.body, "--bg", "#0c1712");
  scene.background = bg.clone();
  scene.fog = new THREE.Fog(bg.clone(), 14, 30);
  const themeObserver = new MutationObserver(() => {
    const c = cssColor(document.body, "--bg", "#0c1712");
    scene.background.copy(c);
    scene.fog.color.copy(c);
    floor.material.color.copy(c);
  });
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ["data-theme"] });

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(40, 64),
    new THREE.MeshStandardMaterial({ color: bg.clone(), roughness: 0.55, metalness: 0, envMapIntensity: 0.35 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const key = new THREE.DirectionalLight(0xfff4e6, 2.6);
  key.position.set(-3, 11, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 9;
  key.shadow.blurSamples = 16;
  key.shadow.bias = -0.0004;
  Object.assign(key.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 30 });
  scene.add(key);
  scene.add(new THREE.HemisphereLight(0xdfe8e0, 0x0a0f0c, 0.6));

  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.rotateSpeed = 0.55;
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.minPolarAngle = 1.02;
  controls.maxPolarAngle = 1.42;

  // encuadre: distancia para que el conjunto quepa según el ancho del contenedor
  let fitHalf = new THREE.Vector3(2.5, 0.7, 1.2), fitCenter = new THREE.Vector3(0, 0.7, 0);
  const heroDir = new THREE.Vector3(...(opts.heroDir ?? [0.5, 0.13, 0.85])).normalize();
  function fitDistance() {
    // ancho aparente del conjunto visto desde la dirección de la cámara
    const halfW = Math.abs(heroDir.z) * fitHalf.x + Math.abs(heroDir.x) * fitHalf.z;
    const halfD = Math.abs(heroDir.x) * fitHalf.x + Math.abs(heroDir.z) * fitHalf.z;
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const tanH = tanV * camera.aspect;
    const fill = camera.aspect > 1.3 ? (opts.fill ?? 0.84) : 0.92;   // en pantallas anchas el coche ocupa parte del encuadre
    return Math.max(halfW / (tanH * fill), (fitHalf.y * 1.6) / (tanV * fill)) + halfD;
  }
  function frame() {
    const { width, height } = container.getBoundingClientRect();
    const d = fitDistance();
    scene.fog.near = d - 2; scene.fog.far = d + 13;
    // desplaza la vista: coche arriba a la derecha, libre del texto
    if (camera.aspect > 1.3) camera.setViewOffset(width, height, -width * (opts.shiftX ?? 0.19), height * (opts.shiftY ?? 0.13), width, height);
    else camera.clearViewOffset();
    return d;
  }

  function resize() {
    const { width, height } = container.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const fd = frame();
    if (!intro && current) {
      const d = fd;
      camera.position.copy(controls.target).addScaledVector(camera.position.clone().sub(controls.target).normalize(), d);
    }
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  let visible = true;
  const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
  io.observe(container);

  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  let current = null, intro = null;
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: contactShadowTexture(), transparent: true, depthWrite: false, opacity: 0.9 })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.004;
  scene.add(blob);

  async function show(car, onProgress) {
    const gltf = await loader.loadAsync(car.file, e => e.total && onProgress?.(e.loaded / e.total));
    if (current) scene.remove(current);
    current = gltf.scene;
    tuneMaterials(current, envMap);
    const box = placeOnGround(current, car.size ?? 4.4);
    scene.add(current);
    const dims = box.getSize(new THREE.Vector3());
    blob.scale.set(dims.x * 1.25, dims.z * 1.35, 1);
    fitHalf.set(dims.x / 2, dims.y / 2, dims.z / 2);
    fitCenter.set(0, dims.y * 0.3, 0);
    controls.target.copy(fitCenter);
    const dist = frame();
    const end = fitCenter.clone().addScaledVector(heroDir, dist);
    if (reduce) {
      camera.position.copy(end);
    } else {
      // entrada de cámara: acercamiento lento y un leve giro, una sola vez
      const start = fitCenter.clone().addScaledVector(new THREE.Vector3(heroDir.x * 0.75, heroDir.y + 0.05, heroDir.z * 1.15).normalize(), dist * 1.22);
      intro = { t0: performance.now(), dur: 2200, start, end };
      camera.position.copy(start);
    }
    camera.lookAt(controls.target);
  }

  const ease = t => 1 - Math.pow(1 - t, 3);
  renderer.setAnimationLoop(() => {
    if (!visible) return;
    if (intro) {
      const t = Math.min(1, (performance.now() - intro.t0) / intro.dur);
      camera.position.lerpVectors(intro.start, intro.end, ease(t));
      camera.lookAt(controls.target);
      if (t >= 1) intro = null;
    } else {
      controls.update();
    }
    renderer.render(scene, camera);
  });
  controls.addEventListener("start", () => { intro = null; });
  resize();

  return {
    show,
    dispose() {
      renderer.setAnimationLoop(null);
      ro.disconnect(); io.disconnect(); themeObserver.disconnect(); controls.dispose(); renderer.dispose();
      envMap.dispose();
      renderer.domElement.remove();
    },
  };
}
