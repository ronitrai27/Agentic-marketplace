"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { User, Mail, Lock, Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function AuthPage() {
  const router = useRouter();
  const { data: session, isPending: isSessionLoading } = authClient.useSession();
  const hasTriggeredRef = useRef(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState<
    "google" | "github" | "form" | null
  >(null);
  const [error, setError] = useState<string | null>(null);

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

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Email/password is UI-only as requested
  };

  return (
    <div className="relative min-h-screen w-full flex flex-col items-center justify-center bg-background text-foreground px-4 py-12 transition-colors selection:bg-primary/10">
      {/* Subtle back navigation */}
      {/* <Link
        href="/"
        className="absolute top-6 left-6 inline-flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back
      </Link> */}

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
            Create account{" "}
            <span className="font-normal text-muted-foreground">
              to get started
            </span>
          </h1>
        </div>

        {/* Linear Minimal Card */}
        <div className="w-full rounded-lg border border-border bg-card p-7 shadow-xs hover:border-border transition-all">
          {error && (
            <div className="mb-5 rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-xs text-destructive">
              {error}
            </div>
          )}

          <form onSubmit={handleFormSubmit} className="space-y-4">
            {/* Full Name */}
            <div className="space-y-1.5">
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
                className="w-full h-11 rounded-lg bg-primary text-primary-foreground font-medium text-sm flex items-center justify-center hover:opacity-90 active:scale-[0.99] transition-all cursor-pointer"
              >
                Create account
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

          {/* Social Signups: Google & GitHub */}
          <div className="grid grid-cols-2 gap-3">
            {/* Google */}
            <Button
              type="button"
              variant="outline"
              onClick={() => handleSocialSignIn("google")}
              disabled={isLoading !== null}
              className="h-10 rounded-lg border border-border bg-card hover:bg-accent/40 active:scale-[0.98] transition-all duration-150 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2.5 font-medium text-sm text-foreground"
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
            </Button>

            {/* GitHub */}
            <Button
              type="button"
              variant="outline"
              onClick={() => handleSocialSignIn("github")}
              disabled={isLoading !== null}
              className="h-10 rounded-lg border border-border bg-card hover:bg-accent/40 active:scale-[0.98] transition-all duration-150 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2.5 font-medium text-sm text-foreground"
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
            </Button>
          </div>
        </div>

        {/* Footer / Switch to Sign in */}
        <p className="mt-8 text-center text-xs text-muted-foreground">
          Already have an account?{" "}
          <Link
            href="/auth"
            className="font-medium text-foreground hover:underline transition-colors ml-1"
          >
            Sign in
          </Link>
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
