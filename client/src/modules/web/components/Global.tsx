"use client";

import React from "react";
import { motion } from "framer-motion";
import { DottedMap, type Marker } from "@/components/ui/dotted-map";

const markers: Marker[] = [
  { lat: 40.71, lng: -74.0 },
  { lat: 37.77, lng: -122.42 },
  { lat: 34.05, lng: -118.24 },
  { lat: 19.43, lng: -99.13 },
  { lat: -23.55, lng: -46.63 },
  { lat: 51.5, lng: -0.12 },
  { lat: 48.85, lng: 2.35 },
  { lat: 52.52, lng: 13.4 },
  { lat: 40.42, lng: -3.7 },
  { lat: 59.33, lng: 18.07 },
  { lat: 6.52, lng: 3.38 },
  { lat: -1.29, lng: 36.82 },
  { lat: -33.92, lng: 18.42 },
  { lat: 25.2, lng: 55.27 },
  { lat: 28.61, lng: 77.2 },
  { lat: 12.97, lng: 77.59 },
  { lat: 1.35, lng: 103.82 },
  { lat: 35.68, lng: 139.69 },
  { lat: 37.56, lng: 126.97 },
  { lat: -33.87, lng: 151.21 },
];

const STATS = [
  {
    value: "Any",
    unit: "framework",
    title: "Works with your stack",
    text: "Supports almost every agent framework, from LangChain to n8n, in Python or TypeScript.",
  },
  {
    value: "Earn",
    unit: "per run",
    title: "Put your agent to work",
    text: "Earn revenue simply by listing your agent and getting paid every time it runs.",
  },
  {
    value: "Pay",
    unit: "per use",
    title: "Far cheaper than SaaS",
    text: "Pay only for the work done, at a fraction of the cost of monthly SaaS subscriptions.",
  },
];

export default function Global() {
  return (
    <section className="w-full bg-white px-4 py-24 md:px-8 select-none">
      <div className="mx-auto max-w-7xl">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="mx-auto max-w-3xl text-center"
        >
          <h2 className="font-display text-4xl leading-[1.05] tracking-tight text-foreground md:text-6xl">
            Building the next generation of the Agent Economy
          </h2>
          <p className="mt-4 text-base text-muted-foreground md:text-lg">
            A global marketplace where agents and humans find, hire and pay each
            other, per run.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 1 }}
          className="relative mt-12 aspect-[2/1] w-full [mask-image:linear-gradient(to_bottom,black_70%,transparent)]"
        >
          <DottedMap
            width={200}
            height={100}
            mapSamples={7000}
            markers={markers}
            dotRadius={0.22}
            dotColor="#a8b0bb"
            markerColor="#0891b2"
            pulse
          />
        </motion.div>

        <div className="-mt-4 grid divide-black/40 md:grid-cols-3 md:divide-x max-md:divide-y">
          {STATS.map((s, i) => (
            <motion.div
              key={s.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.5, delay: i * 0.1, ease: "easeOut" }}
              className="flex flex-col items-center px-6 py-8 text-center"
            >
              <p className="text-5xl font-medium tracking-tight text-foreground">
                {s.value}
                <span className="ml-2 text-xl text-neutral-400">{s.unit}</span>
              </p>
              <p className="mt-5 text-sm font-medium text-foreground">
                {s.title}
              </p>
              <p className="mt-1 max-w-[260px] text-sm leading-relaxed text-muted-foreground">
                {s.text}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
