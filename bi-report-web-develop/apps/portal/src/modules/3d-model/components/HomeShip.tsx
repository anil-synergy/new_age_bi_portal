"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
// Served from public/ so no bundler loader is needed (Turbopack ignores webpack rules).
const shipUrl = "/models/Meshy_AI_Ivory_Voyager_1019163912_texture.glb";
import type { ShipSceneEnvironment, ShipSceneEnvironmentFactory } from "../types";

interface HomeShipProps {
  /** Optional scene decoration (see ../types.ts). Without it the ship renders exactly as before. */
  environment?: ShipSceneEnvironmentFactory;
  onEnvironmentReady?: (env: ShipSceneEnvironment) => void;
}

export function HomeShip({ environment, onEnvironmentReady }: HomeShipProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = canvas?.parentElement;
    if (!canvas || !stage) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    // A full-screen sea is fill-rate heavy, so the decorated scene caps the pixel ratio lower.
    let pixelRatio = Math.min(window.devicePixelRatio || 1, environment ? 1.5 : 2);
    renderer.setPixelRatio(pixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(1.15, 1.55, 6.6);
    camera.lookAt(0.1, -0.2, 0);

    const hemi = new THREE.HemisphereLight(0xe7f1ff, 0x8aa4c8, 1.15);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff4e4, 2.4);
    sun.position.set(-3.2, 5, 4);
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0xb9d4ff, 1.5);
    rim.position.set(4, 2, -3);
    scene.add(rim);

    const pivot = new THREE.Group();
    scene.add(pivot);

    const env = environment?.({ scene, camera, renderer, lights: { hemi, sun, rim }, reducedMotion: reduced });
    if (env) onEnvironmentReady?.(env);

    const target = { x: 0, y: 0 };
    const look = { x: 0, y: 0 };
    const velocity = { x: 0, y: 0 };
    let frame = 0;
    let stopped = false;

    const layout = () => {
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      if (width < 2 || height < 2) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      const mobile = width < 720;
      const fit = mobile ? 0.72 : Math.min(1, Math.max(0.82, camera.aspect / 1.6));
      pivot.scale.setScalar(fit);
      env?.onResize(width, height);
    };

    const onPointer = (event: PointerEvent) => {
      const rect = stage.getBoundingClientRect();
      const clamp = (value: number) => Math.max(-1, Math.min(1, value));
      target.x = clamp(((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1);
      target.y = clamp(-(((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1));
    };
    const onLeave = () => {
      target.x = 0;
      target.y = 0;
    };

    // Critically damped spring: eases in and out like an After Effects easy-ease, never overshoots.
    const smoothTime = reduced ? 0.12 : 0.55;
    const damp = (current: number, goal: number, axis: "x" | "y", dt: number) => {
      const omega = 2 / smoothTime;
      const x = omega * dt;
      const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
      const change = current - goal;
      const temp = (velocity[axis] + omega * change) * dt;
      velocity[axis] = (velocity[axis] - omega * temp) * decay;
      return goal + (change + temp) * decay;
    };

    const clock = new THREE.Clock();
    let slowFrames = 0;
    const render = () => {
      if (stopped) return;
      frame = window.requestAnimationFrame(render);
      const rawDelta = clock.getDelta();
      const dt = Math.min(rawDelta, 1 / 30);
      look.x = damp(look.x, target.x, "x", dt);
      look.y = damp(look.y, target.y, "y", dt);
      pivot.position.set(0, 0, 0);
      pivot.rotation.set(-look.y * 0.07, look.x * 0.32, 0);
      if (env) {
        env.update(dt);
        // Adaptive quality: if a modest laptop GPU struggles, drop to 1x pixel ratio once.
        if (pixelRatio > 1 && rawDelta > 1 / 34 && rawDelta < 0.25) slowFrames += 1;
        else if (slowFrames > 0) slowFrames -= 1;
        if (slowFrames > 90) {
          pixelRatio = 1;
          renderer.setPixelRatio(1);
          layout();
          slowFrames = 0;
        }
      }
      renderer.render(scene, camera);
    };

    // Stop rendering entirely while the tab is hidden and resume without a time jump.
    const onVisibility = () => {
      if (stopped) return;
      window.cancelAnimationFrame(frame);
      if (document.hidden) return;
      clock.getDelta();
      frame = window.requestAnimationFrame(render);
    };

    const loader = new GLTFLoader();
    loader.load(shipUrl, (gltf) => {
      const model = gltf.scene;
      const bounds = new THREE.Box3().setFromObject(model);
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      model.position.sub(center);
      const holder = new THREE.Group();
      const longest = Math.max(size.x, size.y, size.z) || 1;
      holder.scale.setScalar(4.4 / longest);
      holder.rotation.y = Math.PI * 0.75;
      holder.add(model);
      model.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          const shaded = material as THREE.MeshStandardMaterial;
          if ("envMapIntensity" in shaded) shaded.envMapIntensity = 0.75;
          if (shaded.map) shaded.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
        }
      });
      pivot.add(holder);
      layout();
      pivot.updateMatrixWorld(true);
      env?.onShipReady(holder);
      canvas.classList.add("is-ready");
    });

    layout();
    const observer = new ResizeObserver(layout);
    observer.observe(stage);
    stage.addEventListener("pointermove", onPointer);
    stage.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", onVisibility);
    frame = window.requestAnimationFrame(render);

    return () => {
      stopped = true;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      stage.removeEventListener("pointermove", onPointer);
      stage.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      env?.dispose();
      pivot.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry?.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((material) => material?.dispose());
      });
      scene.environment?.dispose();
      pmrem.dispose();
      renderer.dispose();
    };
    // The environment factory is read once at mount, like the rest of the scene set-up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-label="Ivory voyager ship following the cursor"
      className="absolute inset-0 block h-full w-full opacity-0 transition-opacity duration-1000 [&.is-ready]:opacity-100"
    />
  );
}
