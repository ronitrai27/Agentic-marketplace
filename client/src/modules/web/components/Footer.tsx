"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight } from "lucide-react";

const COLS = [
  {
    title: "Menu",
    links: ["Marketplace", "How it works", "Pricing", "SDK Docs", "Blog"],
  },
  {
    title: "Essentials",
    links: [
      "Support",
      "Creator guide",
      "Privacy notice",
      "Usage guidelines",
      "Terms of service",
    ],
  },
  {
    title: "From the community",
    links: [
      "Nova Research",
      "Lava Creation",
      "Competitor Teardown",
      "Lead Finder",
      "SEO Agent",
    ],
  },
];

export default function Footer() {
  return (
    <footer className="relative w-full overflow-hidden bg-white select-none">
      {/* nature background */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?auto=format&fit=crop&w=2400&q=80"
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover object-bottom"
      />
      {/* white overlay at the top, fading out */}
      <div className="absolute inset-0 bg-gradient-to-b from-white via-white/60 to-transparent" />

      <div className="relative mx-auto max-w-6xl px-6 pt-10 md:px-8">
        <div className="grid gap-8 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          {/* Brand */}
          <div>
            <Image
              src="/logo.svg"
              alt="Catelog"
              width={120}
              height={36}
              className="h-9 w-auto object-contain"
            />
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-neutral-600">
              The marketplace for AI agents. Discover, rent and publish
              autonomous agents, and pay per run.
            </p>
            <Link
              href="/auth"
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-black px-4 py-2.5 text-sm font-medium text-white transition-transform hover:scale-[1.03]"
            >
              Get started today <ArrowRight className="size-4" />
            </Link>
            <p className="mt-4 text-xs text-neutral-600">
              © 2026 Catelog Inc. · Built for the agent economy
            </p>
          </div>

          {/* Link columns (placeholder links) */}
          {COLS.map((c) => (
            <div key={c.title}>
              <h4 className="text-base font-semibold text-foreground">
                {c.title}
              </h4>
              <ul className="mt-3 space-y-2.5">
                {c.links.map((l) => (
                  <li key={l}>
                    <a
                      href="#"
                      className="text-sm text-neutral-600 transition-colors hover:text-foreground"
                    >
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

      </div>

      {/* Giant full-width wordmark */}
      <svg
        viewBox="0 0 1000 190"
        className="relative mt-10 block w-full"
        aria-label="Catelog"
        role="img"
      >
        <text
          x="0"
          y="212"
          textLength="1000"
          lengthAdjust="spacingAndGlyphs"
          fontSize="290"
          fontWeight="800"
          fill="rgba(255,255,255,0.78)"
          fontFamily="Inter, system-ui, sans-serif"
        >
          Catelog
        </text>
      </svg>
    </footer>
  );
}
