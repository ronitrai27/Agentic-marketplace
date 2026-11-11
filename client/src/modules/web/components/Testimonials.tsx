"use client";

import React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";

type T = {
  quote: string;
  name: string;
  role: string;
  tag: "Buyer" | "Creator";
  face: string;
  bg: string;
};

const FACES = ["/faces/face-1.png", "/faces/face-2.webp", "/faces/face-3.png"];

const ITEMS: T[] = [
  {
    quote:
      "Paying just for the task is so much more useful, and cheaper, than SaaS subscriptions. I only pay when work actually gets done.",
    name: "Daniel R.",
    role: "Startup Founder",
    tag: "Buyer",
    face: FACES[0],
    bg: "bg-amber-100",
  },
  {
    quote:
      "No monthly package to buy. I just run an agent, pay, and get the output.",
    name: "Sarah W.",
    role: "Freelance Designer",
    tag: "Buyer",
    face: FACES[1],
    bg: "bg-rose-100",
  },
  {
    quote:
      "Letting my Claude connect to Catelog and use the tools to find jobs is cheaper and way more efficient than anything I tried before.",
    name: "Alex M.",
    role: "Software Engineer",
    tag: "Buyer",
    face: FACES[2],
    bg: "bg-sky-100",
  },
  {
    quote:
      "I wrapped my n8n workflow with the SDK in minutes. Now strangers pay me per run and the gateway handles all the abuse protection.",
    name: "Priya K.",
    role: "Automation Creator",
    tag: "Creator",
    face: FACES[1],
    bg: "bg-emerald-100",
  },
  {
    quote:
      "Setting my own price per run and letting Catelog handle trust and billing means I just ship better agents.",
    name: "Marcus T.",
    role: "Indie Developer",
    tag: "Creator",
    face: FACES[0],
    bg: "bg-violet-100",
  },
];

const tagStyle = {
  Buyer: "bg-indigo-50 text-indigo-600",
  Creator: "bg-emerald-50 text-emerald-600",
};

function Card({
  t,
  i,
  className = "",
}: {
  t: T;
  i: number;
  className?: string;
}) {
  return (
    <motion.figure
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.55, delay: i * 0.08, ease: "easeOut" }}
      className={`flex flex-col justify-between rounded-2xl border border-black/[0.06] bg-neutral-50/70 p-6 ${className}`}
    >
      <div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tagStyle[t.tag]}`}
        >
          {t.tag}
        </span>
        <blockquote className="mt-4 text-[15px] leading-relaxed text-foreground">
          “{t.quote}”
        </blockquote>
      </div>
      <figcaption className="mt-8 flex items-center gap-3">
        <span className={`size-9 overflow-hidden rounded-lg ${t.bg}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={t.face}
            alt=""
            className="size-full object-cover object-top"
            draggable={false}
          />
        </span>
        <span className="leading-tight">
          <span className="block text-xs text-muted-foreground">{t.name}</span>
          <span className="block text-sm font-semibold">{t.role}</span>
        </span>
      </figcaption>
    </motion.figure>
  );
}

export default function Testimonials() {
  return (
    <section className="w-full bg-white px-4 pb-28 md:px-8 select-none">
      <div className="mx-auto max-w-5xl">
        <div className="text-center">
          <span className="inline-block rounded-full border border-black/[0.08] bg-neutral-50 px-3 py-1 text-[11px] text-muted-foreground">
            Testimonials
          </span>
          <h2 className="mt-4 font-display text-4xl leading-[1.05] tracking-tight text-foreground md:text-5xl">
            People just like you
            <br />
            are already using Catelog
          </h2>
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-3">
          <Card t={ITEMS[0]} i={0} className="md:row-span-2 md:min-h-[360px]" />
          <Card t={ITEMS[1]} i={1} />
          <Card t={ITEMS[3]} i={2} />
          <Card t={ITEMS[2]} i={3} className="md:col-span-1" />
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.55, delay: 0.3, ease: "easeOut" }}
            className="relative flex flex-col justify-between overflow-hidden rounded-2xl p-7 text-white md:row-span-2 bg-[linear-gradient(135deg,#1e40af_0%,#3b82f6_35%,#93c5fd_65%,#ffffff_100%)]"
          >
            <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-white/25 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-20 -left-10 size-56 rounded-full bg-sky-300/30 blur-3xl" />
            <div className="relative">
              <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider backdrop-blur">
                Get started
              </span>
              <h3 className="mt-5 font-display text-4xl leading-[1.05] tracking-tight">
                Try it yourself.
              </h3>
              <p className="mt-3 text-base leading-relaxed text-white/90">
                It&apos;s time to enter the Agents economy. Discover, run or
                publish your first agent today.
              </p>
            </div>
            <Link
              href="/auth"
              className="relative mt-10 inline-flex w-fit items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-neutral-900 shadow-lg transition-transform hover:scale-[1.03]"
            >
              Sign up free <ArrowRight className="size-4" />
            </Link>
          </motion.div>
          <Card t={ITEMS[4]} i={4} className="md:col-span-2" />
        </div>
      </div>
    </section>
  );
}
