"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useConvex } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { User, Mail, Lock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function AuthPage() {
  const router = useRouter();
  const convex = useConvex();
  const { data: session, isPending: isSessionLoading } =
    authClient.useSession();
  const hasTriggeredRef = useRef(false);

  const [mode, setMode] = useState<"sign-up" | "sign-in">("sign-up");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [lastUsed, setLastUsed] = useState<string | null>(null);
  const [googlePrompt, setGooglePrompt] = useState(false);

  const [isLoading, setIsLoading] = useState<
    "google" | "github" | "form" | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("catelxg_last_auth_provider");
      if (stored) {
        setLastUsed(stored);
      }
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  useEffect(() => {
    if (!isSessionLoading && session && !hasTriggeredRef.current) {
      hasTriggeredRef.current = true;
      toast.dismiss();

      const redirectPromise = new Promise((resolve) => {
        setTimeout(() => {
          resolve("Session active");
          router.replace("/auth/callback");
        }, 700);
      });

      toast.promise(redirectPromise, {
        id: "session-check",
        loading: "Checking session...",
        success: "Session verified! Redirecting...",
        error: "Failed to verify session",
      });
    }
  }, [session, isSessionLoading, router]);

  const handleSocialSignIn = async (provider: "google" | "github") => {
    try {
      setIsLoading(provider);
      setError(null);
      setGooglePrompt(false);

      try {
        localStorage.removeItem("catelxg_guest_mode");
        localStorage.setItem("catelxg_last_auth_provider", provider);
        setLastUsed(provider);
      } catch {
        // Ignore
      }

      await authClient.signIn.social({
        provider,
        callbackURL: "/auth/callback",
      });
    } catch (err: any) {
      console.error(`${provider} sign in error:`, err);
      setError(
        err?.message || `Failed to sign in with ${provider}. Please try again.`,
      );
      setIsLoading(null);
    }
  };

  const handleGuestMode = () => {
    try {
      localStorage.setItem("catelxg_guest_mode", "true");
      localStorage.setItem("catelxg_last_auth_provider", "guest");
      setLastUsed("guest");
      window.dispatchEvent(new Event("catelxg-guest-change"));
    } catch {
      // Ignore
    }
    toast.success("Entering marketplace as Guest...");
    router.push("/space");
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setGooglePrompt(false);

    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail) {
      setError("Please enter your email address.");
      return;
    }

    if (!password) {
      setError("Please enter your password.");
      return;
    }

    if (mode === "sign-up" && !name.trim()) {
      setError("Please enter your full name.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }

    setIsLoading("form");

    try {
      if (mode === "sign-up") {
        const res = await authClient.signUp.email({
          email: cleanEmail,
          password,
          name: name.trim(),
          callbackURL: "/auth/callback",
        });

        if (res.error) {
          const errCode = res.error.code;
          const errMsg = res.error.message || "";

          // Smart detection: Check if user already exists with Google
          if (
            errCode === "USER_ALREADY_EXISTS" ||
            errMsg.toLowerCase().includes("already exists") ||
            errMsg.toLowerCase().includes("user already")
          ) {
            try {
              const authMethods = await convex.query(
                (api as any).auth.checkEmailAuthMethods,
                { email: cleanEmail },
              );

              if (
                authMethods?.exists &&
                !authMethods.hasPassword &&
                authMethods.providers.includes("google")
              ) {
                setGooglePrompt(true);
                toast.info("Account registered with Google!", {
                  description:
                    "You previously signed up using Google. Click below to continue.",
                  action: {
                    label: "Sign in with Google",
                    onClick: () => handleSocialSignIn("google"),
                  },
                });
                setIsLoading(null);
                return;
              }

              if (authMethods?.exists && authMethods.hasPassword) {
                toast.error(
                  "This email is already registered. Please sign in.",
                );
                setMode("sign-in");
                setIsLoading(null);
                return;
              }
            } catch (queryErr) {
              console.error("Failed to query auth methods:", queryErr);
            }

            setError(
              errMsg || "This email is already registered. Try signing in.",
            );
            setIsLoading(null);
            return;
          }

          setError(errMsg || "Failed to create account. Please try again.");
          setIsLoading(null);
          return;
        }

        try {
          localStorage.removeItem("catelxg_guest_mode");
          localStorage.setItem("catelxg_last_auth_provider", "email");
          setLastUsed("email");
        } catch {
          // Ignore
        }

        toast.success("Account created successfully!");
        router.replace("/auth/callback");
      } else {
        // Sign In mode
        const res = await authClient.signIn.email({
          email: cleanEmail,
          password,
          callbackURL: "/auth/callback",
        });

        if (res.error) {
          const errMsg = res.error.message || "";

          // Check if this user actually signed up via Google and has no password
          try {
            const authMethods = await convex.query(
              (api as any).auth.checkEmailAuthMethods,
              { email: cleanEmail },
            );

            if (
              authMethods?.exists &&
              !authMethods.hasPassword &&
              authMethods.providers.includes("google")
            ) {
              setGooglePrompt(true);
              toast.info("This account was created with Google!", {
                description:
                  "You never created a password for this email. Sign in with Google instead.",
                action: {
                  label: "Sign in with Google",
                  onClick: () => handleSocialSignIn("google"),
                },
              });
              setIsLoading(null);
              return;
            }
          } catch (queryErr) {
            console.error("Failed to check auth methods:", queryErr);
          }

          setError(errMsg || "Invalid email or password.");
          setIsLoading(null);
          return;
        }

        try {
          localStorage.removeItem("catelxg_guest_mode");
          localStorage.setItem("catelxg_last_auth_provider", "email");
          setLastUsed("email");
        } catch {
          // Ignore
        }

        toast.success("Signed in successfully!");
        router.replace("/auth/callback");
      }
    } catch (err: any) {
      console.error("Form auth error:", err);
      setError(
        err?.message || "An unexpected error occurred. Please try again.",
      );
      setIsLoading(null);
    }
  };

  return (
    <div className="h-screen w-full overflow-y-auto lg:overflow-hidden bg-background text-foreground grid lg:grid-cols-[1.08fr_0.92fr] selection:bg-primary/10">
      {/* Left Column: Auth Form */}
      <div className="flex flex-col justify-between min-h-screen lg:min-h-0 px-6 sm:px-12 py-8 lg:py-10">
        {/* Top Spacer for vertical centering */}
        <div className="hidden lg:block" />

        {/* Main Form Container */}
        <div className="w-full max-w-[360px] mx-auto my-auto flex flex-col">
          {/* Brand Logo */}
          <div className="mb-6">
            <Link href="/" className="inline-flex items-center">
              <Image
                src="/logo.svg"
                alt="Catelxg"
                width={125}
                height={38}
                priority
                className="dark:invert object-contain"
              />
            </Link>
          </div>

          {/* Heading & Subtitle */}
          <div className="mb-6">
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
              {mode === "sign-up" ? "Create an Account" : "Welcome Back"}
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
              {mode === "sign-up"
                ? "Sign up to get started"
                : "Sign in to your account to continue"}
            </p>
          </div>

          {/* Smart Google Account Hint Banner */}
          {googlePrompt && (
            <div className="mb-4 rounded-lg bg-primary/10 border border-primary/30 p-3 text-xs text-foreground flex flex-col gap-2.5 animate-in fade-in duration-200">
              <div className="space-y-0.5">
                <p className="font-semibold">Existing Google Account Found</p>
                <p className="text-muted-foreground leading-relaxed">
                  This email was registered using Google and has no password
                  yet. Continue with Google below:
                </p>
              </div>

              <Button
                type="button"
                onClick={() => handleSocialSignIn("google")}
                className="w-full h-9 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs flex items-center justify-center gap-2 cursor-pointer transition-all"
              >
                <Image
                  src="/search.png"
                  alt="Google"
                  width={14}
                  height={14}
                  className="object-contain"
                />
                <span>Continue with Google</span>
              </Button>
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-xs text-destructive">
              {error}
            </div>
          )}

          {/* Stacked Social & Guest Buttons */}
          <div className="flex flex-col gap-2.5">
            {/* Continue with Google */}
            <Button
              type="button"
              variant="outline"
              onClick={() => handleSocialSignIn("google")}
              disabled={isLoading !== null}
              className="relative w-full h-10 rounded-lg border border-border bg-card/50 hover:bg-accent/50 active:scale-[0.99] transition-all duration-150 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2.5 font-medium text-xs sm:text-sm text-foreground shadow-2xs"
            >
              {isLoading === "google" ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <Image
                  src="/search.png"
                  alt="Google"
                  width={15}
                  height={15}
                  className="object-contain shrink-0"
                />
              )}
              <span>Continue with Google</span>

              {lastUsed === "google" && (
                <span className="absolute -top-2 right-2 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-border shadow-2xs">
                  Last used
                </span>
              )}
            </Button>

            {/* Continue with GitHub */}
            <Button
              type="button"
              variant="outline"
              onClick={() => handleSocialSignIn("github")}
              disabled={isLoading !== null}
              className="relative w-full h-10 rounded-lg border border-border bg-card/50 hover:bg-accent/50 active:scale-[0.99] transition-all duration-150 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2.5 font-medium text-xs sm:text-sm text-foreground shadow-2xs"
            >
              {isLoading === "github" ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <Image
                  src="/github.png"
                  alt="GitHub"
                  width={16}
                  height={16}
                  className="rounded-full object-contain shrink-0"
                />
              )}
              <span>Continue with GitHub</span>

              {lastUsed === "github" && (
                <span className="absolute -top-2 right-2 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-border shadow-2xs">
                  Last used
                </span>
              )}
            </Button>

            {/* Continue with Guest Mode */}
            <Button
              type="button"
              variant="outline"
              onClick={handleGuestMode}
              disabled={isLoading !== null}
              className="relative w-full h-10 rounded-lg border border-border bg-card/50 hover:bg-accent/50 active:scale-[0.99] transition-all duration-150 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2.5 font-medium text-xs sm:text-sm text-foreground shadow-2xs"
            >
              <User className="h-4 w-4 text-muted-foreground shrink-0" />
              <span>Continue with Guest Mode</span>

              {lastUsed === "guest" && (
                <span className="absolute -top-2 right-2 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-border shadow-2xs">
                  Last used
                </span>
              )}
            </Button>
          </div>

          {/* Divider */}
          <div className="relative my-5 flex items-center justify-center">
            <div className="w-full border-t border-border/80" />
            <span className="absolute bg-background px-3 text-xs text-muted-foreground">
              or
            </span>
          </div>

          {/* Email & Password Form */}
          <form onSubmit={handleFormSubmit} className="space-y-3.5">
            {mode === "sign-up" && (
              <div className="space-y-1.5 animate-in fade-in duration-150">
                <label
                  htmlFor="name"
                  className="block text-xs font-medium text-foreground"
                >
                  Full Name
                </label>
                <div className="relative flex items-center">
                  <span className="absolute left-3 text-muted-foreground pointer-events-none">
                    <User className="h-3.5 w-3.5" />
                  </span>
                  <input
                    id="name"
                    type="text"
                    placeholder="Enter your full name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full h-10 pl-9 pr-3.5 rounded-lg border border-border bg-muted/40 dark:bg-muted/25 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-ring focus:ring-1 focus:ring-ring transition-colors"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label
                htmlFor="email"
                className="block text-xs font-medium text-foreground"
              >
                Email
              </label>
              <div className="relative flex items-center">
                <span className="absolute left-3 text-muted-foreground pointer-events-none">
                  <Mail className="h-3.5 w-3.5" />
                </span>
                <input
                  id="email"
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-10 pl-9 pr-3.5 rounded-lg border border-border bg-muted/40 dark:bg-muted/25 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-ring focus:ring-1 focus:ring-ring transition-colors"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="password"
                className="block text-xs font-medium text-foreground"
              >
                Password
              </label>
              <div className="relative flex items-center">
                <span className="absolute left-3 text-muted-foreground pointer-events-none">
                  <Lock className="h-3.5 w-3.5" />
                </span>
                <input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-10 pl-9 pr-3.5 rounded-lg border border-border bg-muted/40 dark:bg-muted/25 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-ring focus:ring-1 focus:ring-ring transition-colors"
                />
              </div>
            </div>

            <div className="pt-1">
              <Button
                type="submit"
                disabled={isLoading !== null}
                className="w-full h-10 rounded-lg bg-neutral-800 text-white font-medium text-xs sm:text-sm flex items-center justify-center active:scale-[0.99] transition-all cursor-pointer disabled:opacity-50 shadow-xs"
              >
                {isLoading === "form" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : mode === "sign-up" ? (
                  "Continue with Email"
                ) : (
                  "Sign in with Email"
                )}
              </Button>
            </div>
          </form>

          {/* Switch Mode Link */}
          <p className="mt-5 text-xs text-muted-foreground">
            {mode === "sign-up" ? (
              <>
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => {
                    setMode("sign-in");
                    setError(null);
                    setGooglePrompt(false);
                  }}
                  className="font-medium text-black hover:underline transition-colors cursor-pointer"
                >
                  Sign in
                </button>
              </>
            ) : (
              <>
                Don&apos;t have an account?{" "}
                <button
                  type="button"
                  onClick={() => {
                    setMode("sign-up");
                    setError(null);
                    setGooglePrompt(false);
                  }}
                  className="font-medium text-black hover:underline transition-colors cursor-pointer"
                >
                  Create account
                </button>
              </>
            )}
          </p>
        </div>

        {/* Bottom Legal Links */}
        <div className="w-full max-w-[360px] mx-auto pt-6 flex items-center gap-5 text-xs text-muted-foreground">
          <Link href="#" className="hover:text-foreground transition-colors">
            Privacy
          </Link>
          <Link href="#" className="hover:text-foreground transition-colors">
            Terms
          </Link>
          <Link href="#" className="hover:text-foreground transition-colors">
            Support
          </Link>
        </div>
      </div>

      {/* Right Column: Nature Image Showcase Card */}
      <div className="hidden lg:flex h-full p-4 pl-0">
        <div className="relative w-full h-full rounded-2xl border border-border/60 dark:border-white/10 overflow-hidden bg-[#070709] flex flex-col justify-between select-none">
          {/* Unsplash Nature Image (Night Mountain Horizon) */}
          <img
            src="https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1600&q=85"
            alt="Nature landscape"
            className="absolute inset-0 h-full w-full object-cover object-bottom opacity-75 scale-105"
          />

          {/* Deep Dark Top-Down Gradient Overlay + Horizon Atmospheric Glow */}
          <div className="absolute inset-0 bg-gradient-to-b from-[#09090b] via-[#09090b]/92 via-55% to-black/35" />
          <div
            className="absolute inset-x-0 bottom-0 h-[48%] pointer-events-none"
            style={{
              background:
                "radial-gradient(ellipse 80% 55% at 50% 85%, rgba(56, 102, 220, 0.28) 0%, rgba(15, 23, 42, 0.15) 55%, transparent 100%)",
            }}
          />

          {/* Top Spacer */}
          <div />

          {/* Center Quote & Founder Info */}
          <div className="relative z-10 flex flex-col items-center text-center px-10 max-w-md mx-auto my-auto">
            <p className="text-lg xl:text-xl font-medium leading-relaxed text-white/95 tracking-tight">
              Your agent is Ready,
              <br />
              Now time to put it for work.
            </p>

            <div className="mt-6 flex flex-col items-center">
              <div className="h-11 w-11 rounded-full overflow-hidden border border-white/20 shadow-md mb-2.5">
                <Image
                  src="/me.png"
                  alt="ROX"
                  width={44}
                  height={44}
                  className="h-full w-full rounded-full object-cover"
                />
              </div>
              <span className="text-sm font-medium text-white">ROX</span>
              <span className="text-[11px] text-white/55 mt-0.5">
                Founder of Catelog
              </span>
            </div>
          </div>

          {/* Bottom Spacer */}
          <div />
        </div>
      </div>
    </div>
  );
}
