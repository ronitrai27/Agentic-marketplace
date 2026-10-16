"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import {
  Play,
  Search,
  Bell,
  ChevronDown,
  Plus,
  MoreVertical,
  Check,
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  SlidersHorizontal,
  Home,
  CheckSquare,
  CreditCard,
  Building2,
  Wallet,
  ArrowRightLeft,
  Settings,
  ShieldCheck,
  Send,
  PlaneTakeoffIcon,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export default function Hero() {
  const { data: session } = authClient.useSession();
  const user = session?.user;

  return (
    <div className="nexora-hero-root relative h-screen flex flex-col bg-background overflow-hidden select-none font-body">
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
        className="absolute inset-0 w-full h-full object-cover z-0 pointer-events-none opacity-90"
      >
        <source
          src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260319_015952_e1deeb12-8fb7-4071-a42a-60779fc64ab6.mp4"
          type="video/mp4"
        />
      </video>

      {/* Subtle overlay gradient to ensure high readability */}
      <div className="absolute inset-0 bg-gradient-to-b from-white/60 via-transparent to-white/40 pointer-events-none z-[1]" />

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
          <a href="#about" className="transition-colors hover:text-foreground">
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
      <main className="relative z-10 flex flex-col items-center w-full flex-1 overflow-hidden px-4 mt-10">
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
            {/* Dashboard internals */}
            <div className="w-full bg-white/95 rounded-xl border border-black/[0.06] shadow-sm overflow-hidden text-[11px] select-none pointer-events-none flex flex-col">
              {/* Top Bar */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-black/[0.06] bg-white">
                <div className="flex items-center gap-2">
                  <Image
                    src="/logo.svg"
                    alt="Catelog"
                    width={80}
                    height={24}
                    className="h-5 w-auto object-contain"
                  />
                  <ChevronDown className="w-3 h-3 text-muted-foreground" />
                </div>

                {/* Search */}
                <div className="flex items-center gap-2 bg-secondary/80 px-2.5 py-1 rounded-md text-muted-foreground border border-black/[0.04] w-64">
                  <Search className="w-3 h-3" />
                  <span className="text-[10px]">
                    Search transactions, workflows...
                  </span>
                  <kbd className="ml-auto text-[9px] bg-white px-1.5 py-0.5 rounded shadow-2xs text-muted-foreground border border-black/[0.06]">
                    ⌘K
                  </kbd>
                </div>

                {/* Right actions */}
                <div className="flex items-center gap-3">
                  <span className="px-2.5 py-1 rounded-full bg-secondary text-foreground text-[10px] font-medium border border-black/[0.06]">
                    Move Money
                  </span>
                  <div className="relative">
                    <Bell className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-accent rounded-full" />
                  </div>
                  <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-medium text-[10px]">
                    JB
                  </div>
                </div>
              </div>

              {/* Main App Body: Sidebar + Main content */}
              <div className="flex">
                {/* Sidebar */}
                <aside className="w-40 border-r border-black/[0.06] p-3 flex flex-col gap-4 bg-[#fcfcfd]">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-secondary text-foreground font-medium">
                      <Home className="w-3.5 h-3.5" />
                      <span>Home</span>
                    </div>
                    <div className="flex items-center justify-between px-2 py-1.5 rounded-md text-muted-foreground hover:bg-secondary/40">
                      <div className="flex items-center gap-2">
                        <CheckSquare className="w-3.5 h-3.5" />
                        <span>Tasks</span>
                      </div>
                      <span className="bg-secondary px-1.5 py-0.2 rounded-full text-[9px] font-semibold text-foreground border border-black/[0.04]">
                        10
                      </span>
                    </div>
                    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md text-muted-foreground">
                      <ArrowRightLeft className="w-3.5 h-3.5" />
                      <span>Transactions</span>
                    </div>
                    <div className="flex items-center justify-between px-2 py-1.5 rounded-md text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <CreditCard className="w-3.5 h-3.5" />
                        <span>Payments</span>
                      </div>
                      <ChevronDown className="w-3 h-3 opacity-60" />
                    </div>
                    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md text-muted-foreground">
                      <Wallet className="w-3.5 h-3.5" />
                      <span>Cards</span>
                    </div>
                    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md text-muted-foreground">
                      <TrendingUp className="w-3.5 h-3.5" />
                      <span>Capital</span>
                    </div>
                    <div className="flex items-center justify-between px-2 py-1.5 rounded-md text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-3.5 h-3.5" />
                        <span>Accounts</span>
                      </div>
                      <ChevronDown className="w-3 h-3 opacity-60" />
                    </div>
                  </div>

                  <div className="space-y-0.5">
                    <span className="px-2 text-[9px] font-semibold tracking-wider text-muted-foreground/70 uppercase">
                      Workflows
                    </span>
                    <div className="flex items-center gap-2 px-2 py-1 rounded-md text-muted-foreground">
                      <ShieldCheck className="w-3 h-3" />
                      <span>Trake rutes</span>
                    </div>
                    <div className="flex items-center gap-2 px-2 py-1 rounded-md text-muted-foreground">
                      <Send className="w-3 h-3" />
                      <span>Payments</span>
                    </div>
                    <div className="flex items-center gap-2 px-2 py-1 rounded-md text-muted-foreground">
                      <Bell className="w-3 h-3" />
                      <span>Notifications</span>
                    </div>
                    <div className="flex items-center gap-2 px-2 py-1 rounded-md text-muted-foreground">
                      <Settings className="w-3 h-3" />
                      <span>Settings</span>
                    </div>
                  </div>
                </aside>

                {/* Main Content */}
                <div className="flex-1 bg-secondary/30 p-4 space-y-3.5">
                  {/* Greeting & Action buttons */}
                  <div className="space-y-2.5">
                    <h2 className="text-sm font-semibold text-foreground">
                      Welcome, Jane
                    </h2>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="rounded-full bg-accent text-white px-3 py-1 text-[10px] font-medium shadow-xs">
                          Send
                        </span>
                        <span className="rounded-full bg-white border border-black/[0.08] text-foreground px-3 py-1 text-[10px] font-medium shadow-2xs">
                          Request
                        </span>
                        <span className="rounded-full bg-white border border-black/[0.08] text-foreground px-3 py-1 text-[10px] font-medium shadow-2xs">
                          Transfer
                        </span>
                        <span className="rounded-full bg-white border border-black/[0.08] text-foreground px-3 py-1 text-[10px] font-medium shadow-2xs">
                          Deposit
                        </span>
                        <span className="rounded-full bg-white border border-black/[0.08] text-foreground px-3 py-1 text-[10px] font-medium shadow-2xs">
                          Pay Bill
                        </span>
                        <span className="rounded-full bg-white border border-black/[0.08] text-foreground px-3 py-1 text-[10px] font-medium shadow-2xs">
                          Create Invoice
                        </span>
                      </div>
                      <span className="text-[10px] text-muted-foreground font-medium flex items-center gap-1">
                        <SlidersHorizontal className="w-2.5 h-2.5" /> Customize
                      </span>
                    </div>
                  </div>

                  {/* Two equal-width cards */}
                  <div className="flex gap-3">
                    {/* Balance card */}
                    <div className="flex-1 basis-0 bg-white rounded-xl p-3 border border-black/[0.06] shadow-2xs flex flex-col justify-between">
                      <div>
                        <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] font-medium">
                          <span>Mercury Balance</span>
                          <span className="w-3.5 h-3.5 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                            <Check className="w-2.5 h-2.5 stroke-[3]" />
                          </span>
                        </div>
                        <div className="mt-1 flex items-baseline gap-0.5">
                          <span className="text-xl font-bold tracking-tight text-foreground">
                            $8,450,190
                          </span>
                          <span className="text-xs text-muted-foreground font-medium">
                            .32
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[10px]">
                          <span className="text-muted-foreground">
                            Last 30 Days
                          </span>
                          <span className="text-emerald-600 font-medium flex items-center">
                            <ArrowUpRight className="w-2.5 h-2.5" /> +$1.8M
                          </span>
                          <span className="text-rose-500 font-medium flex items-center">
                            <ArrowDownRight className="w-2.5 h-2.5" /> -$900K
                          </span>
                        </div>
                      </div>

                      {/* Smooth cubic Bézier SVG area chart */}
                      <div className="mt-2 h-20 w-full relative">
                        <svg
                          className="w-full h-full overflow-visible"
                          viewBox="0 0 300 80"
                          preserveAspectRatio="none"
                          aria-label="Balance chart"
                        >
                          <defs>
                            <linearGradient
                              id="areaGradient"
                              x1="0"
                              y1="0"
                              x2="0"
                              y2="1"
                            >
                              <stop
                                offset="0%"
                                stopColor="hsl(239, 84%, 67%)"
                                stopOpacity="0.18"
                              />
                              <stop
                                offset="100%"
                                stopColor="hsl(239, 84%, 67%)"
                                stopOpacity="0"
                              />
                            </linearGradient>
                          </defs>
                          {/* Filled Area */}
                          <path
                            d="M 0 65 C 40 60, 60 45, 100 50 C 140 55, 170 25, 210 30 C 250 35, 270 12, 300 8 L 300 80 L 0 80 Z"
                            fill="url(#areaGradient)"
                          />
                          {/* Stroke Line */}
                          <path
                            d="M 0 65 C 40 60, 60 45, 100 50 C 140 55, 170 25, 210 30 C 250 35, 270 12, 300 8"
                            fill="none"
                            stroke="hsl(239, 84%, 67%)"
                            strokeWidth="1.5"
                          />
                        </svg>
                      </div>
                    </div>

                    {/* Accounts card */}
                    <div className="flex-1 basis-0 bg-white rounded-xl p-3 border border-black/[0.06] shadow-2xs flex flex-col">
                      <div className="flex items-center justify-between pb-1 border-b border-black/[0.04]">
                        <span className="font-semibold text-foreground text-xs">
                          Accounts
                        </span>
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Plus className="w-3.5 h-3.5" />
                          <MoreVertical className="w-3.5 h-3.5" />
                        </div>
                      </div>

                      <div className="flex-1 flex flex-col justify-around py-1">
                        <div className="flex items-center justify-between py-2.5 text-xs">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-accent" />
                            <span className="font-medium text-foreground">
                              Credit
                            </span>
                          </div>
                          <span className="font-semibold text-foreground">
                            $98,125.50
                          </span>
                        </div>
                        <div className="flex items-center justify-between py-2.5 text-xs">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-emerald-500" />
                            <span className="font-medium text-foreground">
                              Treasury
                            </span>
                          </div>
                          <span className="font-semibold text-foreground">
                            $6,750,200.00
                          </span>
                        </div>
                        <div className="flex items-center justify-between py-2.5 text-xs">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-sky-500" />
                            <span className="font-medium text-foreground">
                              Operations
                            </span>
                          </div>
                          <span className="font-semibold text-foreground">
                            $1,592,864.82
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Transactions Table */}
                  <div className="bg-white rounded-xl p-3 border border-black/[0.06] shadow-2xs">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold text-foreground text-xs">
                        Recent Transactions
                      </h3>
                    </div>
                    <div className="w-full">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="text-[10px] text-muted-foreground border-b border-black/[0.04]">
                            <th className="pb-1.5 font-medium">Date</th>
                            <th className="pb-1.5 font-medium">Description</th>
                            <th className="pb-1.5 font-medium">Amount</th>
                            <th className="pb-1.5 font-medium text-right">
                              Status
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-black/[0.02]">
                          <tr>
                            <td className="py-2 text-muted-foreground text-[10px]">
                              Today, 2:45 PM
                            </td>
                            <td className="py-2 font-medium text-foreground">
                              AWS Cloud Infrastructure
                            </td>
                            <td className="py-2 font-medium text-rose-500">
                              -$5,200.00
                            </td>
                            <td className="py-2 text-right">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-medium bg-amber-50 text-amber-600 border border-amber-200/50">
                                Pending
                              </span>
                            </td>
                          </tr>
                          <tr>
                            <td className="py-2 text-muted-foreground text-[10px]">
                              Today, 11:20 AM
                            </td>
                            <td className="py-2 font-medium text-foreground">
                              Client Payment (Acme Corp)
                            </td>
                            <td className="py-2 font-medium text-emerald-600">
                              +$125,000.00
                            </td>
                            <td className="py-2 text-right">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-medium bg-emerald-50 text-emerald-600 border border-emerald-200/50">
                                Completed
                              </span>
                            </td>
                          </tr>
                          <tr>
                            <td className="py-2 text-muted-foreground text-[10px]">
                              Yesterday
                            </td>
                            <td className="py-2 font-medium text-foreground">
                              Payroll Run (Bi-weekly)
                            </td>
                            <td className="py-2 font-medium text-foreground">
                              -$85,450.00
                            </td>
                            <td className="py-2 text-right">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-medium bg-emerald-50 text-emerald-600 border border-emerald-200/50">
                                Completed
                              </span>
                            </td>
                          </tr>
                          <tr>
                            <td className="py-2 text-muted-foreground text-[10px]">
                              Oct 9, 2026
                            </td>
                            <td className="py-2 font-medium text-foreground">
                              Office Supplies
                            </td>
                            <td className="py-2 font-medium text-foreground">
                              -$1,200.00
                            </td>
                            <td className="py-2 text-right">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-medium bg-emerald-50 text-emerald-600 border border-emerald-200/50">
                                Completed
                              </span>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
