"use client";

import React, { useRef, useState } from "react";
import { Camera, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { AgentLogo } from "./agent-logo";

/** Logos are square: 256x256 covers the 40px UI slots at 2x+ and matches the square icons in /public. */
const LOGO_SIZE = 256;
const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml";

/** Fit the image inside a transparent 256x256 PNG, centred, no cropping. */
async function toSquarePng(file: File): Promise<Blob> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = objectUrl;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = LOGO_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not available.");
    const w = img.naturalWidth || LOGO_SIZE;
    const h = img.naturalHeight || LOGO_SIZE;
    const scale = Math.min(LOGO_SIZE / w, LOGO_SIZE / h);
    const dw = w * scale;
    const dh = h * scale;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, (LOGO_SIZE - dw) / 2, (LOGO_SIZE - dh) / 2, dw, dh);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Could not process image."))),
        "image/png",
      ),
    );
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function LogoUpload({
  name,
  logoUrl,
  onChange,
  className = "size-14 text-lg",
  showBadge = false,
}: {
  name: string;
  logoUrl?: string | null;
  /** Called with the uploaded public URL. */
  onChange: (url: string) => void | Promise<void>;
  className?: string;
  /** Always-visible small upload icon at the bottom-right corner. */
  showBadge?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Choose an image file.");
      return;
    }
    if (file.size > MAX_INPUT_BYTES) {
      toast.error("Image must be under 4 MB.");
      return;
    }
    setBusy(true);
    try {
      const png = await toSquarePng(file);
      const body = new FormData();
      body.append("file", png, "logo.png");
      const res = await fetch("/api/agents/logo", { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok || !data.url) throw new Error(data.error ?? "Upload failed.");
      await onChange(data.url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => inputRef.current?.click()}
      title="Upload logo"
      aria-label="Upload logo"
      className="group relative shrink-0 rounded-lg cursor-pointer disabled:cursor-wait"
    >
      <AgentLogo name={name} logoUrl={logoUrl} className={className} />
      <span className="absolute inset-0 rounded-lg bg-black/45 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity">
        <Camera className="size-4" />
      </span>
      {showBadge && (
        <span className="absolute -bottom-1 -right-1 size-4 rounded-full border border-border bg-background text-muted-foreground flex items-center justify-center shadow-2xs group-hover:text-foreground transition-colors">
          <Upload className="size-2.5" />
        </span>
      )}
      {busy && (
        <span className="absolute inset-0 rounded-lg bg-background/70 flex items-center justify-center">
          <Loader2 className="size-4 animate-spin" />
        </span>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />
    </button>
  );
}
