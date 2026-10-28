"use client";

import React, { useRef, useEffect, useState } from "react";

// --- Mathematical and Isometric Engine Constants & Helpers ---
const LIGHT = {
  plate: "#ffffff",
  hi: "#18181b",
  edge: "#a1a1aa",
  mid: "#d4d4d8",
  lo: "#e4e4e7",
};
const DARK = {
  plate: "#09090b",
  hi: "#f4f4f5",
  edge: "#71717a",
  mid: "#3f3f46",
  lo: "#27272a",
};
const EASE = "cubic-bezier(0.5, 0, 0.1, 1)";

function injectHairlineStyles(doc: Document) {
  if (doc.querySelector("style[data-catelog-hairline]")) return;
  const style = doc.createElement("style");
  style.setAttribute("data-catelog-hairline", "");
  style.textContent = `
    :where([data-hairline="core"]){
      display: block;
      position: relative;
      aspect-ratio: 5 / 4;
      touch-action: pan-y;
      user-select: none;
      -webkit-user-select: none;
      --hl-sw: 1.1;
      --hl-plate: ${LIGHT.plate};
      --hl-hi: ${LIGHT.hi};
      --hl-edge: ${LIGHT.edge};
      --hl-mid: ${LIGHT.mid};
      --hl-lo: ${LIGHT.lo};
    }
    :where(.dark, [data-theme="dark"]) :where([data-hairline="core"]){
      --hl-plate: ${DARK.plate};
      --hl-hi: ${DARK.hi};
      --hl-edge: ${DARK.edge};
      --hl-mid: ${DARK.mid};
      --hl-lo: ${DARK.lo};
    }
    :where([data-hairline="core"] > svg){
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      display: block;
      overflow: visible;
    }
    :where([data-hairline="core"] > svg) :where(path, polygon, ellipse, line){
      fill: var(--hl-plate);
      stroke: var(--hl-mid);
      stroke-width: var(--hl-sw);
      vector-effect: non-scaling-stroke;
      stroke-linejoin: round;
      stroke-linecap: round;
      transition: stroke 240ms ${EASE};
    }
    :where([data-hairline="core"] > svg) :where(.sil){ stroke: var(--hl-edge); }
    :where([data-hairline="core"] > svg) :where(.hi){ stroke: var(--hl-hi); }
    :where([data-hairline="core"] > svg) :where(.lo){ stroke: var(--hl-lo); }
  `;
  doc.head.appendChild(style);
}

// Geometric transforms
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const rad = (d: number) => (d * Math.PI) / 180;
const r2 = (n: number) => Math.round(n * 100) / 100;
const poly = (pts: [number, number][]) =>
  "M" + pts.map((p) => r2(p[0]) + " " + r2(p[1])).join("L") + "Z";
const open = (pts: [number, number][]) =>
  pts.length < 2 ? "" : "M" + pts.map((p) => r2(p[0]) + " " + r2(p[1])).join("L");

interface Camera {
  az: number;
  k: number;
  S: number;
  ox: number;
  oy: number;
}

function Cam(azDeg: number, k: number, S: number): Camera {
  return { az: rad(azDeg), k, S, ox: 0, oy: 0 };
}

function fit(C: Camera, pts: [number, number, number][], cx: number, cy: number) {
  const c = Math.cos(C.az),
    s = Math.sin(C.az),
    zf = Math.sqrt(1 - C.k * C.k);
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const [x, y, z] of pts) {
    const X = x * c - y * s,
      Y = x * s + y * c;
    const sx = C.S * X,
      sy = C.S * (Y * C.k - z * zf);
    if (sx < minX) minX = sx;
    if (sx > maxX) maxX = sx;
    if (sy < minY) minY = sy;
    if (sy > maxY) maxY = sy;
  }
  C.ox = cx - (minX + maxX) / 2;
  C.oy = cy - (minY + maxY) / 2;
}

function proj(C: Camera) {
  const c = Math.cos(C.az),
    s = Math.sin(C.az),
    zf = Math.sqrt(1 - C.k * C.k);
  return (x: number, y: number, z: number): [number, number] => {
    const X = x * c - y * s,
      Y = x * s + y * c;
    return [C.ox + C.S * X, C.oy + C.S * (Y * C.k - z * zf)];
  };
}

function unproj(C: Camera, sx: number, sy: number, z: number): [number, number] {
  const c = Math.cos(C.az),
    s = Math.sin(C.az),
    zf = Math.sqrt(1 - C.k * C.k);
  const X = (sx - C.ox) / C.S,
    Y = ((sy - C.oy) / C.S + z * zf) / C.k;
  return [X * c + Y * s, -X * s + Y * c];
}

interface Sample {
  u: number;
  v: number;
  nu: number;
  nv: number;
}

function facing(C: Camera) {
  const c = Math.cos(C.az),
    s = Math.sin(C.az);
  return (sample: Sample) => (sample.nu * s + sample.nv * c) * C.k > 0;
}

