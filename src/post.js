import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { RENDER } from './config.js';

// HDR pipeline: linear render -> bloom -> tone-mapped sRGB output (ACES) -> FXAA.
// NOTE: no multisampled render target — MSAA HalfFloat targets fail to resolve
// on some real GPUs (black screen on Metal/ANGLE; swiftshader masks the bug).
// FXAA at the end of the chain handles edge smoothing instead.
export function createPost(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(size, RENDER.bloom.strength, RENDER.bloom.radius, RENDER.bloom.threshold);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const fxaa = new ShaderPass(FXAAShader);
  const pr = renderer.getPixelRatio();
  fxaa.material.uniforms.resolution.value.set(1 / (size.x * pr), 1 / (size.y * pr));
  composer.addPass(fxaa);
  return {
    composer,
    bloom,
    setSize(w, h) {
      composer.setSize(w, h);
      fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
    },
  };
}
