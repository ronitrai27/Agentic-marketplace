"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  Bot,
  Braces,
  CircleCheck,
  Globe,
  Rocket,
  Tags,
  Timer,
} from "lucide-react";
import { api } from "../../../../../convex/_generated/api";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { PricingPlan } from "@/lib/pricing-plan";
import { validateTags } from "@/lib/agent-tags";
import { validateDescription } from "@/lib/agent-description";
import { DescriptionField } from "../description-field";
import { TagsStep } from "../tags-step";
import { PricingStep, type PricingDraft } from "../pricing-step";
import { ContractStep } from "../contract-step";
import { SectionHeading } from "../section-heading";
import { SchemaBuilder } from "./schema-builder";
import { ConnectStep, webhookUrlProblem } from "./connect-step";
import { DryRunStep, type DryRunResult } from "./dry-run-step";
import { fieldsProblem, fieldsToSchema, type SchemaField } from "./schema-fields";

const FLOW = ["Connect", "Describe", "Dry run", "Pricing", "Publish"];
const DRAFT_KEY = "catelog:register-nocode-draft:v1";
const MAX_NAME = 60;

interface Draft {
  step: number;
  url: string;
  name: string;
  description: string;
  tags: string[];
  inputFields: SchemaField[];
  outputFields: SchemaField[];
  dryValues: Record<string, unknown>;
  pricing?: PricingDraft;
}

function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

function saveDraft(d: Draft | null) {
  try {
    if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    // storage blocked: the draft just won't survive a reload
  }
}

function SummaryRow({ icon: Icon, label, children }: { icon: typeof Globe; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1 text-xs text-foreground">{children}</div>
    </div>
  );
}

