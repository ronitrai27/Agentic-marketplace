"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

export const GUEST_STORAGE_KEY = "catelxg_guest_mode";
export const GUEST_LAST_AUTH_KEY = "catelxg_last_auth_provider";

export function useGuest() {
  const router = useRouter();
  const [isGuest, setIsGuest] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const checkGuest = () => {
      try {
        const stored = localStorage.getItem(GUEST_STORAGE_KEY) === "true";
        setIsGuest(stored);
      } catch {
        setIsGuest(false);
      } finally {
        setIsReady(true);
      }
    };

    checkGuest();

    const handleStorageChange = () => {
      checkGuest();
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("catelxg-guest-change", handleStorageChange);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("catelxg-guest-change", handleStorageChange);
    };
  }, []);

  const enterGuestMode = useCallback(() => {
    try {
      localStorage.setItem(GUEST_STORAGE_KEY, "true");
      localStorage.setItem(GUEST_LAST_AUTH_KEY, "guest");
      window.dispatchEvent(new Event("catelxg-guest-change"));
    } catch (e) {
      console.error("Failed to set guest mode in storage:", e);
    }
    setIsGuest(true);
    router.push("/space");
  }, [router]);

  const exitGuestMode = useCallback(() => {
    try {
      localStorage.removeItem(GUEST_STORAGE_KEY);
      window.dispatchEvent(new Event("catelxg-guest-change"));
    } catch (e) {
      console.error("Failed to remove guest mode from storage:", e);
    }
    setIsGuest(false);
    router.push("/auth");
  }, [router]);

  return {
    isGuest,
    isReady,
    enterGuestMode,
    exitGuestMode,
  };
}
