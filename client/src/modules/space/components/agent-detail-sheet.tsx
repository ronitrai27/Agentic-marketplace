"use client";

import React, { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../../convex/_generated/api";
import { Brain, Check, Copy, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { tagById } from "@/lib/agent-tags";
import {
  SHAPE_NAME,
  fmtDate,
  fmtMicros,
  modelIcon,
  schemaFields,
  type PlanMicros,
} from "@/lib/agent-display";
import { StatusText, type AgentWithPricing } from "./agent-card";
import { LogoUpload } from "./logo-upload";
import { AgentRating, demoRatingFor } from "./agent-rating";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h4 className="text-xs font-semibold text-foreground">{title}</h4>
      {children}
    </section>
  );
}

/** Label / value rows inside one bordered card. */
function KeyValues({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="rounded-lg border border-border divide-y divide-border">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-start justify-between gap-4 px-3.5 py-2.5 text-xs">
          <dt className="text-muted-foreground shrink-0">{k}</dt>
          <dd className="text-foreground text-right min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function CopyText({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // clipboard blocked
        }
      }}
      className="inline-flex items-center gap-1.5 font-mono hover:text-foreground cursor-pointer text-right break-all"
      title="Copy"
    >
      {text}
      {copied ? <Check className="size-3 shrink-0" /> : <Copy className="size-3 shrink-0 text-muted-foreground" />}
    </button>
  );
}

