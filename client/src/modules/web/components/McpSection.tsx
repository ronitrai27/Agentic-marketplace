"use client";

import React from "react";
import { motion } from "framer-motion";
import { Coins, Layers, Sparkles } from "lucide-react";

/* ---------- isometric helpers ---------- */
const S = 38;
const CX = 400;
const CY = 330;
const COS = 0.866;

type V3 = [number, number, number];
const P = ([x, y, z]: V3): string =>
  `${(CX + (x - y) * COS * S).toFixed(1)},${(CY + (x + y) * 0.5 * S - z * S).toFixed(1)}`;
const poly = (pts: V3[]) => pts.map(P).join(" ");
const sx = ([x, y, z]: V3) => CX + (x - y) * COS * S;
const sy = ([x, y, z]: V3) => CY + (x + y) * 0.5 * S - z * S;

const PAL = ["#ede9fe", "#c4b5fd", "#ddd6fe", "#a78bfa", "#f5f3ff", "#b8a8fb"];
const INK = "#241f4a";

/* ---------- cube ---------- */
function Cube({
  n = 3,
  h = 3,
  c = [0, 0] as [number, number],
  z0 = 0,
  cells = true,
}: {
  n?: number;
  h?: number;
  c?: [number, number];
  z0?: number;
  cells?: boolean;
}) {
  const half = n / 2;
  const x0 = c[0] - half,
    x1 = c[0] + half;
  const y0 = c[1] - half,
    y1 = c[1] + half;
  const z1 = z0 + h;
  const out: React.ReactNode[] = [];
  const cw = cells ? 1 : n;
  const ch = cells ? 1 : h;
  const nx = Math.round(n / cw);
  const nz = Math.round(h / ch);

  // top
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nx; j++) {
      const a = x0 + i * cw,
        b = y0 + j * cw;
      out.push(
        <polygon
          key={`t${i}${j}`}
          points={poly([
            [a, b, z1],
            [a + cw, b, z1],
            [a + cw, b + cw, z1],
            [a, b + cw, z1],
          ])}
          fill={PAL[(i * 2 + j * 3) % PAL.length]}
          stroke={INK}
          strokeWidth="1"
          strokeLinejoin="round"
        />,
      );
    }
  // left-front (y = y1)
  for (let i = 0; i < nx; i++)
    for (let k = 0; k < nz; k++) {
      const a = x0 + i * cw,
        z = z0 + k * ch;
      out.push(
        <polygon
          key={`l${i}${k}`}
          points={poly([
            [a, y1, z],
            [a + cw, y1, z],
            [a + cw, y1, z + ch],
            [a, y1, z + ch],
          ])}
          fill={PAL[(i + k * 2 + 1) % PAL.length]}
          stroke={INK}
          strokeWidth="1"
          strokeLinejoin="round"
        />,
      );
    }
  // right-front (x = x1)
  for (let j = 0; j < nx; j++)
    for (let k = 0; k < nz; k++) {
      const b = y0 + j * cw,
        z = z0 + k * ch;
      out.push(
        <polygon
          key={`r${j}${k}`}
          points={poly([
            [x1, b, z],
            [x1, b + cw, z],
            [x1, b + cw, z + ch],
            [x1, b, z + ch],
          ])}
          fill={PAL[(j * 2 + k + 3) % PAL.length]}
          stroke={INK}
          strokeWidth="1"
          strokeLinejoin="round"
        />,
      );
    }
  return <g>{out}</g>;
}

/* ---------- node tile with logo ---------- */
type Node = {
  x: number;
  y: number;
  src: string;
  dark?: boolean;
  n: string;
  wp: [number, number][];
};

