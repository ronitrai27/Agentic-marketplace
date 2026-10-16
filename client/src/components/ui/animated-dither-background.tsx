"use client";

import React, { useEffect, useRef } from "react";

interface AnimatedDitherBackgroundProps {
  className?: string;
}

export function AnimatedDitherBackground({
  className = "",
}: AnimatedDitherBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    let animationFrameId: number;
    let width = 0;
    let height = 0;

    // Bayer 4x4 matrix normalized 0..1
    const bayer4x4 = [
      [0 / 16, 8 / 16, 2 / 16, 10 / 16],
      [12 / 16, 4 / 16, 14 / 16, 6 / 16],
      [3 / 16, 11 / 16, 1 / 16, 9 / 16],
      [15 / 16, 7 / 16, 13 / 16, 5 / 16],
    ];

    // Greyish-white curated palette tones:
    // Pure whites, platinum, cool grey, soft slate shadows
    const palette = [
      { r: 255, g: 255, b: 255 }, // 0: crisp pure white
      { r: 247, g: 248, b: 250 }, // 1: bright off-white
      { r: 235, g: 238, b: 242 }, // 2: platinum grey
      { r: 218, g: 222, b: 228 }, // 3: soft mist grey
      { r: 198, g: 204, b: 214 }, // 4: cool slate
      { r: 172, g: 179, b: 191 }, // 5: deeper slate shadow
    ];

    const resize = () => {
      width = canvas.parentElement?.clientWidth || window.innerWidth;
      height = canvas.parentElement?.clientHeight || window.innerHeight;
      canvas.width = width;
      canvas.height = height;
    };

    resize();
    window.addEventListener("resize", resize);

    // Block pixel size: finer 12px grid (more calm, refined resolution)
    const pixelSize = 12;
    let time = 0;

    const render = () => {
      // Much slower, calm, meditative pacing
      time += 0.003;

      const cols = Math.ceil(width / pixelSize);
      const rows = Math.ceil(height / pixelSize);

      // Pre-fill canvas with soft neutral
      ctx.fillStyle = "#fafbfc";
      ctx.fillRect(0, 0, width, height);

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const nx = x / cols;
          const ny = y / rows;

          // Gentle undulating harmonic waves
          const wave1 = Math.sin(nx * 2.8 + ny * 1.8 + time * 0.5);
          const wave2 = Math.cos(nx * 1.7 - ny * 2.4 + time * 0.35);
          const wave3 = Math.sin((nx + ny) * 3.0 - time * 0.4);

          // Combined normalized smooth field [0..1]
          let field = (wave1 + wave2 + wave3 + 3) / 6;

          // Gentle vignette spotlight
          const dx = nx - 0.5;
          const dy = ny - 0.35;
          const radial = Math.sqrt(dx * dx + dy * dy);
          field = field * 0.8 + (1 - Math.min(radial, 1)) * 0.2;

          // Softened Bayer modulation for calm, minimal step transitions
          const bayerValue = bayer4x4[y % 4][x % 4] - 0.5;
          const dithered = Math.max(
            0,
            Math.min(1, field + bayerValue * 0.14)
          );

          // Quantize into discrete palette levels
          const level = Math.floor(dithered * (palette.length - 1));
          const color = palette[Math.min(level, palette.length - 1)];

          ctx.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
          ctx.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize);
        }
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <div
      className={`absolute inset-0 pointer-events-none overflow-hidden ${className}`}
    >
      <canvas ref={canvasRef} className="w-full h-full block" />
      {/* Noise grain overlay on top of the pixel grid */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.22] mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")`,
          backgroundSize: "160px 160px",
        }}
      />
      {/* Subtle vignette for contrast */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at 50% 50%, rgba(255,255,255,0.1) 40%, rgba(200,205,215,0.35) 100%)",
        }}
      />
    </div>
  );
}
