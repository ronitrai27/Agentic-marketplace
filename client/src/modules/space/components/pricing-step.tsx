"use client";

import React, { useEffect, useMemo, useState } from "react";
import { CircleAlert, Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  MAX_PRICE_USD,
  MIN_PRICE_USD,
  SHAPE_LABEL,
  emptyPlan,
  negotiationFor,
  resolvePricing,
  validatePlan,
  type PricingPlan,
  type PricingShape,
} from "@/lib/pricing-plan";

type JsonObj = Record<string, any>;

const SHAPE_HINT: Record<PricingShape, string> = {
  per_run: "One price for each successful run",
  per_unit: "A price for each delivered item",
  tiered: "A price for each option of an input field",
};

const SHAPE_NEEDS: Record<PricingShape, string> = {
  per_run: "",
  per_unit: "Needs a numeric count field in your input and a list in your output.",
  tiered: "Needs an input option with 2 to 5 fixed values, like mode or depth.",
};

const num = (s: string) => (s.trim() === "" ? NaN : Number(s));

function Money({
  value,
  onChange,
  placeholder,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  id?: string;
}) {
  return (
    <div className="relative w-36">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
      <Input
        id={id}
        inputMode="decimal"
        value={value}
        placeholder={placeholder ?? "0.00"}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
        className="pl-6"
      />
    </div>
  );
}

/** Raw form values, kept so the creator can leave the step (or reload) without losing them. */
export interface PricingDraft {
  picked: PricingShape | null;
  price: string;
  negotiate: boolean;
  minPrice: string;
  unitLabel: string;
  unitPrice: string;
  minCharge: string;
  maxUnits: string;
  tierPrices: Record<string, string>;
}

