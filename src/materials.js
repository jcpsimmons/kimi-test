import * as THREE from 'three';
import {
  makeFloorMaps, makeWallMaps, makeCeilingMaps, makeDoorMaps,
  makeArrowTexture, makeChevronTexture, makeGlowSprite, makeSignTexture,
} from './textures.js';

// Shared materials + custom shaders (hologram cores, volumetric light shafts,
// blinking rack LEDs, drifting dust). Emissive materials feed the bloom pass;
// metalness + the PMREM environment carry the PBR look.

// instancing-aware transform for custom ShaderMaterials used with InstancedMesh
const INSTANCED_VERT = `
  #ifdef USE_INSTANCING
    mat4 im = instanceMatrix;
  #else
    mat4 im = mat4(1.0);
  #endif
`;

export function makeMaterials(rng) {
  const floor = makeFloorMaps(rng);
  const walls = makeWallMaps(rng);
  const ceiling = makeCeilingMaps(rng);
  const door = makeDoorMaps();
  const glowSprite = makeGlowSprite();

  const mats = {};

  mats.floor = new THREE.MeshStandardMaterial({
    ...floor, metalness: 0.55, roughness: 1.0, envMapIntensity: 0.8,
    normalScale: new THREE.Vector2(0.8, 0.8),
  });
  mats.walls = walls.map((w) => new THREE.MeshStandardMaterial({
    ...w, metalness: 0.35, roughness: 1.0, envMapIntensity: 0.5,
    normalScale: new THREE.Vector2(0.7, 0.7),
  }));
  mats.ceiling = new THREE.MeshStandardMaterial({
    ...ceiling, metalness: 0.4, roughness: 0.8, envMapIntensity: 0.35,
  });

  mats.rackFrame = new THREE.MeshStandardMaterial({ color: 0x151b27, metalness: 0.8, roughness: 0.38, envMapIntensity: 1.2 });
  mats.rackBlade = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.65, roughness: 0.45, envMapIntensity: 0.9 });
  mats.conduit = new THREE.MeshStandardMaterial({ color: 0x2b3547, metalness: 0.8, roughness: 0.35, envMapIntensity: 1.0 });
  mats.beam = new THREE.MeshStandardMaterial({ color: 0x11161f, metalness: 0.6, roughness: 0.6, envMapIntensity: 0.5 });

  mats.baseStrip = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x35e0ff, emissiveIntensity: 1.8 });
  mats.diffuser = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xd6e8ff, emissiveIntensity: 1.9 });
  mats.fixture = new THREE.MeshStandardMaterial({ color: 0x141a24, metalness: 0.7, roughness: 0.5 });
  mats.door = new THREE.MeshStandardMaterial({ ...door, metalness: 0.75, roughness: 0.4, envMapIntensity: 1.0 });

  // blinking rack LEDs — instanceColor tint, per-instance blink phase attribute
  mats.led = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      attribute float blink;
      varying vec3 vColor;
      varying float vBlink;
      void main() {
        vBlink = blink;
        #ifdef USE_INSTANCING_COLOR
          vColor = instanceColor;
        #else
          vColor = vec3(1.0);
        #endif
        ${INSTANCED_VERT}
        gl_Position = projectionMatrix * modelViewMatrix * im * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float uTime;
      varying vec3 vColor;
      varying float vBlink;
      void main() {
        float on = step(0.35, fract(vBlink + uTime * 0.45));
        gl_FragColor = vec4(vColor * (0.15 + 1.6 * on), 1.0);
      }`,
  });

  // hologram shell for data cores (cloned per core for the phase uniform)
  mats.holoBase = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPhase: { value: 0 } },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vView;
      varying float vY;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        vY = position.y;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uTime;
      uniform float uPhase;
      varying vec3 vNormal;
      varying vec3 vView;
      varying float vY;
      void main() {
        float fres = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.0);
        float scan = 0.72 + 0.28 * sin(vY * 46.0 - uTime * 2.6 + uPhase);
        float pulse = 0.85 + 0.15 * sin(uTime * 2.0 + uPhase);
        vec3 col = mix(vec3(0.05, 0.5, 0.7), vec3(0.55, 0.97, 1.0), fres);
        gl_FragColor = vec4(col * (fres * 1.9 + 0.12) * scan * pulse, 1.0);
      }`,
  });

  // fake volumetric light shaft under ceiling fixtures (instanced cones)
  mats.shaft = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: `
      varying float vY;
      void main() {
        vY = position.y / 2.8 + 0.5; // 0 at floor end, 1 at fixture end
        ${INSTANCED_VERT}
        gl_Position = projectionMatrix * modelViewMatrix * im * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float uTime;
      varying float vY;
      void main() {
        float flick = 0.9 + 0.1 * sin(uTime * 9.0);
        float a = pow(vY, 1.8) * 0.055 * flick;
        gl_FragColor = vec4(vec3(0.62, 0.78, 1.0) * a, 1.0);
      }`,
  });

  // drifting dust motes (phase attribute drives per-particle wobble)
  mats.dust = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexShader: `
      attribute float phase;
      uniform float uTime;
      varying float vA;
      void main() {
        vec3 p = position;
        p.y += sin(uTime * 0.30 + phase) * 0.18;
        p.x += cos(uTime * 0.22 + phase * 1.7) * 0.12;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vA = 0.05 + 0.05 * sin(uTime * 0.5 + phase * 3.1);
        gl_PointSize = 2.4 * (1.0 / max(1.0, -mv.z)) * 3.0;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying float vA;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.1, length(d)) * vA;
        gl_FragColor = vec4(vec3(0.7, 0.85, 1.0) * a, 1.0);
      }`,
  });

  mats.arrowDecal = new THREE.MeshBasicMaterial({
    map: makeArrowTexture(), transparent: true, color: 0xffb43c, opacity: 0.85,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
  });
  mats.chevron = new THREE.MeshBasicMaterial({
    map: makeChevronTexture(), transparent: true, color: 0xffffff, opacity: 0.9,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
  });
  mats.sign = new THREE.MeshBasicMaterial({ map: makeSignTexture('FREIGHT ELEVATOR'), transparent: false });

  mats.droneBody = new THREE.MeshPhysicalMaterial({
    color: 0x2a3344, metalness: 0.85, roughness: 0.28,
    clearcoat: 0.6, clearcoatRoughness: 0.3, envMapIntensity: 1.4,
  });
  mats.canister = new THREE.MeshStandardMaterial({ color: 0x3a4356, metalness: 0.8, roughness: 0.3, envMapIntensity: 1.2 });
  mats.canisterRing = new THREE.MeshBasicMaterial({ color: 0x35e0ff });

  mats.glowSprite = glowSprite;
  return mats;
}
