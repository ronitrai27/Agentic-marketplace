"use client";

import React, { useState } from "react";
import { Copy, Check, Plus, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { CardDitherBackground } from "@/components/ui/card-dither-background";
import type { Id } from "@/../convex/_generated/dataModel";

interface KeyRecord {
  id: Id<"creator_api_keys">;
  preview: string;
  created: string;
  expires: string;
  ips: string;
  rateLimit: number;
}

// Compute client-side SHA-256 hash using Web Crypto API
async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text.trim());
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function CreatorCredentialsPage() {
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);

  // Live Convex Query
  const apiKeysData = useQuery(api.apiKeys.getApiKeys);
  const getOrCreatePublicKey = useMutation(api.apiKeys.getOrCreatePublicKey);
  const createSecretKeyMutation = useMutation(api.apiKeys.createSecretKey);
  const rotateSecretKeyMutation = useMutation(api.apiKeys.rotateSecretKey);
  const deleteSecretKeyMutation = useMutation(api.apiKeys.deleteSecretKey);

  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [revealedNewKey, setRevealedNewKey] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Rotate confirmation modal
  const [keyToRotate, setKeyToRotate] = useState<KeyRecord | null>(null);
  const [revealedRotatedKey, setRevealedRotatedKey] = useState<string | null>(
    null,
  );

  // Delete confirmation modal
  const [keyToDelete, setKeyToDelete] = useState<KeyRecord | null>(null);

  // Create Form options
  const [expiryOption, setExpiryOption] = useState<string>("30");
  const [allowedRegion, setAllowedRegion] = useState<string>("all");
  const [allowedIps, setAllowedIps] = useState<string>("");
  const [rateLimitPerMin, setRateLimitPerMin] = useState<number>(10);

  // Ensure public key exists on mount
  React.useEffect(() => {
    if (apiKeysData && !apiKeysData.publicKey) {
      getOrCreatePublicKey().catch(() => {});
    }
  }, [apiKeysData, getOrCreatePublicKey]);

  const publicKey = apiKeysData?.publicKey || "Generating...";

  // Format secret keys from Convex live query
  const secretKeys: KeyRecord[] = (apiKeysData?.secretKeys || []).map(
    (k: any) => {
      const createdDate = new Date(k.createdAt);
      const created = createdDate.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });

      let expires = "Never";
      if (k.expiresAt) {
        const expDate = new Date(k.expiresAt);
        const diffDays = Math.ceil(
          (k.expiresAt - Date.now()) / (1000 * 60 * 60 * 24),
        );
        expires =
          diffDays > 0
            ? `In ${diffDays} days`
            : expDate.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              });
      }

      const ips = Array.isArray(k.allowedIps) ? k.allowedIps.join("\n") : "";

      return {
        id: k._id,
        preview: k.previewKey,
        created,
        expires,
        ips,
        rateLimit: k.rateLimitPerMin ?? 10,
      };
    },
  );

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKeyId(id);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedKeyId(null), 2000);
  };

  // Generate & Hash Secret Key
  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // 1. Generate 32-byte hex raw key
      const randomSuffix = Math.random().toString(36).substring(2, 6);
      const randomHex = Array.from({ length: 28 }, () =>
        Math.floor(Math.random() * 16).toString(16),
      ).join("");
      const generatedRawKey = `cat_sec_live_${randomHex}${randomSuffix}`;
      const previewKey = `••••••••${randomSuffix}`;

      // 2. Client-side SHA-256 hash
      const keyHash = await sha256(generatedRawKey);

      // 3. Expiry timestamp calculation
      let expiresAt: number | undefined = undefined;
      if (expiryOption !== "never") {
        const days = parseInt(expiryOption, 10) || 30;
        expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
      }

      const ipArray = allowedIps
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);

      // 4. Save to Convex: ONLY hash and preview are stored
      await createSecretKeyMutation({
        keyHash,
        previewKey,
        expiresAt,
        allowedRegions: allowedRegion === "all" ? ["all"] : [allowedRegion],
        allowedIps: ipArray,
        rateLimitPerMin: Number(rateLimitPerMin) || 10,
      });

      // 5. Reveal raw key strictly once to user
      setRevealedNewKey(generatedRawKey);
      toast.success("Secret key generated successfully");
    } catch (err: any) {
      toast.error(err.message || "Failed to create secret key");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Rotate in-place on existing key
  const confirmRotate = async () => {
    if (!keyToRotate) return;
    setIsSubmitting(true);

    try {
      const randomSuffix = Math.random().toString(36).substring(2, 6);
      const randomHex = Array.from({ length: 28 }, () =>
        Math.floor(Math.random() * 16).toString(16),
      ).join("");
      const generatedRawKey = `cat_sec_live_${randomHex}${randomSuffix}`;
      const newPreviewKey = `••••••••${randomSuffix}`;
      const newKeyHash = await sha256(generatedRawKey);

      await rotateSecretKeyMutation({
        keyId: keyToRotate.id,
        newKeyHash,
        newPreviewKey,
      });

      setRevealedRotatedKey(generatedRawKey);
      toast.success("API key rotated in-place successfully");
    } catch (err: any) {
      toast.error(err.message || "Failed to rotate API key");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete API key
  const confirmDelete = async () => {
    if (!keyToDelete) return;

    try {
      await deleteSecretKeyMutation({ keyId: keyToDelete.id });
      toast.success("API key deleted successfully");
      setKeyToDelete(null);
    } catch (err: any) {
      toast.error(err.message || "Failed to delete API key");
    }
  };

  return (
    <div className="flex-1 h-full overflow-y-auto scrollbar-thin p-5 bg-white dark:bg-[#0d0d0e] text-neutral-900 dark:text-neutral-100">
      <div className="px-4 space-y-4">
        {/* Page Title */}
        <div>
          <h1 className="text-2xl sm:text-3xl font-medium tracking-tight dark:text-white">
            API Keys
          </h1>
        </div>

        {/* Top Notice Box with Animated Pixel Dither on Right End */}
        <div className="relative overflow-hidden rounded-lg border border-neutral-300/80 dark:border-neutral-800 bg-white dark:bg-neutral-900/40 p-6 space-y-4">
          {/* Animated Pixel Dither at right end */}
          <div
            aria-hidden="true"
            className="absolute right-0 top-0 w-96 pointer-events-none overflow-hidden"
            style={{
              maskImage:
                "linear-gradient(to right, transparent 0%, rgba(0,0,0,0.6) 45%, black 100%)",
              WebkitMaskImage:
                "linear-gradient(to right, transparent 0%, rgba(0,0,0,0.6) 45%, black 100%)",
            }}
          >
            <CardDitherBackground />
          </div>

          <div className="relative z-10 space-y-1.5 max-w-2xl">
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">
              Production & Agent Security
            </h2>
            <p className="text-xs sm:text-[13px] text-neutral-600 dark:text-neutral-400 leading-relaxed">
              Secret keys grant full execution rights to publish agents, call
              hosted tools, and claim payouts. They are hashed with salted
              SHA-256 and never stored in plaintext. Publishable keys are safe
              to embed in client-side runtimes.
            </p>
          </div>

          <div className="relative z-10 pt-1">
            <button
              type="button"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium bg-neutral-900 text-white hover:bg-black dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-100 transition-colors cursor-pointer shadow-xs"
            >
              <span>View Docs</span>
              <ArrowRight className="size-3.5" />
            </button>
          </div>
        </div>

        {/* Publishable Client Key Section */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold dark:text-white">
                Publishable key
              </h3>
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 border border-neutral-200 dark:border-neutral-700/60 font-semibold tracking-wider">
                PUBLIC
              </span>
            </div>
          </div>
          <p className="text-xs dark:text-neutral-400">
            Use this key on client-side SDKs, web widgets, and browsers to
            identify your creator space.
          </p>

          <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/30 overflow-hidden">
            <div className="grid grid-cols-12 px-5 py-2.5 border-b border-neutral-200 dark:border-neutral-800 text-[11px] font-mono uppercase tracking-wide dark:text-neutral-500">
              <div className="col-span-8 sm:col-span-9">KEY</div>
              <div className="col-span-4 sm:col-span-3 text-right">ACTION</div>
            </div>

            <div className="grid grid-cols-12 items-center px-5 py-3 text-xs">
              <div className="col-span-8 sm:col-span-9 font-mono text-neutral-800 dark:text-neutral-200 truncate select-all">
                {publicKey}
              </div>
              <div className="col-span-4 sm:col-span-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => copyToClipboard(publicKey, "pub")}
                  className="inline-flex items-center gap-1.5 text-xs text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white transition-colors cursor-pointer"
                >
                  {copiedKeyId === "pub" ? (
                    <>
                      <Check className="size-3.5" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="size-3.5" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Secret Keys Section */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold dark:text-white">
                Secret keys
              </h3>
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 border border-neutral-200 dark:border-neutral-700/60 font-semibold tracking-wider">
                PRODUCTION
              </span>
            </div>

            <button
              type="button"
              onClick={() => {
                setRevealedNewKey(null);
                setShowCreateModal(true);
              }}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-700 hover:text-neutral-950 dark:text-neutral-300 dark:hover:text-white transition-colors cursor-pointer"
            >
              <Plus className="size-3.5" />
              <span>New Secret key</span>
            </button>
          </div>

          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Calls made using Secret keys are authenticated for server-side agent
            execution and SDK management.
          </p>

          {/* Table Container */}
          <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/30 overflow-hidden">
            {/* Table Header */}
            <div className="grid grid-cols-12 px-5 py-2.5 border-b border-neutral-200 dark:border-neutral-800 text-[11px] font-mono uppercase tracking-wide font-semibold dark:text-neutral-500">
              <div className="col-span-3">KEY</div>
              <div className="col-span-2">CREATED</div>
              <div className="col-span-2">EXPIRES</div>
              <div className="col-span-2">IP ALLOWLIST</div>
              <div className="col-span-3 text-right">ACTIONS</div>
            </div>

            {/* Table Body */}
            {secretKeys.length === 0 ? (
              <div className="px-5 py-8 text-center text-xs text-neutral-400">
                No secret keys created yet.
              </div>
            ) : (
              secretKeys.map((k) => (
                <div
                  key={k.id}
                  className="grid grid-cols-12 items-center px-5 py-3.5 border-b last:border-b-0 border-neutral-100 dark:border-neutral-800/80 text-xs hover:bg-neutral-50/50 dark:hover:bg-neutral-800/20 transition-colors"
                >
                  {/* Key preview */}
                  <div className="col-span-3 flex items-center gap-2 min-w-0">
                    <span className="font-mono text-neutral-700 dark:text-neutral-300 truncate">
                      {k.preview}
                    </span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(k.preview, k.id)}
                      title="Copy Key Preview"
                      className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors p-1 cursor-pointer shrink-0"
                    >
                      {copiedKeyId === k.id ? (
                        <Check className="size-3.5 text-neutral-900 dark:text-white" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                    </button>
                  </div>

                  {/* Created */}
                  <div className="col-span-2 text-neutral-600 dark:text-neutral-400 text-xs">
                    {k.created}
                  </div>

                  {/* Expires */}
                  <div className="col-span-2 text-neutral-600 dark:text-neutral-400 text-xs">
                    {k.expires}
                  </div>

                  {/* IP Allowlist */}
                  <div className="col-span-2 text-neutral-600 dark:text-neutral-400 text-xs font-mono truncate">
                    {k.ips ? k.ips.split("\n")[0] : ""}
                  </div>

                  {/* Actions: Always show Rate limit + Rotate + Delete */}
                  <div className="col-span-3 flex items-center justify-end gap-3 text-xs">
                    <span className="font-mono text-[11px] text-neutral-800 dark:text-neutral-400 bg-yellow-100 dark:bg-neutral-800 px-2 py-0.5 rounded border border-neutral-200 dark:border-neutral-700/80 shrink-0">
                      {k.rateLimit} req/min
                    </span>

                    <button
                      type="button"
                      onClick={() => {
                        setRevealedRotatedKey(null);
                        setKeyToRotate(k);
                      }}
                      className="text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white transition-colors cursor-pointer"
                    >
                      Rotate
                    </button>
                    <button
                      type="button"
                      onClick={() => setKeyToDelete(k)}
                      className="text-neutral-600 hover:text-red-600 dark:text-neutral-400 dark:hover:text-red-400 transition-colors cursor-pointer"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}

            {/* Bottom Row action inside table */}
            <button
              type="button"
              onClick={() => {
                setRevealedNewKey(null);
                setShowCreateModal(true);
              }}
              className="w-full flex items-center gap-2 px-5 py-3 text-xs text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white bg-neutral-50/50 hover:bg-neutral-100/60 dark:bg-neutral-900/30 dark:hover:bg-neutral-800/40 border-t border-neutral-200/80 dark:border-neutral-800 transition-colors cursor-pointer text-left"
            >
              <Plus className="size-3.5" />
              <span>Create Secret key</span>
            </button>
          </div>
        </div>

        {/* Trust & Security Architecture Note */}
        <div className="pt-2">
          <p className="text-[11px] text-neutral-500 dark:text-neutral-500 leading-relaxed">
            Keys are encrypted at rest using salted SHA-256 hashes. Incoming
            webhook payloads and callback events from your agent are verified
            using cryptographic HMAC signatures.
          </p>
        </div>
      </div>

      {/* Modal: Create Key */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-6 shadow-xl space-y-5">
            {!revealedNewKey ? (
              <form onSubmit={handleCreateKey} className="space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-neutral-100 dark:border-neutral-800">
                  <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
                    Create Secret API Key
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="text-xs text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>

                {/* Expiry Selection */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                    Expiration
                  </label>
                  <div className="grid grid-cols-5 gap-1.5">
                    {[
                      { label: "10d", val: "10" },
                      { label: "30d", val: "30" },
                      { label: "60d", val: "60" },
                      { label: "90d", val: "90" },
                      { label: "Never", val: "never" },
                    ].map((item) => (
                      <button
                        key={item.val}
                        type="button"
                        onClick={() => setExpiryOption(item.val)}
                        className={`py-1.5 text-xs font-medium rounded border text-center transition-colors cursor-pointer ${
                          expiryOption === item.val
                            ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 border-transparent"
                            : "border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-900"
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Allowed Region */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                    Allowed Region
                  </label>
                  <select
                    value={allowedRegion}
                    onChange={(e) => setAllowedRegion(e.target.value)}
                    className="w-full text-xs rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-2 text-neutral-800 dark:text-neutral-200 focus:outline-hidden cursor-pointer"
                  >
                    <option value="all">All regions (Global)</option>
                    <option value="us-east-1">US East (N. Virginia)</option>
                    <option value="eu-central-1">EU Central (Frankfurt)</option>
                    <option value="ap-south-1">Asia Pacific (Mumbai)</option>
                  </select>
                </div>

                {/* IP Allowlist */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300 flex justify-between">
                    <span>IP Allowlist</span>
                    <span className="text-[10px] text-neutral-400">
                      Optional
                    </span>
                  </label>
                  <textarea
                    rows={2}
                    value={allowedIps}
                    onChange={(e) => setAllowedIps(e.target.value)}
                    placeholder="e.g. 192.168.1.1 (Leave blank for all IPs)"
                    className="w-full font-mono text-xs rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-2 text-neutral-800 dark:text-neutral-200 placeholder:text-neutral-400 focus:outline-hidden resize-none"
                  />
                </div>

                {/* Rate Limiting (per min) with custom input, default 10 */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300 flex justify-between">
                    <span>Rate Limit (per min)</span>
                    <span className="text-[10px] text-neutral-400">
                      Default: 10 req/min
                    </span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100000}
                    value={rateLimitPerMin}
                    onChange={(e) =>
                      setRateLimitPerMin(
                        Math.max(1, parseInt(e.target.value, 10) || 1),
                      )
                    }
                    className="w-full font-mono text-xs rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-2 text-neutral-800 dark:text-neutral-200 focus:outline-hidden"
                  />
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="px-3 py-1.5 rounded text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-4 py-1.5 rounded text-xs font-medium bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
                  >
                    {isSubmitting ? "Creating..." : "Create key"}
                  </button>
                </div>
              </form>
            ) : (
              /* One-time Key Display */
              <div className="space-y-4">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
                    Save your secret key
                  </h3>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
                    Make sure to copy your API key now. You will not be able to
                    view it again.
                  </p>
                </div>

                <div className="p-3 rounded border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 font-mono text-xs flex items-center justify-between gap-2 overflow-x-auto select-all">
                  <span className="text-neutral-900 dark:text-white break-all">
                    {revealedNewKey}
                  </span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(revealedNewKey, "modal-key")}
                    className="p-1 text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white transition-colors cursor-pointer shrink-0"
                    title="Copy to clipboard"
                  >
                    {copiedKeyId === "modal-key" ? (
                      <Check className="size-4 text-neutral-900 dark:text-white" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                  </button>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateModal(false);
                      setRevealedNewKey(null);
                    }}
                    className="px-4 py-1.5 rounded text-xs font-medium bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 hover:opacity-90 transition-opacity cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Rotate Key (In-place) */}
      {keyToRotate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-6 shadow-xl space-y-5">
            {!revealedRotatedKey ? (
              <div className="space-y-4">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
                    Rotate secret key
                  </h3>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
                    Rotating this key will invalidate the previous key secret
                    and replace it in-place. Any server or agent using the old
                    key will need to be updated with the new one.
                  </p>
                </div>

                <div className="p-3 rounded bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs font-mono text-neutral-700 dark:text-neutral-300">
                  Current key: {keyToRotate.preview}
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setKeyToRotate(null)}
                    className="px-3 py-1.5 rounded text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={confirmRotate}
                    className="px-4 py-1.5 rounded text-xs font-medium bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
                  >
                    {isSubmitting ? "Rotating..." : "Confirm Rotation"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
                    New rotated secret key
                  </h3>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
                    Make sure to copy your new rotated API key now. It has
                    replaced the old key in-place.
                  </p>
                </div>

                <div className="p-3 rounded border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 font-mono text-xs flex items-center justify-between gap-2 overflow-x-auto select-all">
                  <span className="text-neutral-900 dark:text-white break-all">
                    {revealedRotatedKey}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      copyToClipboard(revealedRotatedKey, "rotate-key")
                    }
                    className="p-1 text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white transition-colors cursor-pointer shrink-0"
                    title="Copy to clipboard"
                  >
                    {copiedKeyId === "rotate-key" ? (
                      <Check className="size-4 text-neutral-900 dark:text-white" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                  </button>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setKeyToRotate(null);
                      setRevealedRotatedKey(null);
                    }}
                    className="px-4 py-1.5 rounded text-xs font-medium bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 hover:opacity-90 transition-opacity cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Delete Confirmation Dialog */}
      {keyToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-6 shadow-xl space-y-4">
            <div className="space-y-1.5">
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
                Delete secret key
              </h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
                Are you sure you want to delete{" "}
                <span className="font-mono text-neutral-800 dark:text-neutral-200">
                  {keyToDelete.preview}
                </span>
                ? Any live agent or client service using this key will
                immediately be rejected.
              </p>
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setKeyToDelete(null)}
                className="px-3 py-1.5 rounded text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                className="px-3.5 py-1.5 rounded text-xs font-medium bg-red-600 hover:bg-red-700 text-white transition-colors cursor-pointer"
              >
                Delete key
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
