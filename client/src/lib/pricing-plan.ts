/**
 * Pricing rules for Step 3. No LLM: everything is decided from the agent's own input/output
 * schemas and the tags the creator picked.
 *
 * Three price shapes:
 *  - per_run   one fixed price per successful run. The ONLY shape that can allow negotiation.
 *  - per_unit  a price per delivered item (lead, page, ...) plus a minimum charge per run.
 *  - tiered    one fixed price per option of an input field (one per enum value).
 *
 * Buyers are charged only for successful runs (billing is not part of this file).
 */

import { tagById } from "./agent-tags";

type JsonObj = Record<string, any>;

export type PricingShape = "per_run" | "per_unit" | "tiered";

export const SHAPE_LABEL: Record<PricingShape, string> = {
  per_run: "Per run",
  per_unit: "Per delivered unit",
  tiered: "Per option (tiers)",
};

/** 1 wallet credit = $0.01, so nothing can be priced below one credit yet. */
export const MIN_PRICE_USD = 0.01;
export const MAX_PRICE_USD = 100;

// ─────────────────────────────────────────────────
//  Category rules: which tags default to which shape, and who may negotiate
// ─────────────────────────────────────────────────

interface TagRule {
  shape: PricingShape;
  /** Unused for negotiation now (see negotiationFor); kept so the table still reads as "default shape per tag". */
  negotiable: boolean;
}

const FIXED_PER_RUN: TagRule = { shape: "per_run", negotiable: true };
const PER_UNIT: TagRule = { shape: "per_unit", negotiable: false };
const TIERED: TagRule = { shape: "tiered", negotiable: false };

/**
 * Only exceptions are listed. Every other category (research, plagiarism, story writer,
 * summarization, translation, outreach, ...) is per run and may allow negotiation.
 */
export const TAG_RULES: Record<string, TagRule> = {
  // quantity work: the price follows what is delivered
  "lead-generation": PER_UNIT,
  "data-enrichment": PER_UNIT,
  "data-extraction": PER_UNIT,
  "price-monitoring": PER_UNIT,
  "bulk-processing": PER_UNIT,
  // depth work: the buyer picks how thorough
  seo: TIERED,
  "ai-search-geo": TIERED,
  "web-audit": TIERED,
  "code-review": TIERED,
  "ui-ux-testing": TIERED,
  "qa-testing": TIERED,
  "security-scan": TIERED,
};

const ruleFor = (tagId: string): TagRule | undefined => TAG_RULES[tagId];

// ─────────────────────────────────────────────────
//  Reading the schemas
// ─────────────────────────────────────────────────

function propsOf(schema?: JsonObj): Record<string, JsonObj> {
  if (!schema || typeof schema !== "object") return {};
  let node: JsonObj = schema;
  // zod-to-json-schema can wrap the real schema in a $ref
  if (!node.properties && typeof node.$ref === "string") {
    const name = node.$ref.split("/").pop() ?? "";
    node = node.definitions?.[name] ?? node.$defs?.[name] ?? node;
  }
  return (node.properties as Record<string, JsonObj>) ?? {};
}

const typeOf = (p: JsonObj): string | undefined => (Array.isArray(p.type) ? p.type.find((t: string) => t !== "null") : p.type);

const flat = (key: string) => key.toLowerCase().replace(/[^a-z]/g, "");

const TIER_NAMES = ["mode", "depth", "tier", "level", "quality", "speed", "plan", "effort", "thoroughness", "detail", "package"];
const QTY_HINTS = ["count", "limit", "quantity", "qty", "numberof", "numof", "howmany", "topk", "maxresults", "maxleads", "maxitems", "maxpages", "maxjobs", "maxrecords", "maxrows"];
const QTY_EXACT = ["n", "num", "number", "total", "results", "leads", "pages", "items"];
const LIST_HINTS = ["leads", "results", "items", "records", "rows", "contacts", "jobs", "pages", "products", "listings", "companies", "entries"];

export interface TierField {
  key: string;
  values: string[];
}