function Tile({ x, y, src, dark }: Node) {
  const w = 1.8;
  const h = 0.45;
  const top = h;
  const ctr: V3 = [x, y, top];
  const m = `matrix(${COS * S} ${0.5 * S} ${-COS * S} ${0.5 * S} ${sx(ctr)} ${sy(ctr)})`;
  return (
    <g>
      {/* shadow */}
      <polygon
        points={poly([
          [x - w / 2 + 0.3, y + w / 2 + 0.3, 0],
          [x + w / 2 + 0.5, y + w / 2 + 0.5, 0],
          [x + w / 2 + 0.5, y - w / 2 + 0.3, 0],
          [x - w / 2 + 0.3, y - w / 2 + 0.3, 0],
        ])}
        fill="#1b1740"
        opacity="0.14"
      />
      <polygon
        points={poly([
          [x - w / 2, y + w / 2, 0],
          [x + w / 2, y + w / 2, 0],
          [x + w / 2, y + w / 2, h],
          [x - w / 2, y + w / 2, h],
        ])}
        fill="#7c6af0"
        stroke={INK}
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <polygon
        points={poly([
          [x + w / 2, y - w / 2, 0],
          [x + w / 2, y + w / 2, 0],
          [x + w / 2, y + w / 2, h],
          [x + w / 2, y - w / 2, h],
        ])}
        fill="#c4b5fd"
        stroke={INK}
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <polygon
        points={poly([
          [x - w / 2, y - w / 2, h],
          [x + w / 2, y - w / 2, h],
          [x + w / 2, y + w / 2, h],
          [x - w / 2, y + w / 2, h],
        ])}
        fill="#faf9ff"
        stroke={INK}
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <g transform={m}>
        <image
          href={src}
          x={-0.55}
          y={-0.55}
          width={1.1}
          height={1.1}
          style={dark ? { filter: "brightness(0)" } : undefined}
        />
      </g>
    </g>
  );
}

const NODES: Node[] = [
  {
    n: "Claude Code",
    x: -6,
    y: 2.5,
    src: "/claudecode-color.svg",
    wp: [
      [-0.6, 2.5],
      [-0.6, 1.5],
    ],
  },
  {
    n: "Cursor",
    x: -5,
    y: 6,
    src: "/cursor.svg",
    wp: [
      [-1, 6],
      [-1, 1.5],
    ],
  },
  {
    n: "OpenAI",
    x: 1.5,
    y: 7,
    src: "/openai.svg",
    dark: true,
    wp: [
      [0.5, 7],
      [0.5, 1.5],
    ],
  },
  {
    n: "Hermes Agent",
    x: 2.5,
    y: -6,
    src: "/hermesagent.svg",
    wp: [
      [2.5, -0.6],
      [1.5, -0.6],
    ],
  },
  {
    n: "n8n",
    x: 6,
    y: -5,
    src: "/n8n-color.svg",
    wp: [
      [6, -1.1],
      [1.5, -1.1],
    ],
  },
  {
    n: "Google ADK",
    x: 7,
    y: 1.5,
    src: "/gemini-color.svg",
    wp: [
      [7, 0.5],
      [1.5, 0.5],
    ],
  },
];

const pts = (n: Node): V3[] => [
  [n.x, n.y, 0.02],
  ...n.wp.map(([x, y]) => [x, y, 0.02] as V3),
];
const pathFor = (n: Node) => "M " + pts(n).map(P).join(" L ");
const pathRev = (n: Node) => "M " + pts(n).slice().reverse().map(P).join(" L ");

/* ---------- section ---------- */
const BENEFITS = [
  {
    icon: Coins,
    t: "Save tokens",
    d: "Call a specialist agent instead of burning your own context.",
    pos: "md:left-[2%] md:top-[6%]",
  },
  {
    icon: Layers,
    t: "More agents to compare",
    d: "Browse and pick from the whole marketplace, live.",
    pos: "md:right-[2%] md:top-[3%]",
  },
  {
    icon: Sparkles,
    t: "Better results",
    d: "Purpose-built agents beat a single prompt.",
    pos: "md:left-[5%] md:bottom-[4%]",
  },
];