function rrect(
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  r: number,
  n = 4
): Sample[] {
  r = Math.min(r, (u1 - u0) / 2, (v1 - v0) / 2);
  const pts: Sample[] = [];
  const corners: [number, number, number, number][] = [
    [u1 - r, v1 - r, 0, 1],
    [u0 + r, v1 - r, -1, 0],
    [u0 + r, v0 + r, 0, -1],
    [u1 - r, v0 + r, 1, 0],
  ];
  for (let c = 0; c < 4; c++) {
    const [cx, cy, ox, oy] = corners[c];
    const baseAng = (c * Math.PI) / 2;
    for (let i = 0; i < n; i++) {
      const a = baseAng + (i / n) * (Math.PI / 2);
      const cos = Math.cos(a),
        sin = Math.sin(a);
      pts.push({ u: cx + cos * r, v: cy + sin * r, nu: cos, nv: sin });
    }
  }
  return pts;
}

function rings(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
  b: number
): [Sample[], Sample[]] {
  return [
    rrect(x0, y0, x1, y1, r, 4),
    rrect(x0 + b, y0 + b, x1 - b, y1 - b, Math.max(0.5, r - b), 4),
  ];
}

function hull(pts: [number, number][]): [number, number][] {
  if (pts.length <= 2) return pts.slice();
  const sorted = pts
    .slice()
    .sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function ringAt(
  P: (x: number, y: number, z: number) => [number, number],
  ring: Sample[],
  z: number
): [number, number][] {
  return ring.map((s) => P(s.u, s.v, z));
}

function run(ring: Sample[], keep: (s: Sample) => boolean): Sample[] {
  const n = ring.length;
  let start = -1;
  for (let i = 0; i < n; i++) {
    if (keep(ring[i]) && !keep(ring[(i - 1 + n) % n])) {
      start = i;
      break;
    }
  }
  if (start < 0) return ring.filter(keep);
  const res: Sample[] = [];
  for (let k = 0; k < n; k++) {
    const s = ring[(start + k) % n];
    if (keep(s)) res.push(s);
    else break;
  }
  return res;
}

function prism(
  P: (x: number, y: number, z: number) => [number, number],
  front: (s: Sample) => boolean,
  ring: Sample[],
  inner: Sample[],
  z0: number,
  z1: number
) {
  const r0 = ringAt(P, ring, z0);
  const r1 = ringAt(P, ring, z1);
  const sil = poly(hull(r0.concat(r1)));
  const crease = open(ringAt(P, run(inner, front), z1));
  return { sil, crease };
}

// Spring Dynamics
interface Spring {
  x: number;
  v: number;
  t: number;
  k: number;
  c: number;
  eps: number;
}

function spring(init: number, opts: { k?: number; c?: number; eps?: number } = {}): Spring {
  return {
    x: init,
    v: 0,
    t: init,
    k: opts.k ?? 90,
    c: opts.c ?? 16,
    eps: opts.eps ?? 0.001,
  };
}

function stepS(sp: Spring, dt: number): boolean {
  const steps = 4;
  const subDt = dt / steps;
  for (let i = 0; i < steps; i++) {
    const f = -sp.k * (sp.x - sp.t) - sp.c * sp.v;
    sp.v += f * subDt;
    sp.x += sp.v * subDt;
  }
  return Math.abs(sp.x - sp.t) > sp.eps || Math.abs(sp.v) > sp.eps;
}

export function CatelogAgentCore({ className = "" }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [readText, setReadText] = useState("agent · idle 0.0");

  useEffect(() => {
    const stage = containerRef.current;
    if (!stage) return;

    injectHairlineStyles(stage.ownerDocument);
    stage.setAttribute("data-hairline", "core");

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 400 320");
    svg.setAttribute("aria-hidden", "true");
    stage.appendChild(svg);

    const C = Cam(45, 0.5, 1.85);
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
      166
    );

    const P = proj(C);
    const front = facing(C);

    function createSolid(parent: Element) {
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      const sil = document.createElementNS("http://www.w3.org/2000/svg", "path");
      sil.setAttribute("class", "sil");
      const cr = document.createElementNS("http://www.w3.org/2000/svg", "path");
      cr.setAttribute("class", "lo");
      g.appendChild(sil);
      g.appendChild(cr);
      parent.appendChild(g);
      return { g, sil, cr };
    }

    function putSolid(
      s: { sil: SVGPathElement; cr: SVGPathElement },
      p: { sil: string; crease: string }
    ) {
      s.sil.setAttribute("d", p.sil);
      s.cr.setAttribute("d", p.crease);
    }

    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    svg.appendChild(g);

    // 1. Dock Base (Plinth)
    const [bRing, bInner] = rings(-30, -30, 30, 30, 12, 1.8);
    const baseSolid = createSolid(g);
    putSolid(baseSolid, prism(P, front, bRing, bInner, -14, -6));

    const [cRing, cInner] = rings(-22, -22, 22, 22, 9, 1.5);
    const collarSolid = createSolid(g);
    putSolid(collarSolid, prism(P, front, cRing, cInner, -6, 0));

    // 2. Floating Telemetry Rings
    const [r1Ring, r1Inner] = rings(-18, -18, 18, 18, 8, 1.2);
    const ring1Solid = createSolid(g);

    const [r2Ring, r2Inner] = rings(-15, -15, 15, 15, 7, 1.2);
    const ring2Solid = createSolid(g);

    // 3. Agent Capsule Body
    const [capRing, capInner] = rings(-14, -14, 14, 14, 6.5, 1.4);
    const capSolid = createSolid(g);
    putSolid(capSolid, prism(P, front, capRing, capInner, 18, 52));

    const [domeRing, domeInner] = rings(-10, -10, 10, 10, 5, 1.2);
    const domeSolid = createSolid(g);
    putSolid(domeSolid, prism(P, front, domeRing, domeInner, 52, 60));

    // 4. Visor
    const visorSolid = createSolid(g);
    visorSolid.sil.classList.add("hi");

    const spX = spring(0.3, { k: 90, c: 16 });
    const spY = spring(0.2, { k: 90, c: 16 });
    const spTilt = spring(0, { k: 80, c: 14 });

    function drawRings() {
      const tilt = spTilt.x;
      const z1 = 6 + tilt * 2;
      const z2 = 12 - tilt * 1.5;
      putSolid(ring1Solid, prism(P, front, r1Ring, r1Inner, z1, z1 + 2.5));
      putSolid(ring2Solid, prism(P, front, r2Ring, r2Inner, z2, z2 + 2.5));
    }

    function drawVisor() {
      const vx = spX.x * 4;
      const vy = spY.x * 4;
      const [vRing, vInner] = rings(4 + vx, 4 + vy, 15 + vx, 15 + vy, 4.5, 0.8);
      putSolid(visorSolid, prism(P, front, vRing, vInner, 32, 42));
    }

    drawRings();
    drawVisor();

    let animId: number;
    let lastTime = performance.now();

    function tick(now: number) {
      const dt = clamp((now - lastTime) / 1000, 0.001, 0.05);
      lastTime = now;
      const m1 = stepS(spX, dt);
      const m2 = stepS(spY, dt);
      const m3 = stepS(spTilt, dt);
      drawRings();
      drawVisor();
      if (m1 || m2 || m3) {
        animId = requestAnimationFrame(tick);
      }
    }

    function wake() {
      cancelAnimationFrame(animId);
      lastTime = performance.now();
      animId = requestAnimationFrame(tick);
    }

    function onPointerMove(e: PointerEvent) {
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * 400;
      const py = ((e.clientY - rect.top) / rect.height) * 320;
      const world = unproj(C, px, py, 20);

      const d = Math.hypot(world[0], world[1]);
      const nx = d > 0.001 ? world[0] / d : 0;
      const ny = d > 0.001 ? world[1] / d : 0;

      spX.t = clamp(nx, -1, 1);
      spY.t = clamp(ny, -1, 1);
      spTilt.t = clamp(d / 40, -1.2, 1.2);

      if (d < 18) {
        setReadText("visor · track");
        visorSolid.sil.classList.add("hi");
        ring2Solid.sil.classList.remove("hi");
        baseSolid.sil.classList.remove("hi");
      } else if (d < 28) {
        setReadText("status ring");
        visorSolid.sil.classList.remove("hi");
        ring2Solid.sil.classList.add("hi");
        baseSolid.sil.classList.remove("hi");
      } else {
        setReadText("dock base");
        visorSolid.sil.classList.remove("hi");
        ring2Solid.sil.classList.remove("hi");
        baseSolid.sil.classList.add("hi");
      }
      wake();
    }

    function onPointerLeave() {
      spX.t = 0.3;
      spY.t = 0.2;
      spTilt.t = 0;
      setReadText("agent · idle 0.0");
      visorSolid.sil.classList.add("hi");
      ring2Solid.sil.classList.remove("hi");
      baseSolid.sil.classList.remove("hi");
      wake();
    }

    stage.addEventListener("pointermove", onPointerMove);
    stage.addEventListener("pointerleave", onPointerLeave);

    return () => {
      cancelAnimationFrame(animId);
      stage.removeEventListener("pointermove", onPointerMove);
      stage.removeEventListener("pointerleave", onPointerLeave);
      stage.innerHTML = "";
    };
  }, []);

  return (
    <div className={`relative flex flex-col items-center select-none ${className}`}>
      {/* Live Readout Pill */}
      <span className="mb-2 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border border-border/60 bg-muted/40 text-[10px] font-mono text-muted-foreground tabular-nums">
        <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
        {readText}
      </span>

      {/* Hairline Stage */}
      <div ref={containerRef} className="w-full cursor-crosshair" />
    </div>
  );
}
