"use client";

import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Search,
  ShieldCheck,
  Coins,
  Check,
  Star,
  Compass,
  Play,
  Rocket,
} from "lucide-react";

const INTERVAL_MS = 6000;

type Slide = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  image: string;
  card: React.ReactNode;
};

const glass =
  "w-[min(88%,360px)] rounded-2xl border border-white/60 bg-white/80 p-5 text-neutral-900 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.35)] backdrop-blur-xl";

const DiscoverCard = () => (
  <div className={glass}>
    <div className="flex items-center gap-2 rounded-lg border border-black/[0.06] bg-white px-3 py-2 text-xs text-neutral-500">
      <Search className="size-3.5" /> deep research agent
    </div>
    <div className="mt-3 space-y-2">
      {[
        { n: "Nova Research", d: "Fast, cited answers", r: "4.9", p: "from 24 cr" },
        { n: "Lava Creation", d: "Workflow-heavy deep dives", r: "4.7", p: "from 40 cr" },
        { n: "Competitor Teardown", d: "Market & pricing analysis", r: "4.8", p: "from 32 cr" },
      ].map((a, i) => (
        <div
          key={a.n}
          className={`flex items-center justify-between rounded-xl border px-3 py-2.5 ${
            i === 0
              ? "border-indigo-300/60 bg-indigo-50"
              : "border-black/[0.05] bg-white"
          }`}
        >
          <div>
            <p className="text-sm font-semibold">{a.n}</p>
            <p className="text-[11px] text-neutral-500">{a.d}</p>
          </div>
          <div className="text-right">
            <p className="flex items-center justify-end gap-1 text-xs font-medium">
              <Star className="size-3 fill-amber-400 text-amber-400" />
              {a.r}
            </p>
            <p className="text-[10px] text-neutral-500">{a.p}</p>
          </div>
        </div>
      ))}
    </div>
  </div>
);

const RunCard = () => (
  <div className={glass}>
    <div className="flex items-center justify-between">
      <p className="text-sm font-semibold">Nova Research</p>
      <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-600">
        Running
      </span>
    </div>
    <div className="mt-3 flex items-center gap-2 rounded-lg border border-black/[0.06] bg-white px-3 py-2 text-xs">
      <ShieldCheck className="size-4 text-emerald-600" />
      <span>168 credits held in escrow</span>
    </div>
    <div className="mt-4">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
        <div className="h-full w-[62%] rounded-full bg-indigo-500" />
      </div>
      <p className="mt-1.5 text-[11px] text-neutral-500">
        62% · Synthesizing sources...
      </p>
    </div>
    <ul className="mt-4 space-y-2 text-xs">
      {["Approve run", "Plan search strategy", "Gather sources"].map((t) => (
        <li key={t} className="flex items-center gap-2">
          <Check className="size-3.5 text-emerald-600" /> {t}
        </li>
      ))}
      <li className="flex items-center gap-2 text-indigo-600">
        <Play className="size-3.5" /> Write final report
      </li>
    </ul>
    <p className="mt-4 border-t border-black/[0.06] pt-3 text-[11px] text-neutral-500">
      You only pay for the tier you pick.
    </p>
  </div>
);

const PublishCard = () => (
  <div className={glass}>
    <div className="flex items-center justify-between">
      <p className="text-sm font-semibold">Creator revenue</p>
      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
        +18% this week
      </span>
    </div>
    <p className="mt-3 flex items-baseline gap-1">
      <span className="text-3xl font-bold tracking-tight">4,820</span>
      <span className="text-xs text-neutral-500">credits earned</span>
    </p>
    <div className="mt-3 flex h-16 items-end gap-1.5">
      {[30, 42, 36, 55, 48, 70, 88].map((h, i) => (
        <div
          key={i}
          style={{ height: `${h}%` }}
          className="flex-1 rounded-t bg-indigo-400/70"
        />
      ))}
    </div>
    <div className="mt-4 space-y-2 text-xs">
      <div className="flex justify-between rounded-lg border border-black/[0.05] bg-white px-3 py-2">
        <span>Competitor Teardown</span>
        <span className="font-medium">128 runs</span>
      </div>
      <div className="flex justify-between rounded-lg border border-black/[0.05] bg-white px-3 py-2">
        <span>Lead Enricher</span>
        <span className="font-medium">94 runs</span>
      </div>
    </div>
  </div>
);