export default function McpSection() {
  return (
    <section className="relative w-full overflow-hidden bg-white px-4 pb-16 md:px-8 select-none">
      <style>{`
        @keyframes cat-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-9px); } }
        @keyframes cat-dash { to { stroke-dashoffset: -24; } }
        .cat-bob { animation: cat-bob 3.2s ease-in-out infinite; }
        .cat-dash { stroke-dasharray: 5 7; animation: cat-dash 1.2s linear infinite; }
      `}</style>

      <div className="mx-auto max-w-5xl">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="text-center"
        >
          <h2 className="font-display text-4xl leading-[1.05] tracking-tight text-foreground md:text-6xl">
            Catelog is MCP-Native
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground md:text-lg">
            Connect your agents to a marketplace of specialized agents and
            workflows. Discover, invoke, and orchestrate capabilities through
            MCP
          </p>
        </motion.div>

        {/* Isometric MCP hub */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="relative mt-6 pb-4"
        >
          {BENEFITS.map((b) => (
            <div
              key={b.t}
              className={`mb-4 flex max-w-[15rem] items-start gap-2.5 md:absolute md:z-10 md:mb-0 ${b.pos}`}
            >
              <b.icon className="mt-0.5 size-4 shrink-0 text-indigo-500" />
              <div>
                <p className="text-sm font-semibold text-foreground">{b.t}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {b.d}
                </p>
              </div>
            </div>
          ))}
          <svg
            viewBox="-60 70 940 490"
            className="mx-auto h-auto w-full max-w-3xl"
            role="img"
            aria-label="Catelog MCP connecting agents"
          >
            <defs>
              <pattern
                id="isoGrid"
                width="69.3"
                height="40"
                patternUnits="userSpaceOnUse"
                patternTransform="translate(0 0)"
              >
                <path
                  d="M0 20 L34.6 0 L69.3 20 L34.6 40 Z"
                  fill="none"
                  stroke="#8b7cf6"
                  strokeOpacity="0.12"
                />
              </pattern>
              <radialGradient id="fadeMask" cx="50%" cy="55%" r="55%">
                <stop offset="55%" stopColor="#fff" />
                <stop offset="100%" stopColor="#000" />
              </radialGradient>
              <mask
                id="gridMask"
                maskUnits="userSpaceOnUse"
                x="-200"
                y="0"
                width="1200"
                height="700"
              >
                <rect
                  x="-200"
                  y="0"
                  width="1200"
                  height="700"
                  fill="url(#fadeMask)"
                />
              </mask>
            </defs>

            <rect
              x="-200"
              y="0"
              width="1200"
              height="700"
              fill="url(#isoGrid)"
              mask="url(#gridMask)"
            />

            {/* connections */}
            {NODES.map((n, i) => (
              <g key={n.n}>
                <path
                  d={pathFor(n)}
                  fill="none"
                  stroke="#8b7cf6"
                  strokeOpacity="0.45"
                  strokeWidth="1.2"
                />
                <path
                  d={pathFor(n)}
                  fill="none"
                  stroke="#6d5ef0"
                  strokeWidth="1.4"
                  className="cat-dash"
                  style={{ animationDelay: `${i * 0.2}s` }}
                />
                {/* request pulse: agent -> hub */}
                <circle r="4" fill="#6d5ef0" stroke="#fff" strokeWidth="1.5">
                  <animateMotion
                    dur="3.4s"
                    begin={`${i * 0.55}s`}
                    repeatCount="indefinite"
                    path={pathFor(n)}
                  />
                </circle>
                {/* response pulse: hub -> agent */}
                <circle r="3" fill="#f59e0b" stroke="#fff" strokeWidth="1.2">
                  <animateMotion
                    dur="3.4s"
                    begin={`${i * 0.55 + 1.7}s`}
                    repeatCount="indefinite"
                    path={pathRev(n)}
                  />
                </circle>
              </g>
            ))}

            {/* agent tiles behind the cube first, then front ones */}
            {NODES.filter((n) => n.x + n.y < 0).map((n) => (
              <Tile key={n.n} {...n} />
            ))}

            {/* hub shadow */}
            <polygon
              points={poly([
                [-1.5 + 0.6, 1.5 + 0.6, 0],
                [1.5 + 1.2, 1.5 + 1.2, 0],
                [1.5 + 1.2, -1.5 + 0.6, 0],
                [-1.5 + 0.6, -1.5 + 0.6, 0],
              ])}
              fill="#1b1740"
              opacity="0.15"
            />
            <Cube n={3} h={3} />

            {NODES.filter((n) => n.x + n.y >= 0).map((n) => (
              <Tile key={n.n} {...n} />
            ))}

            {/* floating Catelog cube */}
            <g className="cat-bob">
              <Cube n={1.5} h={1.5} z0={3.9} cells={false} />
              <g
                transform={`matrix(${COS * S} ${0.5 * S} ${-COS * S} ${0.5 * S} ${sx([0, 0, 5.4])} ${sy([0, 0, 5.4])})`}
              >
                <image
                  href="/logo.svg"
                  x={-0.55}
                  y={-0.55}
                  width={1.1}
                  height={1.1}
                />
              </g>
            </g>
          </svg>
        </motion.div>
      </div>
    </section>
  );
}
