/**
 * Core: a compact robotic agent capsule with a rounded visor and floating
 * telemetry rings over a hover plinth. The pointer aims the visor and tilts
 * the telemetry rings on soft springs.
 */
const {
  Cam,
  clamp,
  facing,
  fit,
  prism,
  proj,
  rings,
  unproj,
  spring,
  stepS,
  circ,
  mk,
  open,
  place,
  pointer,
  poly,
  put,
  register,
  disposer,
  ringAt,
  run,
  solid,
} = HL;

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  const C = Cam(45, 0.5, 1.85);

  // Fit camera box so figure is centered near (200, 166)
  fit(
    C,
    [
      [-34, -34, -14],
      [34, 34, -14],
      [-34, 34, -14],
      [34, -34, -14],
      [-22, -22, 66],
      [22, 22, 66],
    ],
    200,
    166,
  );

  const P = proj(C),
    front = facing(C);
  const g = mk("g", {}, svg);

  // --- 1. Dock Base (Plinth) ---
  // Lower wide plinth
  const [bRing, bInner] = rings(-30, -30, 30, 30, 12, 1.8);
  const baseSolid = solid(g);
  put(baseSolid, prism(P, front, bRing, bInner, -14, -6));

  // Upper collar plinth
  const [cRing, cInner] = rings(-22, -22, 22, 22, 9, 1.5);
  const collarSolid = solid(g);
  put(collarSolid, prism(P, front, cRing, cInner, -6, 0));

  // --- 2. Floating Telemetry Rings ---
  // Lower signal ring
  const [r1Ring, r1Inner] = rings(-18, -18, 18, 18, 8, 1.2);
  const ring1Solid = solid(g);

  // Upper signal ring
  const [r2Ring, r2Inner] = rings(-15, -15, 15, 15, 7, 1.2);
  const ring2Solid = solid(g);

  // --- 3. Agent Capsule Body ---
  const [capRing, capInner] = rings(-14, -14, 14, 14, 6.5, 1.4);
  const capSolid = solid(g);
  put(capSolid, prism(P, front, capRing, capInner, 18, 52));

  // Dome cap on top
  const [domeRing, domeInner] = rings(-10, -10, 10, 10, 5, 1.2);
  const domeSolid = solid(g);
  put(domeSolid, prism(P, front, domeRing, domeInner, 52, 60));

  // --- 4. Visor on Front Face ---
  // The visor sits on the front face (x + y facing camera)
  const visorSolid = solid(g);
  visorSolid.sil.classList.add("hi"); // Accent at rest

  // Springs for visor direction and ring tilt
  const spX = spring(0.3, { k: 90, c: 16 });
  const spY = spring(0.2, { k: 90, c: 16 });
  const spTilt = spring(0, { k: 80, c: 14 });

  let intensity = value;
  let over = null;

  function drawRings() {
    const tilt = spTilt.x * intensity;
    const z1 = 6 + tilt * 2;
    const z2 = 12 - tilt * 1.5;
    put(ring1Solid, prism(P, front, r1Ring, r1Inner, z1, z1 + 2.5));
    put(ring2Solid, prism(P, front, r2Ring, r2Inner, z2, z2 + 2.5));
  }

  function drawVisor() {
    // Visor moves subtly on the capsule face based on pointer angle
    const vx = spX.x * 4 * intensity;
    const vy = spY.x * 4 * intensity;
    // Front corner visor positioned around (8, 8, 34)
    const [vRing, vInner] = rings(4 + vx, 4 + vy, 15 + vx, 15 + vy, 4.5, 0.8);
    put(visorSolid, prism(P, front, vRing, vInner, 32, 42));
  }

  // Initial draw
  drawRings();
  drawVisor();

  const B = register(stage, (dt) => {
    const m1 = stepS(spX, dt);
    const m2 = stepS(spY, dt);
    const m3 = stepS(spTilt, dt);
    drawRings();
    drawVisor();
    return m1 || m2 || m3;
  });
  bag.add(B.unregister);

  function retarget() {
    if (!over) {
      spX.t = 0.3;
      spY.t = 0.2;
      spTilt.t = 0;
      read.textContent = "agent · idle 0.0";
      visorSolid.sil.classList.add("hi");
      ring2Solid.sil.classList.remove("hi");
      baseSolid.sil.classList.remove("hi");
    } else {
      const d = Math.hypot(over[0], over[1]);
      const nx = d > 0.001 ? over[0] / d : 0;
      const ny = d > 0.001 ? over[1] / d : 0;
      spX.t = clamp(nx, -1, 1);
      spY.t = clamp(ny, -1, 1);
      spTilt.t = clamp(d / 40, -1.2, 1.2);

      // Identify part under pointer
      if (d < 18) {
        read.textContent = "visor · track";
        visorSolid.sil.classList.add("hi");
        ring2Solid.sil.classList.remove("hi");
        baseSolid.sil.classList.remove("hi");
      } else if (d < 28) {
        read.textContent = "status ring";
        visorSolid.sil.classList.remove("hi");
        ring2Solid.sil.classList.add("hi");
        baseSolid.sil.classList.remove("hi");
      } else {
        read.textContent = "dock base";
        visorSolid.sil.classList.remove("hi");
        ring2Solid.sil.classList.remove("hi");
        baseSolid.sil.classList.add("hi");
      }
    }
    B.wake();
  }

  bag.add(
    pointer(stage, {
      move: (p) => {
        over = unproj(C, p[0], p[1], 20);
        retarget();
      },
      leave: () => {
        over = null;
        retarget();
      },
    }),
  );

  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => {
      intensity = v;
      if (over) retarget();
    },
    destroy: bag.dispose,
  };
}

hairline({
  name: "core",
  means:
    "A robotic agent capsule swivels its visor and tilts its telemetry rings toward the pointer over a hover plinth.",
  rules: [1, 4, 5, 9],
  range: [0.5, 1, 1.8],
  tour: [[200, 126], [228, 154], [165, 208], null],
  mount,
});
