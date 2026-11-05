"use client";

import React, { useEffect, useRef } from "react";

interface CardDitherBackgroundProps {
  className?: string;
}

export function CardDitherBackground({ className = "" }: CardDitherBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    let animationFrameId: number;
    let width = 0;
    let height = 0;

    // 4x4 Bayer matrix normalized (0..1)
    const bayer4x4 = [
      [0 / 16, 8 / 16, 2 / 16, 10 / 16],
      [12 / 16, 4 / 16, 14 / 16, 6 / 16],
      [3 / 16, 11 / 16, 1 / 16, 9 / 16],
      [15 / 16, 7 / 16, 13 / 16, 5 / 16],
    ];

    // Light mode: Curated crisp white to slate-grey tones (matching Image 1)
    const lightPalette = [
      { r: 255, g: 255, b: 255 }, // 0: pure white
      { r: 247, g: 248, b: 250 }, // 1: off-white
      { r: 236, g: 239, b: 244 }, // 2: platinum grey
      { r: 218, g: 223, b: 230 }, // 3: soft mist grey
      { r: 195, g: 202, b: 212 }, // 4: cool slate
      { r: 168, g: 176, b: 189 }, // 5: deeper slate
    ];

    // Dark mode: Dark stealth charcoal to subtle graphite (NO glaring white!)
    const darkPalette = [
      { r: 10, g: 10, b: 12 },    // 0: deep black background
      { r: 18, g: 18, b: 21 },    // 1: darkest neutral
      { r: 28, g: 29, b: 35 },    // 2: subtle dark graphite
      { r: 40, g: 43, b: 51 },    // 3: muted slate
      { r: 54, g: 58, b: 69 },    // 4: soft border tone
      { r: 72, g: 78, b: 92 },    // 5: gentle highlight
    ];

    const resize = () => {
      width = canvas.parentElement?.clientWidth || 240;
      height = canvas.parentElement?.clientHeight || 180;
      canvas.width = width;
      canvas.height = height;
    };

    resize();
    window.addEventListener("resize", resize);

    // Fine pixel size: 10px grid for compact card display
    const pixelSize = 10;
    let time = 0;

    const render = () => {
      time += 0.0035;

      const isDark = document.documentElement.classList.contains("dark");
      const palette = isDark ? darkPalette : lightPalette;

      const cols = Math.ceil(width / pixelSize);
      const rows = Math.ceil(height / pixelSize);

      // Pre-fill base canvas color
      ctx.fillStyle = isDark ? "#0a0a0c" : "#ffffff";
      ctx.fillRect(0, 0, width, height);

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const nx = x / cols;
          const ny = y / rows;

          // Gentle harmonic wave field
          const wave1 = Math.sin(nx * 2.6 + ny * 1.6 + time * 0.5);
          const wave2 = Math.cos(nx * 1.8 - ny * 2.2 + time * 0.35);
          const wave3 = Math.sin((nx + ny) * 2.8 - time * 0.4);

          let field = (wave1 + wave2 + wave3 + 3) / 6;

          // Radial vignette centered near bottom
          const dx = nx - 0.5;
          const dy = ny - 0.5;
          const radial = Math.sqrt(dx * dx + dy * dy);
          field = field * 0.75 + (1 - Math.min(radial, 1)) * 0.25;

          // Bayer 4x4 dither modulation
          const bayerValue = bayer4x4[y % 4][x % 4] - 0.5;
          const dithered = Math.max(0, Math.min(1, field + bayerValue * 0.16));

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
    <div className={`absolute inset-0 pointer-events-none overflow-hidden ${className}`}>
      <canvas ref={canvasRef} className="w-full h-full block" />
      {/* Noise grain overlay */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.16] mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")`,
          backgroundSize: "120px 120px",
        }}
      />
    </div>
  );
}
