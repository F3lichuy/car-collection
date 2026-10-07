// Visor 3D del hero: carga modelos .glb reales (Sketchfab, CC Attribution) y permite cambiar entre ellos.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

const CAR_LENGTH = 4.4;

// ready: el .glb ya está en /models. rotY: giro extra para que todos miren hacia el mismo lado (se ajusta por modelo)
export const CLASSICS = [
  {
    id: "alfa-giulia", name: "Alfa Romeo Giulia Sprint", year: "1965", spec: "1.6 L 4 en línea",
    file: "models/alfa-giulia.glb", rotY: 0, ready: true,
    credit: { title: "1965 Alfa Romeo Giulia Sprint", author: "dagtholander", url: "https://sketchfab.com/3d-models/1965-alfa-romeo-giulia-sprint-3b30a0277a7b45a58496c843e6588212" },
  },
  {
    id: "porsche-964", name: "Porsche 911 (964)", year: "1990", spec: "3.3 L bóxer 6 turbo",
    file: "models/porsche-964.glb", rotY: 0,
    credit: { title: "Porsche 911 (964)", author: "DRIVER-FIRE", url: "https://sketchfab.com/3d-models/porsche-911-964-cae366648d134fa3a3ee810ba1f6c2fc" },
  },
  {
    id: "jaguar-etype", name: "Jaguar E-Type", year: "1961", spec: "3.8 L 6 en línea",
    file: "models/jaguar-etype.glb", rotY: 0,
    credit: { title: "Jaguar E_TYPE", author: "Nommoc", url: "https://sketchfab.com/3d-models/jaguar-e-type-32aa25ea6e1b40f395b2aff33ca0a279" },
  },
  {
    id: "mercedes-300sl", name: "Mercedes-Benz 300 SL", year: "1954", spec: "3.0 L 6 en línea, inyección",
    file: "models/mercedes-300sl.glb", rotY: 0,
    credit: { title: "Mercedes-Benz 300 SL Gullwing", author: "Lexyc16", url: "https://sketchfab.com/3d-models/mercedes-benz-300-sl-gullwing-505241c829c540a4921533000736904e" },
  },
];

function softShadowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(128, 128, 8, 128, 128, 128);
  grad.addColorStop(0, "rgba(0,0,0,0.7)");
  grad.addColorStop(0.55, "rgba(0,0,0,0.3)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

// Escala el modelo a un largo común, lo apoya en el suelo y lo centra.
function normalize(root, rotY) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const pivot = new THREE.Group();
  pivot.add(root);
  // el eje más largo del coche queda sobre X
  if (size.z > size.x) root.rotation.y = Math.PI / 2;
  root.rotation.y += rotY;
  root.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(root);
  const s2 = b2.getSize(new THREE.Vector3());
  const k = CAR_LENGTH / Math.max(s2.x, s2.z);
  root.scale.multiplyScalar(k);
  root.updateMatrixWorld(true);
  const b3 = new THREE.Box3().setFromObject(root);
  const c = b3.getCenter(new THREE.Vector3());
  root.position.x -= c.x;
  root.position.z -= c.z;
  root.position.y -= b3.min.y;
  return pivot;
}

export function mountShowroom(container, opts = {}) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = opts.exposure ?? 1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const key = new THREE.DirectionalLight(0xffffff, opts.keyLight ?? 1.5);
  key.position.set(3, 6, 4);
  scene.add(key);

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(CAR_LENGTH * 1.4, 2.7),
    new THREE.MeshBasicMaterial({ map: softShadowTexture(), transparent: true, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.002;
  scene.add(shadow);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(...(opts.cameraPos ?? [6.2, 1.8, 6.2]));
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, opts.targetY ?? 0.55, 0);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.enableZoom = false;
  // en táctil: gesto horizontal gira el coche, el vertical sigue haciendo scroll de la página
  renderer.domElement.style.touchAction = "pan-y";
  controls.minPolarAngle = 0.6;
  controls.maxPolarAngle = 1.48;
  controls.autoRotate = !reduce && opts.autoRotate !== false;
  controls.autoRotateSpeed = 0.7;
  let idleTimer;
  controls.addEventListener("start", () => { controls.autoRotate = false; clearTimeout(idleTimer); });
  controls.addEventListener("end", () => {
    if (reduce || opts.autoRotate === false) return;
    idleTimer = setTimeout(() => (controls.autoRotate = true), 4000);
  });

  function resize() {
    const { width, height } = container.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    camera.aspect = width / height;
    // en contenedores angostos abrimos el campo de visión para que el coche quepa completo
    const aspect = width / height;
    camera.fov = aspect >= 1.6 ? 30 : Math.min(54, 30 * (1.6 / aspect));
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  let visible = true;
  const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
  io.observe(container);

  const draco = new DRACOLoader().setDecoderPath("https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/libs/draco/gltf/");
  const loader = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
  const cache = new Map();
  let current = null, fade = 1, loadToken = 0;

  function setOpacity(obj, a) {
    obj.traverse(o => {
      if (!o.isMesh) return;
      for (const m of [].concat(o.material)) {
        if (m.userData.baseOpacity === undefined) {
          m.userData.baseOpacity = m.opacity;
          m.userData.baseTransparent = m.transparent;
        }
        m.transparent = a < 1 || m.userData.baseTransparent;
        m.opacity = m.userData.baseOpacity * a;
      }
    });
  }

  async function show(car, onProgress) {
    const token = ++loadToken;
    let model = cache.get(car.id);
    if (!model) {
      const gltf = await loader.loadAsync(car.file, e => e.total && onProgress?.(e.loaded / e.total));
      model = normalize(gltf.scene, car.rotY || 0);
      cache.set(car.id, model);
    }
    if (token !== loadToken) return; // el usuario ya eligió otro
    if (current) scene.remove(current);
    current = model;
    fade = reduce ? 1 : 0;
    setOpacity(current, fade);
    scene.add(current);
  }

  renderer.setAnimationLoop(() => {
    if (!visible) return;
    if (current && fade < 1) {
      fade = Math.min(1, fade + 0.06);
      setOpacity(current, fade);
    }
    controls.update();
    renderer.render(scene, camera);
  });

  return {
    show,
    dispose() {
      renderer.setAnimationLoop(null);
      ro.disconnect(); io.disconnect(); controls.dispose(); renderer.dispose(); draco.dispose();
      renderer.domElement.remove();
    },
  };
}
