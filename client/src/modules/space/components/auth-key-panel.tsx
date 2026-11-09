"use client";

import React, { useState } from "react";
import { Copy, Check, Eye, EyeOff, Plus } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/../convex/_generated/api";

const DAY = 24 * 60 * 60 * 1000;

const EXPIRY_OPTIONS = [
  { label: "30d", days: 30 },
  { label: "60d", days: 60 },
  { label: "90d", days: 90 },
  { label: "Never", days: null },
] as const;

type ExpiryDays = (typeof EXPIRY_OPTIONS)[number]["days"];

function expiryText(expiresAt: number | null) {
  if (!expiresAt) return "Never";
  const days = Math.ceil((expiresAt - Date.now()) / DAY);
  if (days <= 0) return "Expired";
  return `In ${days} day${days === 1 ? "" : "s"}`;
}

type Dialog = "create" | "rotate" | null;

export function AuthKeyPanel() {
  const authKey = useQuery(api.apiKeys.getAuthKey);
  const createAuthKey = useAction(api.apiKeysActions.createAuthKey);
  const rotateAuthKey = useAction(api.apiKeysActions.rotateAuthKey);
  const revealAuthKey = useAction(api.apiKeysActions.revealAuthKey);
  const setExpiry = useMutation(api.apiKeys.setAuthKeyExpiry);

  const [dialog, setDialog] = useState<Dialog>(null);
  const [newExpiry, setNewExpiry] = useState<ExpiryDays>(30);
  // Full key, kept in memory only after the creator reveals/copies it.
  const [rawKey, setRawKey] = useState<string | null>(null);
  // Key shown inside the create/rotate dialog after it succeeds.
  const [dialogKey, setDialogKey] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>, fallback: string) => {
    setBusy(true);
    try {
      await fn();
    } catch (err: any) {
      toast.error(err?.message || fallback);
    } finally {
      setBusy(false);
    }
  };

  const loadKey = async (): Promise<string> => {
    if (rawKey) return rawKey;
    const { rawKey: k } = await revealAuthKey();
    setRawKey(k);
    return k;
  };

  const copy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const closeDialog = () => {
    setDialog(null);
    setDialogKey(null);
  };

  const handleCreate = () =>
    run(async () => {
      await createAuthKey({
        expiresAt: newExpiry === null ? undefined : Date.now() + newExpiry * DAY,
      });
      const { rawKey: k } = await revealAuthKey();
      setRawKey(k);
      setDialogKey(k);
    }, "Failed to create auth key");

  const handleRotate = () =>
    run(async () => {
      await rotateAuthKey();
      const { rawKey: k } = await revealAuthKey();
      setRawKey(k);
      setVisible(false);
      setDialogKey(k);
    }, "Failed to rotate key");

  const handleToggle = () =>
    run(async () => {
      if (!visible) await loadKey();
      setVisible((v) => !v);
    }, "Could not load the key");

  const handleCopyRow = () =>
    run(async () => copy(await loadKey(), "row"), "Could not copy the key");

  const handleExpiry = (days: ExpiryDays) =>
    run(async () => {
      await setExpiry({
        expiresAt: days === null ? null : Date.now() + days * DAY,
      });
      toast.success("Expiry updated");
    }, "Failed to update expiry");

  if (authKey === undefined) {
    return (
      <div className="h-24 animate-pulse bg-neutral-100 dark:bg-neutral-800/50" />
    );
  }

  const expired = !!authKey?.expiresAt && authKey.expiresAt <= Date.now();
  const display = visible && rawKey ? rawKey : authKey?.previewKey;

  return (
    <>
      {/* Table */}
      <div className="grid grid-cols-12 px-5 py-2.5 border-b border-neutral-200 dark:border-neutral-800 text-[11px] font-mono uppercase tracking-wide font-semibold dark:text-neutral-500">
        <div className="col-span-5">KEY</div>
        <div className="col-span-2">CREATED</div>
        <div className="col-span-2">EXPIRES</div>
        <div className="col-span-3 text-right">ACTIONS</div>
      </div>

      {authKey === null ? (
        <>
          <div className="px-5 py-8 text-center text-xs text-neutral-400">
            No auth key created yet.
          </div>
          <button
            type="button"
            onClick={() => setDialog("create")}
            className="w-full flex items-center gap-2 px-5 py-3 text-xs text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white bg-neutral-50/50 hover:bg-neutral-100/60 dark:bg-neutral-900/30 dark:hover:bg-neutral-800/40 border-t border-neutral-200/80 dark:border-neutral-800 transition-colors cursor-pointer text-left"
          >
            <Plus className="size-3.5" />
            <span>Create auth key</span>
          </button>
        </>
      ) : (
        <div className="grid grid-cols-12 items-center px-5 py-3.5 text-xs">
          <div className="col-span-5 flex items-center gap-1 min-w-0">
            <span className="font-mono text-neutral-700 dark:text-neutral-300 truncate select-all">
              {display}
            </span>
            <button
              type="button"
              onClick={handleToggle}
              disabled={busy}
              title={visible ? "Hide key" : "Show key"}
              className="p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors cursor-pointer shrink-0"
            >
              {visible ? (
                <EyeOff className="size-3.5" />
              ) : (
                <Eye className="size-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={handleCopyRow}
              disabled={busy}
              title="Copy key"
              className="p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors cursor-pointer shrink-0"
            >
              {copiedId === "row" ? (
                <Check className="size-3.5 text-neutral-900 dark:text-white" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </button>
          </div>

          <div className="col-span-2 text-neutral-600 dark:text-neutral-400">
            {new Date(authKey.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </div>

          <div
            className={`col-span-2 ${
              expired
                ? "text-red-600 dark:text-red-400"
                : "text-neutral-600 dark:text-neutral-400"
            }`}
          >
            {expiryText(authKey.expiresAt)}
          </div>

          <div className="col-span-3 flex items-center justify-end gap-3">
            <select
              value=""
              onChange={(e) => {
                const o = EXPIRY_OPTIONS[Number(e.target.value)];
                if (o) handleExpiry(o.days);
              }}
              disabled={busy}
              className="text-xs rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2 py-1 text-neutral-700 dark:text-neutral-300 focus:outline-hidden cursor-pointer"
            >
              <option value="" disabled>
                Expiry
              </option>
              {EXPIRY_OPTIONS.map((o, i) => (
                <option key={o.label} value={i}>
                  {o.days === null ? "Never" : `${o.days} days`}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setDialog("rotate")}
              className="text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white transition-colors cursor-pointer"
            >
              Rotate
            </button>
          </div>
        </div>
      )}

      {/* Dialogs */}
      {dialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-6 shadow-xl space-y-5">
            {!dialogKey ? (
              <div className="space-y-4">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
                    {dialog === "create"
                      ? "Create auth key"
                      : "Rotate auth key"}
                  </h3>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
                    {dialog === "create"
                      ? "You get one key. Copy it into your n8n Header Auth credential."
                      : "The old key stops working as soon as you replace it in n8n. Update your n8n credential right after."}
                  </p>
                </div>

                {dialog === "create" && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                      Expiration
                    </label>
                    <div className="grid grid-cols-4 gap-1.5">
                      {EXPIRY_OPTIONS.map((o) => (
                        <button
                          key={o.label}
                          type="button"
                          onClick={() => setNewExpiry(o.days)}
                          className={`py-1.5 text-xs font-medium rounded border text-center transition-colors cursor-pointer ${
                            newExpiry === o.days
                              ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 border-transparent"
                              : "border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-900"
                          }`}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeDialog}
                    className="px-3 py-1.5 rounded text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={dialog === "create" ? handleCreate : handleRotate}
                    className="px-4 py-1.5 rounded text-xs font-medium bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
                  >
                    {busy
                      ? dialog === "create"
                        ? "Creating..."
                        : "Rotating..."
                      : dialog === "create"
                        ? "Create key"
                        : "Confirm rotation"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
                    {dialog === "create" ? "Your auth key" : "New auth key"}
                  </h3>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
                    Copy it into your n8n Header Auth credential. Header name:{" "}
                    <span className="font-mono">X-Marketplace-Key</span>.
                    You can copy it again any time from this page.
                  </p>
                </div>

                <div className="p-3 rounded border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 font-mono text-xs flex items-center justify-between gap-2 select-all">
                  <span className="text-neutral-900 dark:text-white break-all">
                    {dialogKey}
                  </span>
                  <button
                    type="button"
                    onClick={() => copy(dialogKey, "dialog")}
                    className="p-1 text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white transition-colors cursor-pointer shrink-0"
                    title="Copy to clipboard"
                  >
                    {copiedId === "dialog" ? (
                      <Check className="size-4" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                  </button>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={closeDialog}
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
    </>
  );
}
