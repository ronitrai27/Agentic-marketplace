"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function AuthCallbackPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (!isPending) {
      toast.dismiss();
      if (session?.user) {
        const user = session.user as any;
        if (!user.onboardingCompleted) {
          router.replace("/welcome");
        } else {
          router.replace("/space");
        }
      } else {
        router.replace("/auth");
      }
    }
  }, [session, isPending, router]);

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-background text-foreground">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Completing authentication...
        </p>
      </div>
    </div>
  );
}
