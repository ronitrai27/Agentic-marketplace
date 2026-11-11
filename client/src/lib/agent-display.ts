/** Display helpers for registered agents (money is stored as integer micro-USD). */

export interface ModelIcon {
  src: string;
  name: string;
  /** Class that keeps a single-colour logo visible in both themes. */
  theme?: string;
}

const ICONS: Array<[RegExp, ModelIcon]> = [
  [/^n8n$/, { src: "/n8n-color.svg", name: "n8n" }],
  [/claude|anthropic/, { src: "/claude-color.svg", name: "Claude" }],
  // openai.svg is white, so it needs flipping to dark in light mode
  [/^(gpt|o\d|chatgpt)|openai/, { src: "/openai.svg", name: "OpenAI", theme: "invert dark:invert-0" }],
  [/gemini|google/, { src: "/gemini-color.svg", name: "Gemini" }],
  [/llama|meta/, { src: "/meta-color.svg", name: "Meta" }],
  [/mistral|mixtral/, { src: "/mistral-color.svg", name: "Mistral" }],
  // ollama.svg is black
  [/ollama/, { src: "/ollama.svg", name: "Ollama", theme: "dark:invert" }],
  [/openrouter/, { src: "/openrouter-color.svg", name: "OpenRouter" }],
  // groq.svg is currentColor (black as an <img>)
  [/groq/, { src: "/groq.svg", name: "Groq", theme: "dark:invert" }],
];

/** Services that only host other makers' models: their logo wins over the model's maker (llama on Ollama, gpt-oss on Groq). */
const HOSTS = /^(ollama|groq|openrouter)$/;

/** Distinct logos for a set of models (three GPT variants show one OpenAI mark). */
export function uniqueModelIcons(models: Array<{ id: string; provider?: string }>): ModelIcon[] {
  const seen = new Map<string, ModelIcon>();
  for (const m of models) {
    const icon = modelIcon(m.id, m.provider);
    if (icon && !seen.has(icon.src)) seen.set(icon.src, icon);
  }
  return [...seen.values()];
}

