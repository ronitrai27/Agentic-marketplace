"use client";

import React, { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AGREEMENT_LABEL,
  CONFIRM_WORD,
  CONTRACT_TITLE,
  DECLARATION_PARAGRAPHS,
  PAYMENTS_TITLE,
  PAYMENT_RULES,
  contractAsText,
} from "@/lib/contract-text";

export function ContractStep({ onAcceptedChange }: { onAcceptedChange: (accepted: boolean) => void }) {
  const [agreed, setAgreed] = useState(false);
  const [typed, setTyped] = useState("");
  const [copied, setCopied] = useState(false);

  const accepted = agreed && typed.trim().toUpperCase() === CONFIRM_WORD;

  useEffect(() => {
    onAcceptedChange(accepted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accepted]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(contractAsText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard blocked: nothing else to do
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-foreground">{CONTRACT_TITLE}</h3>
          <p className="text-sm text-muted-foreground mt-1.5">
            Please read this before you publish. You can copy it to share with your team or your AI assistant.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={copy} className="shrink-0 cursor-pointer">
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      <section className="space-y-3">
        {DECLARATION_PARAGRAPHS.map((p) => (
          <p key={p.slice(0, 24)} className="text-sm text-foreground/90 leading-relaxed">
            {p}
          </p>
        ))}
      </section>

      <section className="space-y-3">
        <h4 className="text-sm font-semibold text-foreground">{PAYMENTS_TITLE}</h4>
        <ol className="space-y-3">
          {PAYMENT_RULES.map((r, i) => (
            <li key={r.title} className="flex gap-3 text-sm leading-relaxed">
              <span className="text-muted-foreground tabular-nums w-4 shrink-0">{i + 1}.</span>
              <p className="text-foreground/90">
                <span className="font-medium text-foreground">{r.title}.</span> {r.body}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-4 rounded-lg border border-border p-4">
        <div className="flex items-start gap-3">
          <Checkbox id="agree" checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} className="mt-0.5" />
          <Label htmlFor="agree" className="text-sm font-normal leading-relaxed cursor-pointer">
            {AGREEMENT_LABEL}
          </Label>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm" className="text-xs text-muted-foreground">
            Type {CONFIRM_WORD} to acknowledge
          </Label>
          <Input
            id="confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={CONFIRM_WORD}
            autoComplete="off"
            className="w-48"
          />
        </div>
      </section>
    </div>
  );
}