export function PricingStep({
  inputSchema,
  outputSchema,
  tags,
  dryRunCostUsd,
  initialDraft,
  onDraftChange,
  onChange,
}: {
  inputSchema?: JsonObj;
  outputSchema?: JsonObj;
  tags: string[];
  /** LLM cost of the dry run, shown as a floor hint. */
  dryRunCostUsd?: number;
  initialDraft?: PricingDraft;
  onDraftChange?: (draft: PricingDraft) => void;
  onChange: (plan: PricingPlan | null, valid: boolean) => void;
}) {
  const options = useMemo(() => resolvePricing(inputSchema, outputSchema, tags), [inputSchema, outputSchema, tags]);

  // null = follow the rule-based suggestion until the creator picks a shape themselves
  const [picked, setPicked] = useState<PricingShape | null>(initialDraft?.picked ?? null);
  const shape = picked && options.available.includes(picked) ? picked : options.suggested;
  const negotiation = negotiationFor(shape, tags);

  const [touched, setTouched] = useState(false);
  const [price, setPrice] = useState(initialDraft?.price ?? "");
  const [negotiate, setNegotiate] = useState(initialDraft?.negotiate ?? false);
  const [minPrice, setMinPrice] = useState(initialDraft?.minPrice ?? "");
  const [unitLabel, setUnitLabel] = useState(initialDraft?.unitLabel ?? "");
  const [unitPrice, setUnitPrice] = useState(initialDraft?.unitPrice ?? "");
  const [minCharge, setMinCharge] = useState(initialDraft?.minCharge ?? "");
  const [maxUnits, setMaxUnits] = useState(
    initialDraft?.maxUnits ?? (options.unit?.countMax ? String(options.unit.countMax) : ""),
  );
  const [tierPrices, setTierPrices] = useState<Record<string, string>>(initialDraft?.tierPrices ?? {});

  useEffect(() => {
    onDraftChange?.({ picked, price, negotiate, minPrice, unitLabel, unitPrice, minCharge, maxUnits, tierPrices });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, price, negotiate, minPrice, unitLabel, unitPrice, minCharge, maxUnits, tierPrices]);

  const plan: PricingPlan = useMemo(() => {
    const base = emptyPlan(shape, options);
    if (base.shape === "per_run") {
      return {
        ...base,
        priceUsd: num(price),
        negotiation: negotiate && negotiation.allowed ? { minPriceUsd: num(minPrice) } : undefined,
      };
    }
    if (base.shape === "per_unit") {
      const max = maxUnits.trim() === "" ? undefined : Number(maxUnits);
      return {
        ...base,
        unitLabel: unitLabel || base.unitLabel,
        pricePerUnitUsd: num(unitPrice),
        minChargeUsd: num(minCharge),
        maxUnitsPerRun: max,
      };
    }
    return { ...base, tiers: base.tiers.map((t) => ({ ...t, priceUsd: num(tierPrices[t.value] ?? "") })) };
  }, [shape, options, price, negotiate, negotiation.allowed, minPrice, unitLabel, unitPrice, minCharge, maxUnits, tierPrices]);

  const errors = useMemo(() => validatePlan(plan, options, tags), [plan, options, tags]);
  const valid = errors.length === 0;

  useEffect(() => {
    onChange(valid ? plan : null, valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid, plan]);

  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    setTouched(true);
    set(v);
  };

  const runPrice = plan.shape === "per_run" ? plan.priceUsd : NaN;
  const belowCost = dryRunCostUsd !== undefined && Number.isFinite(runPrice) && runPrice < dryRunCostUsd;

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-foreground">Pricing</h3>
        <p className="text-sm text-muted-foreground mt-1.5">
          Buyers pay only when a run succeeds. Failed or timed-out runs are never charged.
        </p>
      </div>

      {/* Shape */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {(["per_run", "per_unit", "tiered"] as PricingShape[]).map((s) => {
          const available = options.available.includes(s);
          const on = shape === s;
          return (
            <button
              key={s}
              type="button"
              disabled={!available}
              title={available ? undefined : SHAPE_NEEDS[s]}
              onClick={() => {
                setTouched(true);
                setPicked(s);
              }}
              className={`text-left rounded-lg border p-3 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${
                on ? "border-foreground bg-muted/50" : "border-border hover:bg-muted/40"
              }`}
            >
              <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
                {SHAPE_LABEL[s]}
                {s === options.suggested && (
                  <span className="text-[10px] font-normal text-muted-foreground">suggested</span>
                )}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">{SHAPE_HINT[s]}</p>
            </button>
          );
        })}
      </div>
      {shape === options.suggested && <p className="text-xs text-muted-foreground">{options.reason}</p>}

      {/* Fields */}
      <div className="rounded-lg border border-border p-4 space-y-4">
        {plan.shape === "per_run" && (
          <div className="space-y-1.5">
            <Label htmlFor="price-run" className="text-xs">
              Price per successful run
            </Label>
            <Money id="price-run" value={price} onChange={edit(setPrice)} />
          </div>
        )}

        {plan.shape === "per_unit" && options.unit && (
          <>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="unit-name" className="text-xs">
                  What is one unit?
                </Label>
                <Input
                  id="unit-name"
                  value={unitLabel || options.unit.label}
                  onChange={(e) => edit(setUnitLabel)(e.target.value)}
                  className="w-36"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="unit-price" className="text-xs">
                  Price per {unitLabel || options.unit.label}
                </Label>
                <Money id="unit-price" value={unitPrice} onChange={edit(setUnitPrice)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="unit-min" className="text-xs">
                  Minimum charge per run
                </Label>
                <Money id="unit-min" value={minCharge} onChange={edit(setMinCharge)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="unit-max" className="text-xs">
                  Max {unitLabel || options.unit.label}s per run
                </Label>
                <Input
                  id="unit-max"
                  inputMode="numeric"
                  value={maxUnits}
                  placeholder="No limit"
                  onChange={(e) => edit(setMaxUnits)(e.target.value.replace(/\D/g, ""))}
                  className="w-36"
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Buyers are charged for the items in your &quot;{options.unit.outputKey}&quot; output that were
              actually delivered, never less than the minimum charge.
            </p>
          </>
        )}

        {plan.shape === "tiered" && options.tier && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Price for each &quot;{options.tier.key}&quot; option the buyer can pick.
            </p>
            {options.tier.values.map((v) => (
              <div key={v} className="flex items-center justify-between gap-4">
                <Label htmlFor={`tier-${v}`} className="text-xs font-mono">
                  {v}
                </Label>
                <Money
                  id={`tier-${v}`}
                  value={tierPrices[v] ?? ""}
                  onChange={(x) => edit(setTierPrices)({ ...tierPrices, [v]: x })}
                />
              </div>
            ))}
          </div>
        )}

        {dryRunCostUsd !== undefined && (
          <p className="text-[11px] text-muted-foreground">
            Your LLM cost for the dry run was about ${dryRunCostUsd.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}.
            Tool and hosting costs are not included, so keep your price above your real cost.
          </p>
        )}
        {belowCost && (
          <p className="text-xs text-destructive flex items-center gap-1.5">
            <CircleAlert className="size-3.5" /> This price is below your LLM cost for one run.
          </p>
        )}
      </div>

      {/* Negotiation */}
      <div className="rounded-lg border border-border p-4 space-y-3">
        {negotiation.allowed ? (
          <>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-foreground">Allow price negotiation</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Buyers can offer a lower price. You never go below your lowest price.
                </p>
              </div>
              <Switch checked={negotiate} onCheckedChange={edit(setNegotiate)} />
            </div>
            {negotiate && (
              <div className="space-y-1.5">
                <Label htmlFor="min-price" className="text-xs">
                  Lowest price you accept
                </Label>
                <Money id="min-price" value={minPrice} onChange={edit(setMinPrice)} />
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground flex items-start gap-2">
            <Lock className="size-3.5 shrink-0 mt-0.5" />
            <span>
              <span className="text-foreground font-medium">Fixed price.</span> {negotiation.reason}
            </span>
          </p>
        )}
      </div>

      {touched && errors.length > 0 && (
        <p className="text-xs text-destructive flex items-center gap-1.5">
          <CircleAlert className="size-3.5" />
          {errors[0]}
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">
        Prices can be from ${MIN_PRICE_USD} to ${MAX_PRICE_USD}.
      </p>
    </section>
  );
}