export function modelIcon(modelId: string, provider?: string): ModelIcon | undefined {
  const id = modelId.toLowerCase().replace(/^[a-z0-9_.-]+\//, "");
  const host = (provider ?? "").toLowerCase();
  const hit = HOSTS.test(host)
    ? ICONS.find(([, icon]) => icon.name.toLowerCase() === host)
    : (ICONS.find(([re]) => re.test(id)) ?? ICONS.find(([re]) => re.test(host)));
  return hit?.[1];
}

/** 50_000 micros -> "$0.05". Keeps up to 6 decimals, never fewer than 2. */
export function fmtMicros(micros: number): string {
  const n = micros / 1_000_000;
  const [whole, frac = ""] = n.toFixed(6).split(".");
  return `$${whole}.${frac.replace(/0+$/, "").padEnd(2, "0")}`;
}

export function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export type PlanMicros =
  | { shape: "per_run"; priceMicros: number; negotiation?: { minPriceMicros: number } }
  | {
      shape: "per_unit";
      unitLabel: string;
      countKey: string;
      outputKey: string;
      pricePerUnitMicros: number;
      minChargeMicros: number;
      maxUnitsPerRun?: number;
    }
  | { shape: "tiered"; fieldKey: string; tiers: Array<{ value: string; priceMicros: number }> };

/** One-line price for cards: "$0.05 / run", "$0.02 / lead", "from $0.10". */
export function priceSummary(plan?: PlanMicros | null): string {
  if (!plan) return "No price";
  if (plan.shape === "per_run") return `${fmtMicros(plan.priceMicros)} / run`;
  if (plan.shape === "per_unit") return `${fmtMicros(plan.pricePerUnitMicros)} / ${plan.unitLabel}`;
  const lowest = Math.min(...plan.tiers.map((t) => t.priceMicros));
  return `from ${fmtMicros(lowest)}`;
}

/** Per-unit agents with no creator cap are held for this many units (a default, not a promise). */
export const DEFAULT_HOLD_UNITS = 50;

/** Marketplace commission, added on top of the agent's price. */
export const PLATFORM_FEE_RATE = 0.12;

const withFee = (micros: number) => micros + Math.round(micros * PLATFORM_FEE_RATE);

export interface RunQuote {
  /** What the run costs when it completes, platform fee included. */
  charge: string;
  /** Escrow reserved from the wallet at start (agent price at its maximum + fee). Null when there is no price. */
  holdMicros: number | null;
  /** The agent's own price inside the hold, before the fee. */
  agentMicros: number | null;
  /** The platform fee inside the hold. */
  feeMicros: number | null;
  /** True when the final charge can be lower than the hold (the rest is released). */
  holdIsMax: boolean;
}

/** Quote shown in the confirm dialog. The hold is the most the run can cost: agent price + 12% fee. */
export function runQuote(plan?: PlanMicros | null): RunQuote {
  const quote = (charge: string, agentMicros: number, holdIsMax: boolean): RunQuote => {
    const holdMicros = withFee(agentMicros);
    return { charge, holdMicros, agentMicros, feeMicros: holdMicros - agentMicros, holdIsMax };
  };
  if (!plan) return { charge: "No price set", holdMicros: null, agentMicros: null, feeMicros: null, holdIsMax: false };
  if (plan.shape === "per_run") return quote(fmtMicros(withFee(plan.priceMicros)), plan.priceMicros, false);
  if (plan.shape === "per_unit") {
    const units = plan.maxUnitsPerRun ?? DEFAULT_HOLD_UNITS;
    return quote(
      `${fmtMicros(withFee(plan.pricePerUnitMicros))} per ${plan.unitLabel} delivered (min ${fmtMicros(withFee(plan.minChargeMicros))})`,
      Math.max(plan.minChargeMicros, plan.pricePerUnitMicros * units),
      true,
    );
  }
  const prices = plan.tiers.map((t) => t.priceMicros);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  return quote(
    lo === hi
      ? fmtMicros(withFee(lo))
      : `${fmtMicros(withFee(lo))} – ${fmtMicros(withFee(hi))}`,
    hi,
    lo !== hi,
  );
}

/** 100 credits = $1, so one credit is 10,000 micro-USD. Credits keep two decimals. */
export const MICROS_PER_CREDIT = 10_000;
export const microsToCredits = (micros: number) => Math.round((micros / MICROS_PER_CREDIT) * 100) / 100;

/** What the buyer is actually charged once a run has finished and passed its output check (fee included). */
export function chargeMicrosFor(plan: PlanMicros, input: unknown, output: unknown): number {
  const hold = runQuote(plan).holdMicros ?? 0;
  const record = (v: unknown): Record<string, unknown> =>
    v && typeof v === "object" ? (v as Record<string, unknown>) : {};

  if (plan.shape === "per_run") return withFee(plan.priceMicros);
  if (plan.shape === "tiered") {
    const picked = record(input)[plan.fieldKey];
    const tier = plan.tiers.find((t) => t.value === String(picked));
    return tier ? withFee(tier.priceMicros) : hold;
  }
  const out = record(output);
  const list = out[plan.outputKey];
  const counted = Array.isArray(list) ? list.length : Number(out[plan.countKey] ?? 0);
  const units = Math.min(Number.isFinite(counted) ? Math.max(0, counted) : 0, plan.maxUnitsPerRun ?? Infinity);
  return Math.min(hold, withFee(Math.max(plan.minChargeMicros, plan.pricePerUnitMicros * units)));
}

/** Every option of a tiered plan with its price, in the creator's own wording (the input-schema values). */
export function tierPrices(plan?: PlanMicros | null): Array<{ label: string; price: string }> {
  if (plan?.shape !== "tiered") return [];
  return plan.tiers.map((t) => ({ label: t.value, price: fmtMicros(t.priceMicros) }));
}

export const SHAPE_NAME: Record<PlanMicros["shape"], string> = {
  per_run: "Per run",
  per_unit: "Per delivered unit",
  tiered: "Tiered options",
};

export interface SchemaField {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

/** Top-level fields of a stored JSON schema string, as simple table rows. */
export function schemaFields(json: string): SchemaField[] {
  try {
    const schema = JSON.parse(json) as Record<string, any>;
    const props = (schema.properties ?? {}) as Record<string, any>;
    const required = new Set<string>(Array.isArray(schema.required) ? schema.required : []);
    return Object.entries(props).map(([name, p]) => {
      const t = Array.isArray(p?.type) ? p.type.join(" | ") : p?.type;
      return {
        name,
        type: Array.isArray(p?.enum) ? "enum" : typeof t === "string" ? t : "any",
        required: required.has(name),
        description: typeof p?.description === "string" ? p.description : undefined,
      };
    });
  } catch {
    return [];
  }
}