/** Register flow for agents built in n8n: connect → describe → dry run → pricing → publish. */
export function NoCodeRegisterFlow({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const registerAgent = useMutation(api.agents.register);

  const [step, setStep] = useState(0);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [inputFields, setInputFields] = useState<SchemaField[]>([]);
  const [outputFields, setOutputFields] = useState<SchemaField[]>([]);
  const [dryValues, setDryValues] = useState<Record<string, unknown>>({});
  const [dryResult, setDryResult] = useState<DryRunResult | null>(null);
  const [dryFor, setDryFor] = useState("");
  const [pricingDraft, setPricingDraft] = useState<PricingDraft | undefined>();
  const [plan, setPlan] = useState<PricingPlan | null>(null);
  const [planValid, setPlanValid] = useState(false);
  const [contractOk, setContractOk] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const d = loadDraft();
    if (d) {
      setStep(Math.min(Math.max(d.step ?? 0, 0), 2));
      setUrl(d.url ?? "");
      setName(d.name ?? "");
      setDescription(d.description ?? "");
      setTags(d.tags ?? []);
      setInputFields(d.inputFields ?? []);
      setOutputFields(d.outputFields ?? []);
      setDryValues(d.dryValues ?? {});
      setPricingDraft(d.pricing);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveDraft({ step, url, name, description, tags, inputFields, outputFields, dryValues, pricing: pricingDraft });
  }, [hydrated, step, url, name, description, tags, inputFields, outputFields, dryValues, pricingDraft]);

  const inputSchema = useMemo(() => fieldsToSchema(inputFields), [inputFields]);
  const outputSchema = useMemo(() => fieldsToSchema(outputFields), [outputFields]);

  // A dry run only counts for the exact URL and fields it was run with.
  const dryKey = `${url.trim()}|${JSON.stringify(inputSchema)}|${JSON.stringify(outputSchema)}`;
  const dryPassed = !!dryResult?.ok && dryFor === dryKey;

  const describeProblem =
    !name.trim()
      ? "Give your agent a name."
      : !validateDescription(description).ok
        ? "Write a description of 20 to 100 words."
        : !validateTags(tags).ok
          ? "Pick 2 to 4 tags."
          : fieldsProblem(inputFields, "input") ?? fieldsProblem(outputFields, "output");

  const canNext = [
    !!url.trim() && !webhookUrlProblem(url),
    !describeProblem,
    dryPassed,
    planValid,
    contractOk,
  ][step];

  const publish = () => {
    if (!plan) return;
    const payload = {
      name: name.trim(),
      description: description.trim(),
      baseUrl: url.trim(),
      version: "1.0.0",
      platform: "n8n" as const,
      inputSchemaJson: JSON.stringify(inputSchema),
      outputSchemaJson: JSON.stringify(outputSchema),
      tags,
      plan: JSON.parse(JSON.stringify(plan)) as PricingPlan,
      // No LLM is reported for a workflow, so the marketplace shows the platform instead.
      models: [{ id: "n8n", provider: "n8n" }],
      latencyMs: dryResult?.latencyMs ?? 0,
    };
    onDone();
    toast.promise(registerAgent(payload), {
      loading: "Publishing your agent…",
      success: (r) => {
        saveDraft(null);
        return `${r.name} is live on the marketplace`;
      },
      error: (e) =>
        (e instanceof Error ? e.message.replace(/^[\s\S]*Uncaught Error:\s*/, "").split("\n")[0] : "") ||
        "Could not publish the agent.",
    });
  };

  let host = "";
  try {
    host = new URL(url.trim()).host;
  } catch {
    host = url;
  }

  return (
    <>
      <DialogTitle className="sr-only">Register an n8n agent</DialogTitle>
      <DialogDescription className="sr-only">Connect, describe, test, price and publish your n8n workflow.</DialogDescription>

      {/* Stepper */}
      <div className="mt-2 shrink-0 border-b border-border p-6 pb-4 font-sans">
        <div className="grid grid-cols-5 gap-2 pr-8">
          {FLOW.map((label, i) => (
            <button
              key={label}
              type="button"
              disabled={i > step}
              onClick={() => i < step && setStep(i)}
              className="space-y-1.5 text-left disabled:cursor-default enabled:cursor-pointer"
            >
              <div
                className={`h-1 rounded-full transition-colors ${
                  i === step ? "bg-foreground" : i < step ? "bg-foreground/50" : "bg-border"
                }`}
              />
              <p className={`text-[11px] ${i === step ? "font-semibold text-foreground" : "font-medium text-zinc-700 dark:text-zinc-300"}`}>
                <span className="tabular-nums">{i + 1}.</span> {label}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 font-sans">
        {step === 0 && <ConnectStep url={url} onUrlChange={setUrl} />}

        {step === 1 && (
          <div className="space-y-8 pb-4">
            <section className="space-y-4 border-b border-border pb-8">
              <SectionHeading icon={Bot} title="Name your agent">
                Short and clear. Names are unique across the marketplace.
              </SectionHeading>
              <div className="relative">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value.slice(0, MAX_NAME))}
                  placeholder="Lead Email Writer"
                  className="h-10 w-full rounded-lg border border-zinc-300 bg-background px-3 text-sm font-sans text-foreground shadow-2xs outline-none transition-all focus:border-foreground focus:ring-2 focus:ring-foreground/10 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 dark:border-zinc-700"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-medium tabular-nums text-zinc-700 dark:text-zinc-300">
                  {name.length}/{MAX_NAME}
                </span>
              </div>
            </section>

            <DescriptionField value={description} onChange={setDescription} />
            <TagsStep selected={tags} onChange={setTags} description={description} />

            <SchemaBuilder
              icon={ArrowDownToLine}
              title="Input"
              hint="What buyers send. Your webhook receives these keys in the request body."
              label="input"
              fields={inputFields}
              onChange={setInputFields}
              samplePlaceholder={'{ "lead_name": "Jane", "company": "Acme", "tone": "friendly" }'}
            />
            <SchemaBuilder
              icon={ArrowUpFromLine}
              title="Output"
              hint="What your workflow answers. Runs are only charged when the answer matches."
              label="output"
              fields={outputFields}
              onChange={setOutputFields}
              samplePlaceholder={'{ "subject": "Quick idea", "body": "Hi Jane, ..." }'}
            />
          </div>
        )}

        {step === 2 && (
          <DryRunStep
            url={url}
            inputFields={inputFields}
            outputFields={outputFields}
            values={dryValues}
            onValuesChange={setDryValues}
            result={dryFor === dryKey ? dryResult : null}
            onResult={(r) => {
              setDryResult(r);
              setDryFor(dryKey);
            }}
          />
        )}

        {step === 3 && (
          <div className="pb-4">
            <PricingStep
              initialDraft={pricingDraft}
              onDraftChange={setPricingDraft}
              inputSchema={inputSchema as Record<string, any>}
              outputSchema={outputSchema as Record<string, any>}
              tags={tags}
              onChange={(p, valid) => {
                setPlan(p);
                setPlanValid(valid);
              }}
            />
          </div>
        )}

        {step === 4 && (
          <div className="space-y-8 pb-4">
            <section className="space-y-4">
              <SectionHeading icon={Rocket} title="Ready to publish">
                A last look before your agent goes live.
              </SectionHeading>
              <div className="divide-y divide-border rounded-lg border border-border bg-card shadow-2xs">
                <SummaryRow icon={Bot} label="Agent">
                  <span className="font-medium">{name}</span>
                </SummaryRow>
                <SummaryRow icon={Globe} label="Webhook">
                  <span className="font-mono">{host}</span>
                </SummaryRow>
                <SummaryRow icon={Braces} label="Fields">
                  {inputFields.length} input · {outputFields.length} output
                </SummaryRow>
                <SummaryRow icon={Tags} label="Tags">
                  {tags.join(", ")}
                </SummaryRow>
                <SummaryRow icon={Timer} label="Dry run">
                  <span className="inline-flex items-center gap-1.5">
                    <CircleCheck className="size-3.5" />
                    Passed in {((dryResult?.latencyMs ?? 0) / 1000).toFixed(1)}s
                  </span>
                </SummaryRow>
              </div>
            </section>
            <ContractStep onAcceptedChange={setContractOk} />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex shrink-0 items-center justify-between border-t border-border bg-card/50 p-4 px-6">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => (step === 0 ? onBack() : setStep((s) => s - 1))}
          className="cursor-pointer gap-1.5"
        >
          {step === 0 && <ArrowLeft className="size-3.5" />}
          {step === 0 ? "Change type" : "Previous"}
        </Button>
        <div className="flex items-center gap-3 font-sans">
          {step === 1 && describeProblem && (
            <span className="hidden text-[11px] font-medium text-zinc-800 dark:text-zinc-200 sm:inline">{describeProblem}</span>
          )}
          {step === 2 && !dryPassed && (
            <span className="hidden text-[11px] font-medium text-zinc-800 dark:text-zinc-200 sm:inline">Pass the dry run to continue.</span>
          )}
          <Button
            type="button"
            size="sm"
            disabled={!canNext}
            onClick={() => (step === FLOW.length - 1 ? publish() : setStep((s) => s + 1))}
            className="cursor-pointer"
          >
            {step === FLOW.length - 1 ? "Publish agent" : "Next"}
          </Button>
        </div>
      </div>
    </>
  );
}