function PricingBlock({ plan }: { plan?: PlanMicros }) {
  if (!plan) return <p className="text-xs text-muted-foreground">No price set.</p>;

  if (plan.shape === "per_run") {
    return (
      <KeyValues
        rows={[
          ["Model", SHAPE_NAME[plan.shape]],
          ["Price per run", <b key="p">{fmtMicros(plan.priceMicros)}</b>],
          [
            "Negotiation",
            plan.negotiation ? `Down to ${fmtMicros(plan.negotiation.minPriceMicros)}` : "Fixed price",
          ],
        ]}
      />
    );
  }
  if (plan.shape === "per_unit") {
    return (
      <KeyValues
        rows={[
          ["Model", SHAPE_NAME[plan.shape]],
          [`Price per ${plan.unitLabel}`, <b key="p">{fmtMicros(plan.pricePerUnitMicros)}</b>],
          ["Minimum charge", fmtMicros(plan.minChargeMicros)],
          ["Max per run", plan.maxUnitsPerRun ? `${plan.maxUnitsPerRun} ${plan.unitLabel}s` : "No limit"],
          ["Counted from", <span key="c" className="font-mono">{plan.outputKey}</span>],
        ]}
      />
    );
  }
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">{plan.fieldKey}</TableHead>
            <TableHead className="text-xs text-right">Price</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {plan.tiers.map((t) => (
            <TableRow key={t.value}>
              <TableCell className="text-xs font-mono">{t.value}</TableCell>
              <TableCell className="text-xs text-right font-semibold">{fmtMicros(t.priceMicros)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function FieldsTable({ json }: { json: string }) {
  const fields = schemaFields(json);
  if (fields.length === 0) {
    return <p className="text-xs text-muted-foreground">No fields declared.</p>;
  }
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Field</TableHead>
            <TableHead className="text-xs">Type</TableHead>
            <TableHead className="text-xs">Required</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {fields.map((f) => (
            <TableRow key={f.name}>
              <TableCell className="text-xs font-mono">{f.name}</TableCell>
              <TableCell className="text-xs font-mono text-muted-foreground">{f.type}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{f.required ? "Yes" : "No"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function fmtTimeout(seconds?: number): string {
  if (!seconds || seconds <= 0) return "—";
  if (seconds < 60) return `${seconds} sec`;
  const min = seconds / 60;
  return `${Number.isInteger(min) ? min : min.toFixed(1)} min`;
}

export function AgentDetailSheet({
  agent: current,
  onOpenChange,
  onDelete,
}: {
  agent: AgentWithPricing | null;
  onOpenChange: (open: boolean) => void;
  onDelete: (agent: AgentWithPricing) => void;
}) {
  const setLogo = useMutation(api.agents.setLogo);
  // Keep showing the last agent while the sheet slides out, otherwise the content vanishes mid-animation
  const [last, setLast] = useState<AgentWithPricing | null>(null);
  useEffect(() => {
    if (current) setLast(current);
  }, [current]);
  const agent = current ?? last;

  return (
    <Sheet open={!!current} onOpenChange={onOpenChange}>
      <SheetContent
        className={[
          "data-[side=right]:w-full data-[side=right]:sm:max-w-[47rem] gap-0 p-0",
          // slower, eased slide: full travel in and out instead of the default short nudge
          "duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]",
          "data-[side=right]:data-starting-style:translate-x-full data-[side=right]:data-ending-style:translate-x-full",
        ].join(" ")}
      >
        {agent && (
          <>
            <SheetHeader className="p-6 pb-5 border-b border-border pr-14">
              <div className="flex items-center gap-3">
                <LogoUpload
                  name={agent.name}
                  logoUrl={agent.logoUrl}
                  className="size-10 text-base"
                  onChange={async (url) => {
                    await setLogo({ agentId: agent._id, logoUrl: url });
                    toast.success("Logo updated");
                  }}
                />
                <div className="min-w-0">
                  <SheetTitle className="text-base truncate">{agent.name}</SheetTitle>
                  <div className="flex items-center gap-2 mt-1">
                    <StatusText status={agent.status} />
                  </div>
                </div>
              </div>
              <AgentRating value={demoRatingFor(agent._id)} align="left" className="mt-3" />
              <SheetDescription className="text-xs leading-relaxed mt-3">
                {agent.description || "No description provided."}
              </SheetDescription>
            </SheetHeader>

            <div className="px-6 py-4 border-b border-border space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={agent.status === "archived"}
                  onClick={() => onDelete(agent)}
                  className="cursor-pointer"
                >
                  Delete Agent
                </Button>
                <Button type="button" variant="outline" size="sm" disabled title="Coming soon">
                  Edit Agent
                </Button>
                <Button type="button" variant="outline" size="sm" disabled title="Coming soon">
                  Re-Register Agent
                </Button>
              </div>
              <p className="flex items-start gap-2 text-[11px] text-muted-foreground leading-relaxed">
                <Lightbulb className="size-3.5 shrink-0 mt-px" />
                <span>
                  <span className="font-medium text-foreground">Tip:</span> If you have modified your code or added
                  new changes to your agent, we highly recommend changing your current version and re-registering it.
                </span>
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <Section title="Pricing">
                <PricingBlock plan={agent.pricing?.plan as PlanMicros | undefined} />
              </Section>

              <Section title="Models used">
                {agent.models.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No models were reported during the dry run.</p>
                ) : (
                  <ul className="rounded-lg border border-border divide-y divide-border">
                    {agent.models.map((m) => {
                      const icon = modelIcon(m.id, m.provider);
                      return (
                        <li key={m.id} className="flex items-center gap-3 px-3.5 py-2.5">
                          <span className="size-7 rounded-md border border-border bg-background flex items-center justify-center shrink-0">
                            {icon ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={icon.src} alt={icon.name} className={`size-4 ${icon.theme ?? ""}`} />
                            ) : (
                              <Brain className="size-3.5 text-muted-foreground" />
                            )}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-mono font-medium text-foreground break-all">{m.id}</p>
                            <p className="text-[11px] text-muted-foreground">{m.provider ?? "Unknown provider"}</p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Section>

              <Section title="Details">
                <KeyValues
                  rows={[
                    ["Endpoint", <CopyText key="u" text={agent.baseUrl} />],
                    ["Version", `v${agent.version}`],
                    ["Health ping", `${agent.verification.latencyMs} ms`],
                    ["Verified", fmtDate(agent.verification.verifiedAt)],
                    ["Registered", fmtDate(agent.createdAt)],
                  ]}
                />
              </Section>

              <Section title="Capabilities">
                <KeyValues
                  rows={[
                    ["Streaming", agent.capabilities?.streaming ? "Yes" : "No"],
                    ["Execution modes", agent.capabilities?.execution_modes?.join(", ") ?? "—"],
                    ["Max timeout", fmtTimeout(agent.capabilities?.max_timeout_seconds)],
                  ]}
                />
              </Section>

              <Section title="Tags">
                <div className="flex flex-wrap gap-1.5">
                  {agent.tags.map((id) => (
                    <span key={id} className="rounded-full bg-muted px-2.5 py-1 text-[11px] text-foreground">
                      {tagById(id)?.label ?? id}
                    </span>
                  ))}
                </div>
              </Section>

              <Section title="Input fields">
                <FieldsTable json={agent.inputSchemaJson} />
              </Section>
              <Section title="Output fields">
                <FieldsTable json={agent.outputSchemaJson} />
              </Section>

              <Section title="Developer agreement">
                <KeyValues
                  rows={[
                    ["Accepted", fmtDate(agent.contractAcceptedAt)],
                  ]}
                />
              </Section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