export interface UnitInfo {
  /** Input field that says how many items the buyer wants. */
  countKey: string;
  countMax?: number;
  /** Output list whose length the marketplace counts as "delivered". */
  outputKey: string;
  /** Singular noun suggested for the unit ("lead"). */
  label: string;
}

/** An input option with 2 to 5 fixed values and a name like mode / depth / tier. */
export function detectTierField(inputSchema?: JsonObj): TierField | undefined {
  for (const [key, p] of Object.entries(propsOf(inputSchema))) {
    const values = Array.isArray(p.enum) ? p.enum : undefined;
    if (!values || values.length < 2 || values.length > 5) continue;
    if (!values.every((v) => typeof v === "string")) continue;
    if (TIER_NAMES.some((n) => flat(key).includes(n))) return { key, values: values as string[] };
  }
  return undefined;
}

const singular = (w: string) => (w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.endsWith("s") && w.length > 3 ? w.slice(0, -1) : w);

/** A numeric "how many" input AND a list in the output that can be counted. */
export function detectUnit(inputSchema?: JsonObj, outputSchema?: JsonObj): UnitInfo | undefined {
  const inProps = propsOf(inputSchema);
  const countKey = Object.keys(inProps).find((k) => {
    const t = typeOf(inProps[k]);
    if (t !== "integer" && t !== "number") return false;
    const f = flat(k);
    return QTY_EXACT.includes(f) || QTY_HINTS.some((h) => f.includes(h));
  });
  if (!countKey) return undefined;

  const outProps = propsOf(outputSchema);
  const lists = Object.keys(outProps).filter((k) => typeOf(outProps[k]) === "array");
  if (lists.length === 0) return undefined;
  const outputKey = lists.find((k) => LIST_HINTS.some((h) => flat(k).includes(h))) ?? lists[0];

  const max = inProps[countKey].maximum;
  return {
    countKey,
    countMax: typeof max === "number" ? max : undefined,
    outputKey,
    label: singular(flat(outputKey) || "item"),
  };
}

// ─────────────────────────────────────────────────
//  Which shapes are possible, which is suggested, who may negotiate
// ─────────────────────────────────────────────────

export interface PricingOptions {
  tier?: TierField;
  unit?: UnitInfo;
  available: PricingShape[];
  suggested: PricingShape;
  /** Plain-language reason shown to the creator. */
  reason: string;
}

export function resolvePricing(
  inputSchema: JsonObj | undefined,
  outputSchema: JsonObj | undefined,
  tagIds: string[],
): PricingOptions {
  const tier = detectTierField(inputSchema);
  const unit = detectUnit(inputSchema, outputSchema);
  const available: PricingShape[] = ["per_run"];
  if (unit) available.push("per_unit");
  if (tier) available.push("tiered");

  // What the chosen categories lean towards, ignoring shapes the schema cannot support
  const votes = tagIds.map((id) => ruleFor(id)?.shape).filter((s): s is PricingShape => !!s && available.includes(s));

  let suggested: PricingShape = "per_run";
  if (votes.includes("per_unit")) suggested = "per_unit";
  else if (votes.includes("tiered")) suggested = "tiered";
  else if (tier) suggested = "tiered";
  else if (unit) suggested = "per_unit";

  const reason =
    suggested === "tiered" && tier
      ? `Your input has a "${tier.key}" option (${tier.values.join(", ")}), so each option gets its own fixed price.`
      : suggested === "per_unit" && unit
        ? `Your input has "${unit.countKey}" and your output returns a "${unit.outputKey}" list, so buyers pay for each delivered ${unit.label}.`
        : "One fixed price for each successful run.";

  return { tier, unit, available, suggested, reason };
}

export interface NegotiationRule {
  allowed: boolean;
  /** Why not, when it is not allowed. */
  reason?: string;
}

/**
 * Negotiation depends only on the price shape: a per-run price can always be negotiated, whatever the tags
 * (an SEO agent priced per run can negotiate too). Per-unit and tiered prices are fixed by nature.
 * `tagIds` is kept so callers do not change; tags no longer matter here.
 */
