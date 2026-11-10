"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import { Play, PlaneTakeoffIcon, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export default function Hero({ children }: { children?: React.ReactNode }) {
  const { data: session } = authClient.useSession();
  const user = session?.user;

  return (
    <div className="nexora-hero-root h-screen w-full overflow-y-auto overflow-x-hidden bg-background select-none font-body">
      <div className="relative min-h-screen flex flex-col overflow-hidden">
        {/* Scoped Styling and Fonts without touching global.css */}
        <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600;700&display=swap');

        .nexora-hero-root {
          --background: 0 0% 100%;
          --foreground: 210 14% 17%;
          --primary: 210 14% 17%;
          --primary-foreground: 0 0% 100%;
          --secondary: 0 0% 96%;
          --secondary-foreground: 0 0% 9%;
          --muted: 0 0% 96%;
          --muted-foreground: 184 5% 55%;
          --accent: 239 84% 67%;
          --accent-foreground: 0 0% 100%;
          --border: 0 0% 90%;
          --ring: 239 84% 67%;
          --radius: 0.5rem;
          --font-display: 'Instrument Serif', Georgia, serif;
          --font-body: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          --shadow-dashboard: 0 25px 80px -12px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.06);
          font-family: var(--font-body);
          color: hsl(var(--foreground));
        }

        .font-display {
          font-family: var(--font-display);
        }

        .font-body {
          font-family: var(--font-body);
        }

        .dashboard-glass {
          background: rgba(255, 255, 255, 0.4);
          border: 1px solid rgba(255, 255, 255, 0.5);
          box-shadow: 0 25px 80px -12px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.06);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
        }
      `}</style>

        {/* Background Video */}
        <video
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-x-0 -top-40 w-full h-[calc(100%+10rem)] object-cover object-bottom z-0 pointer-events-none opacity-90"
        >
          <source
            src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260319_015952_e1deeb12-8fb7-4071-a42a-60779fc64ab6.mp4"
            type="video/mp4"
          />
        </video>

        {/* Subtle overlay gradient to ensure high readability */}
        <div className="absolute inset-0 bg-gradient-to-b from-white/15 via-transparent to-white/40 pointer-events-none z-[1]" />

        {/* Navbar */}
        <header className="relative z-20 flex items-center justify-between px-6 md:px-12 lg:px-20 py-5 font-body shrink-0">
          {/* Logo */}
          <div className="flex items-center gap-2 cursor-pointer">
            <Image
              src="/logo.svg"
              alt="Catelog"
              width={120}
              height={36}
              className="h-10 w-auto object-contain"
              priority
            />
          </div>

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-muted-foreground">
            <a href="#home" className="transition-colors hover:text-foreground">
              Home
            </a>
            <a
              href="#pricing"
              className="transition-colors hover:text-foreground"
            >
              Pricing
            </a>
            <a
              href="#about"
              className="transition-colors hover:text-foreground"
            >
              About
            </a>
            <a
              href="#contact"
              className="transition-colors hover:text-foreground"
            >
              Contact
            </a>
          </nav>

          {/* CTA Button & Session State */}
          <div className="flex items-center gap-3">
            {session ? (
              <div className="flex items-center gap-3">
                <Avatar className="size-9 border border-white shadow-xs cursor-pointer transition-transform hover:scale-105">
                  {user?.image ? (
                    <AvatarImage
                      src={user.image}
                      alt={user.name || "User avatar"}
                    />
                  ) : null}
                  <AvatarFallback className="bg-gradient-to-tr from-violet-500 via-indigo-500 to-cyan-400 text-white font-semibold text-xs uppercase">
                    {user?.name ? user.name.slice(0, 2) : "U"}
                  </AvatarFallback>
                </Avatar>

                <Link href="/">
                  <Button className="rounded-full px-5 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm transition-all hover:scale-[1.02]">
                    Continue <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              </div>
            ) : (
              <Link href="/auth">
                <Button className="rounded-full px-5 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm transition-all hover:scale-[1.02]">
                  Get Started
                </Button>
              </Link>
            )}
          </div>
        </header>

        {/* Hero Content */}
        <main className="relative z-10 flex flex-col items-center w-full flex-1 px-4 pb-10 mt-10">
          {/* 1. Badge */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="mb-4 md:mb-6"
          >
            <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/90 px-4 py-1.5 text-sm text-muted-foreground font-body shadow-[0_2px_8px_rgba(0,0,0,0.03)] backdrop-blur-md">
              <span>Marketplace for AI Agents ✨</span>
            </div>
          </motion.div>

          {/* 2. Headline */}
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1, ease: "easeOut" }}
            className="text-center font-display text-5xl md:text-6xl lg:text-[5rem] leading-[0.98] tracking-tight text-foreground max-w-4xl px-2"
          >
            <span className="block">Your Agent Economy</span>
            <span className="block mt-1">Unleashed</span>
          </motion.h1>

          {/* 3. Subheadline */}
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2, ease: "easeOut" }}
            className="mt-4 text-center text-base md:text-lg text-muted-foreground max-w-[650px] leading-relaxed font-body px-4"
          >
            Discover and rent AI agents built to get real work done. Your next
            hire isn't human. It's autonomous.
          </motion.p>

          {/* 4. CTA Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3, ease: "easeOut" }}
            className="mt-5 flex items-center gap-3"
          >
            <Link href="/auth">
              <Button className="rounded-full px-6 py-5 text-sm font-medium font-body bg-white text-primary-foreground hover:bg-primary/90 shadow-sm transition-all hover:scale-[1.02]">
                Get Started <PlaneTakeoffIcon />
              </Button>
            </Link>

            <button
              type="button"
              aria-label="Watch demo video"
              className="h-11 w-11 flex items-center justify-center rounded-full border-0 bg-background shadow-[0_2px_12px_rgba(0,0,0,0.08)] hover:bg-background/80 transition-all hover:scale-105 active:scale-95 cursor-pointer"
            >
              <Play className="h-4 w-4 fill-foreground text-foreground translate-x-0.5" />
            </button>
          </motion.div>

          {/* 5. Dashboard Preview */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.5, ease: "easeOut" }}
            className="mt-8 w-full max-w-5xl shrink-0"
          >
            <div className="dashboard-glass rounded-2xl p-3 md:p-4">
              <Image
                src="/hero1.png"
                alt="Catelog app preview"
                width={2000}
                height={1069}
                priority
                className="w-full h-auto rounded-xl border border-black/[0.06] shadow-sm"
              />
            </div>
          </motion.div>
        </main>
      </div>
      {children}
    </div>
  );
}
