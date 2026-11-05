/**
 * Bay: a dual-rail isometric server chassis with an open BYOS expansion tray
 * awaiting an agent server connection. The pointer's height slides the tray
 * out on spring dampers.
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
  mk,
  open,
  pointer,
  poly,
  put,
  register,
  disposer,
  ringAt,
  run,
  solid,
  seg,
} = HL;

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  const C = Cam(45, 0.5, 1.85);

  // Chassis bounds + extension range
  fit(
    C,
    [
      [-36, -36, -4],
      [36, 36, -4],
      [-36, 36, -4],
      [36, -36, -4],
      [-36, -36, 44],
      [46, 46, 44],
    ],
    200,
    166,
  );

  const P = proj(C),
    front = facing(C);
  const g = mk("g", {}, svg);

  // --- 1. Chassis Outer Enclosure (Base & Walls) ---
  // Lower chassis bed / baseplate
  const [baseRing, baseInner] = rings(-34, -34, 26, 26, 8, 1.6);
  const baseSolid = solid(g);
  put(baseSolid, prism(P, front, baseRing, baseInner, -4, 4));

  // Left & Right rack mount ears
  const [lEarRing, lEarInner] = rings(-38, 20, -32, 28, 2, 0.8);
  const lEarSolid = solid(g);
  put(lEarSolid, prism(P, front, lEarRing, lEarInner, 4, 32));

  const [rEarRing, rEarInner] = rings(20, -38, 28, -32, 2, 0.8);
  const rEarSolid = solid(g);
  put(rEarSolid, prism(P, front, rEarRing, rEarInner, 4, 32));

  // Outer chassis housing walls (back and side hood)
  const [hoodRing, hoodInner] = rings(-32, -32, 18, 18, 7, 1.8);
  const hoodSolid = solid(g);
  put(hoodSolid, prism(P, front, hoodRing, hoodInner, 4, 36));

  // Dashed connector bus guide at rear inside backplane
  const guidePath = mk(
    "path",
    { class: "dash", d: seg(P(-18, -18, 10), P(4, 4, 10)) },
    g,
  );

  // --- 2. Dual Slide Rails (Fixed on outer frame) ---
  const [rail1Ring, rail1Inner] = rings(-26, 17, 24, 22, 2, 0.7);
  const rail1Solid = solid(g);
  put(rail1Solid, prism(P, front, rail1Ring, rail1Inner, 10, 15));

  const [rail2Ring, rail2Inner] = rings(17, -26, 22, 24, 2, 0.7);
  const rail2Solid = solid(g);
  put(rail2Solid, prism(P, front, rail2Ring, rail2Inner, 10, 15));

  // --- 3. Sliding BYOS Expansion Tray ---
  const traySolid = solid(g);

  // Bus Terminal Socket (rear socket on tray bed)
  const terminalSolid = solid(g);
  terminalSolid.sil.classList.add("hi"); // Accent at rest

  // Front Pull Latch / Release Handle
  const latchSolid = solid(g);

  // Spring damper for tray slide extension: rest at 14 (partially open)
  const spSlide = spring(14, { k: 75, c: 15 });
  let intensity = value;
  let over = null;

  function drawTray() {
    const s = spSlide.x * intensity;
    const tx = s * 0.707;
    const ty = s * 0.707;

    // Tray body
    const [tRing, tInner] = rings(-20 + tx, -20 + ty, 20 + tx, 20 + ty, 5, 1.4);
    put(traySolid, prism(P, front, tRing, tInner, 8, 16));

    // Rear bus terminal socket (where server connects)
    const [bRing, bInner] = rings(
      -16 + tx,
      -16 + ty,
      -6 + tx,
      -6 + ty,
      2.5,
      0.8,
    );
    put(terminalSolid, prism(P, front, bRing, bInner, 16, 23));

    // Front latch on tray face
    const [lRing, lInner] = rings(18 + tx, 18 + ty, 25 + tx, 25 + ty, 2, 0.6);
    put(latchSolid, prism(P, front, lRing, lInner, 10, 18));
  }

  drawTray();

  const B = register(stage, (dt) => {
    const moving = stepS(spSlide, dt);
    drawTray();
    return moving;
  });
  bag.add(B.unregister);

  function retarget() {
    if (!over) {
      spSlide.t = 14;
      read.textContent = "bay 1 · empty";
      terminalSolid.sil.classList.add("hi");
      latchSolid.sil.classList.remove("hi");
      rail1Solid.sil.classList.remove("hi");
    } else {
      // Pointer height (sy) or position extends/retracts tray
      const targetSlide = clamp(8 + (over[0] + over[1]) * 0.5, 2, 28);
      spSlide.t = targetSlide;

      const dTerminal = Math.hypot(
        over[0] - (-11 + spSlide.x * 0.707),
        over[1] - (-11 + spSlide.x * 0.707),
      );
      const dLatch = Math.hypot(
        over[0] - (21 + spSlide.x * 0.707),
        over[1] - (21 + spSlide.x * 0.707),
      );
      const dRail = Math.min(
        Math.hypot(over[0] - 0, over[1] - 20),
        Math.hypot(over[0] - 20, over[1] - 0),
      );

      if (dLatch < 14) {
        read.textContent = "latch · release";
        latchSolid.sil.classList.add("hi");
        terminalSolid.sil.classList.remove("hi");
        rail1Solid.sil.classList.remove("hi");
      } else if (dTerminal < 15) {
        read.textContent = "bus terminal · open";
        terminalSolid.sil.classList.add("hi");
        latchSolid.sil.classList.remove("hi");
        rail1Solid.sil.classList.remove("hi");
      } else if (dRail < 18) {
        read.textContent = "slide rail · 1";
        rail1Solid.sil.classList.add("hi");
        terminalSolid.sil.classList.remove("hi");
        latchSolid.sil.classList.remove("hi");
      } else {
        read.textContent = "bay 1 · open";
        terminalSolid.sil.classList.add("hi");
        latchSolid.sil.classList.remove("hi");
        rail1Solid.sil.classList.remove("hi");
      }
    }
    B.wake();
  }

  bag.add(
    pointer(stage, {
      move: (p) => {
        over = unproj(C, p[0], p[1], 12);
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
  name: "bay",
  means:
    "A dual-rail server chassis slides its BYOS expansion tray out on spring dampers to receive an agent connection.",
  rules: [1, 3, 5, 9],
  range: [0.5, 1, 1.8],
  tour: [[162, 185], [194, 152], [240, 202], null],
  mount,
});