export function negotiationFor(shape: PricingShape, _tagIds: string[]): NegotiationRule {
  if (shape !== "per_run") {
    return { allowed: false, reason: "Per-unit and tiered prices are fixed, so they cannot be negotiated." };
  }
  return { allowed: true };
}

// ─────────────────────────────────────────────────
//  The plan the creator fills in
// ─────────────────────────────────────────────────

export interface PerRunPlan {
  shape: "per_run";
  priceUsd: number;
  /** Lowest price the creator will accept. Present only when negotiation is on. */
  negotiation?: { minPriceUsd: number };
}

export interface PerUnitPlan {
  shape: "per_unit";
  unitLabel: string;
  countKey: string;
  outputKey: string;
  pricePerUnitUsd: number;
  /** Charged even when fewer units are delivered, so tiny orders still cover your cost. */
  minChargeUsd: number;
  maxUnitsPerRun?: number;
}

export interface TieredPlan {
  shape: "tiered";
  fieldKey: string;
  tiers: Array<{ value: string; priceUsd: number }>;
}

export type PricingPlan = PerRunPlan | PerUnitPlan | TieredPlan;

const okPrice = (n: number) => Number.isFinite(n) && n >= MIN_PRICE_USD && n <= MAX_PRICE_USD;
const usd = (n: number) => `$${n}`;

/** Returns a list of problems; empty means the plan can be saved. */
export function validatePlan(plan: PricingPlan | null, options: PricingOptions, tagIds: string[]): string[] {
  if (!plan) return ["Set a price."];
  const errors: string[] = [];
  const range = `${usd(MIN_PRICE_USD)} to ${usd(MAX_PRICE_USD)}`;

  if (!options.available.includes(plan.shape)) errors.push("This price type does not fit your agent's schema.");

  if (plan.shape === "per_run") {
    if (!okPrice(plan.priceUsd)) errors.push(`Price must be from ${range}.`);
    if (plan.negotiation) {
      if (!negotiationFor("per_run", tagIds).allowed) errors.push("Negotiation is not available for this agent.");
      else if (!okPrice(plan.negotiation.minPriceUsd)) errors.push(`Lowest price must be from ${range}.`);
      else if (plan.negotiation.minPriceUsd > plan.priceUsd) errors.push("Lowest price cannot be above your listed price.");
    }
  } else if (plan.shape === "per_unit") {
    if (!plan.unitLabel.trim()) errors.push("Name the unit (for example: lead).");
    if (!okPrice(plan.pricePerUnitUsd)) errors.push(`Price per ${plan.unitLabel || "unit"} must be from ${range}.`);
    if (!okPrice(plan.minChargeUsd)) errors.push(`Minimum charge must be from ${range}.`);
    else if (okPrice(plan.pricePerUnitUsd) && plan.minChargeUsd < plan.pricePerUnitUsd) {
      errors.push("Minimum charge should be at least the price of one unit.");
    }
    if (plan.maxUnitsPerRun !== undefined && (!Number.isInteger(plan.maxUnitsPerRun) || plan.maxUnitsPerRun < 1)) {
      errors.push("Maximum units per run must be a whole number of 1 or more.");
    }
  } else {
    const wanted = options.tier?.values ?? [];
    if (wanted.some((v) => !plan.tiers.find((t) => t.value === v))) errors.push("Every option needs a price.");
    if (plan.tiers.some((t) => !okPrice(t.priceUsd))) errors.push(`Each tier price must be from ${range}.`);
  }
  return errors;
}

/** Empty starting point for a shape (no prices guessed). */
export function emptyPlan(shape: PricingShape, options: PricingOptions): PricingPlan {
  if (shape === "per_unit" && options.unit) {
    return {
      shape,
      unitLabel: options.unit.label,
      countKey: options.unit.countKey,
      outputKey: options.unit.outputKey,
      pricePerUnitUsd: NaN,
      minChargeUsd: NaN,
      maxUnitsPerRun: options.unit.countMax,
    };
  }
  if (shape === "tiered" && options.tier) {
    return { shape, fieldKey: options.tier.key, tiers: options.tier.values.map((value) => ({ value, priceUsd: NaN })) };
  }
  return { shape: "per_run", priceUsd: NaN };
}
