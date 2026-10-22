"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LogOut, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface LogoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LogoutDialog({ open, onOpenChange }: LogoutDialogProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [isGuest, setIsGuest] = useState(false);

  React.useEffect(() => {
    try {
      setIsGuest(localStorage.getItem("catelxg_guest_mode") === "true");
    } catch {
      setIsGuest(false);
    }
  }, [open]);

  const handleLogout = async () => {
    setIsLoading(true);
    const toastId = toast.loading(isGuest ? "Exiting guest mode..." : "Logging out...");

    try {
      localStorage.removeItem("catelxg_guest_mode");
      window.dispatchEvent(new Event("catelxg-guest-change"));
      await authClient.signOut();
    } catch (err: any) {
      console.warn("Logout note:", err);
    } finally {
      localStorage.removeItem("catelxg_guest_mode");
      window.dispatchEvent(new Event("catelxg-guest-change"));
      toast.dismiss(toastId);
      toast.success(isGuest ? "Exited Guest Mode" : "Logged out successfully");
      setIsLoading(false);
      onOpenChange(false);
      router.replace("/auth");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-full bg-destructive/10 text-destructive flex items-center justify-center shrink-0">
              <LogOut className="size-5" />
            </div>
            <div className="space-y-1">
              <DialogTitle>
                {isGuest ? "Exit Guest Mode" : "Confirm Logout"}
              </DialogTitle>
              <DialogDescription>
                {isGuest
                  ? "Are you sure you want to exit Guest Mode and return to the sign-in screen?"
                  : "Are you sure you want to log out of your account?"}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <DialogFooter className="mt-2 flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={isLoading}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={isLoading}
            onClick={handleLogout}
            className="inline-flex items-center gap-2"
          >
            {isLoading ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                <span>Logging out...</span>
              </>
            ) : (
              <>
                <LogOut className="size-4" />
                <span>Log out</span>
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