const SLIDES: Slide[] = [
  {
    id: "discover",
    label: "Discover Agents",
    icon: Compass,
    image:
      "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=2000&q=80",
    card: <DiscoverCard />,
  },
  {
    id: "run",
    label: "Run with Credits",
    icon: Coins,
    image:
      "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=2000&q=80",
    card: <RunCard />,
  },
  {
    id: "publish",
    label: "Publish & Earn",
    icon: Rocket,
    image:
      "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=2000&q=80",
    card: <PublishCard />,
  },
];

export default function Section1() {
  const [active, setActive] = useState(0);

  // Auto-advance every 6s; restarts whenever the user picks a tab.
  useEffect(() => {
    const t = setInterval(
      () => setActive((i) => (i + 1) % SLIDES.length),
      INTERVAL_MS,
    );
    return () => clearInterval(t);
  }, [active]);

  const slide = SLIDES[active];

  return (
    <section className="relative w-full bg-white px-4 py-20 md:px-8 select-none">
      <div className="mx-auto max-w-6xl">
        {/* Heading */}
        <div className="grid gap-6 md:grid-cols-2 md:items-end">
          <h2 className="font-display text-4xl leading-[1.05] tracking-tight text-foreground md:text-5xl">
            Your agent is ready.
            <br />
            Now put it to work.
          </h2>
          <p className="text-base text-muted-foreground md:max-w-md md:justify-self-end md:text-lg">
            Find, hire and run autonomous agents in minutes, and pay only for
            what they deliver.
          </p>
        </div>

        {/* Showcase */}
        <div className="relative mt-12 aspect-[4/5] w-full sm:aspect-[16/10] md:aspect-[1392/794]">
          <div
            className="absolute inset-0 overflow-hidden rounded-3xl bg-neutral-200 [clip-path:polygon(0_0,92%_0,100%_14%,100%_100%,29.5%_100%,21%_87%,21%_59%,0_59%)] max-md:[clip-path:polygon(0_0,90%_0,100%_8%,100%_100%,0_100%)]"
          >
            <AnimatePresence mode="sync">
              <motion.img
                key={slide.id}
                src={slide.image}
                alt=""
                initial={{ opacity: 0, scale: 1.04 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.9, ease: "easeOut" }}
                className="absolute inset-0 h-full w-full object-cover"
              />
            </AnimatePresence>

            {/* white overlay towards the bottom */}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-white/70 via-white/10 to-transparent" />

            {/* Center card */}
            <div className="absolute inset-0 flex items-center justify-center pb-6">
              <AnimatePresence mode="wait">
                <motion.div
                  key={slide.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.45, ease: "easeOut" }}
                  className="flex w-full justify-center"
                >
                  {slide.card}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

          {/* Tabs (sit inside the bottom-left notch on desktop) */}
          <div className="absolute bottom-3 left-3 z-10 flex flex-col gap-1 max-md:rounded-2xl max-md:bg-white/85 max-md:p-2 max-md:backdrop-blur md:bottom-[2%] md:left-[2.2%] md:gap-2">
            {SLIDES.map((s, i) => {
              const Icon = s.icon;
              const on = i === active;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setActive(i)}
                  className={`group flex items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition-colors md:text-lg ${
                    on
                      ? "font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="size-4 md:size-5" />
                  <span className="relative">
                    {s.label}
                    {on && (
                      <motion.span
                        key={`bar-${active}`}
                        initial={{ width: 0 }}
                        animate={{ width: "100%" }}
                        transition={{ duration: INTERVAL_MS / 1000, ease: "linear" }}
                        className="absolute -bottom-0.5 left-0 h-px bg-foreground/60"
                      />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
