"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useConvex } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import {
  User,
  Mail,
  Lock,
  Loader2,
  ArrowRight,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
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
    <div className="relative min-h-screen w-full flex flex-col items-center justify-center bg-background text-foreground px-4 py-12 transition-colors selection:bg-primary/10">
      <div className="w-full max-w-[420px] flex flex-col items-center">
        {/* Brand / Logo */}
        <div className="w-full flex flex-col items-start mb-7 pl-1">
          <div className="mb-5 flex items-center justify-center">
            <Image
              src="/logo.svg"
              alt="Logo"
              width={140}
              height={44}
              priority
              className="dark:invert-0 brightness-100 object-contain"
            />
          </div>

          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {mode === "sign-up" ? (
              <>
                Create account{" "}
                <span className="font-normal text-muted-foreground">
                  to get started
                </span>
              </>
            ) : (
              <>
                Welcome back{" "}
                <span className="font-normal text-muted-foreground">
                  to your space
                </span>
              </>
            )}
          </h1>
        </div>

        {/* Linear Minimal Card */}
        <div className="w-full rounded-lg border border-border bg-card p-7 shadow-xs hover:border-border transition-all">
          {/* Smart Google Account Hint Banner */}
          {googlePrompt && (
            <div className="mb-5 rounded-lg bg-blue-500/10 border border-blue-500/30 p-3.5 text-xs text-foreground flex flex-col gap-2.5 animate-in fade-in duration-200">
              <div className="flex items-start gap-2.5">
                <Sparkles className="size-4 text-blue-500 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <p className="font-semibold text-blue-600 dark:text-blue-400">
                    Existing Google Account Found
                  </p>
                  <p className="text-muted-foreground leading-relaxed">
                    This email was registered using Google and has no password
                    yet. Continue with Google below:
                  </p>
                </div>
              </div>

              <Button
                type="button"
                onClick={() => handleSocialSignIn("google")}
                className="w-full h-9 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs flex items-center justify-center gap-2 cursor-pointer transition-all shadow-xs"
              >
                <Image
                  src="/search.png"
                  alt="Google"
                  width={15}
                  height={15}
                  className="object-contain"
                />
                <span>Continue with Google</span>
              </Button>
            </div>
          )}

          {error && (
            <div className="mb-5 rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-xs text-destructive">
              {error}
            </div>
          )}

          <form onSubmit={handleFormSubmit} className="space-y-4">
            {/* Full Name (Only in sign-up mode) */}
            {mode === "sign-up" && (
              <div className="space-y-1.5 animate-in fade-in duration-150">
                <label
                  htmlFor="name"
                  className="block text-xs font-medium text-foreground tracking-tight"
                >
                  Full Name
                </label>
                <div className="relative flex items-center">
                  <span className="absolute left-3.5 text-muted-foreground pointer-events-none">
                    <User className="h-4 w-4" />
                  </span>
                  <input
                    id="name"
                    type="text"
                    placeholder="John Doe"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full h-11 pl-10 pr-3.5 rounded-lg border border-border bg-input/30 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-ring focus:ring-1 focus:ring-ring transition-colors"
                  />
                </div>
              </div>
            )}

            {/* Email */}
            <div className="space-y-1.5">
              <label
                htmlFor="email"
                className="block text-xs font-medium text-foreground tracking-tight"
              >
                Email
              </label>
              <div className="relative flex items-center">
                <span className="absolute left-3.5 text-muted-foreground pointer-events-none">
                  <Mail className="h-4 w-4" />
                </span>
                <input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-11 pl-10 pr-3.5 rounded-lg border border-border bg-input/30 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-ring focus:ring-1 focus:ring-ring transition-colors"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label
                htmlFor="password"
                className="block text-xs font-medium text-foreground tracking-tight"
              >
                Password
              </label>
              <div className="relative flex items-center">
                <span className="absolute left-3.5 text-muted-foreground pointer-events-none">
                  <Lock className="h-4 w-4" />
                </span>
                <input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-11 pl-10 pr-3.5 rounded-lg border border-border bg-input/30 text-sm text-foreground placeholder:text-muted-foreground/60 tracking-wider focus:outline-none focus:border-ring focus:ring-1 focus:ring-ring transition-colors"
                />
              </div>
            </div>

            {/* Primary Action Button */}
            <div className="pt-2">
              <Button
                type="submit"
                disabled={isLoading !== null}
                className="w-full h-11 rounded-lg bg-primary text-primary-foreground font-medium text-sm flex items-center justify-center hover:opacity-90 active:scale-[0.99] transition-all cursor-pointer disabled:opacity-50"
              >
                {isLoading === "form" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : mode === "sign-up" ? (
                  "Create account"
                ) : (
                  "Sign in"
                )}
              </Button>
            </div>
          </form>

          {/* Divider */}
          <div className="relative my-6 flex items-center justify-center">
            <div className="w-full border-t border-border/80" />
            <span className="absolute bg-card px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Or continue with
            </span>
          </div>

          {/* Social Signups: Google & GitHub with Last Used Badges */}
          <div className="grid grid-cols-2 gap-3">
            {/* Google */}
            <Button
              type="button"
              variant="outline"
              onClick={() => handleSocialSignIn("google")}
              disabled={isLoading !== null}
              className="relative h-10 rounded-lg border border-border bg-card hover:bg-accent/40 active:scale-[0.98] transition-all duration-150 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2 font-medium text-sm text-foreground"
            >
              {isLoading === "google" ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <Image
                  src="/search.png"
                  alt="Google"
                  width={18}
                  height={18}
                  className="object-contain"
                />
              )}
              <span>Google</span>

              {lastUsed === "google" && (
                <span className="absolute -top-2 -right-1 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-neutral-50 border shadow-2xs">
                  Last used
                </span>
              )}
            </Button>

            {/* GitHub */}
            <Button
              type="button"
              variant="outline"
              onClick={() => handleSocialSignIn("github")}
              disabled={isLoading !== null}
              className="relative h-10 rounded-lg border border-border bg-card hover:bg-accent/40 active:scale-[0.98] transition-all duration-150 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2 font-medium text-sm text-foreground"
            >
              {isLoading === "github" ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <Image
                  src="/github.png"
                  alt="GitHub"
                  width={18}
                  height={18}
                  className="rounded-full object-contain"
                />
              )}
              <span>Github</span>

              {lastUsed === "github" && (
                <span className="absolute -top-2 -right-1 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 shadow-2xs">
                  Last used
                </span>
              )}
            </Button>
          </div>
        </div>

        {/* Footer / Switch between Sign In and Sign Up */}
        <p className="mt-8 text-center text-xs text-muted-foreground">
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
                className="font-medium text-foreground hover:underline transition-colors ml-1 cursor-pointer"
              >
                Sign in
              </button>
            </>
          ) : (
            <>
              Don't have an account?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("sign-up");
                  setError(null);
                  setGooglePrompt(false);
                }}
                className="font-medium text-foreground hover:underline transition-colors ml-1 cursor-pointer"
              >
                Create account
              </button>
            </>
          )}
        </p>

        {/* Bottom links */}
        <div className="mt-6 flex items-center justify-center gap-6 text-[11px] text-muted-foreground">
          <Link
            href="#"
            className="hover:text-muted-foreground transition-colors"
          >
            Terms
          </Link>
          <Link
            href="#"
            className="hover:text-muted-foreground transition-colors"
          >
            Privacy
          </Link>
          <Link
            href="#"
            className="hover:text-muted-foreground transition-colors"
          >
            Support
          </Link>
        </div>
      </div>
    </div>
  );
}
