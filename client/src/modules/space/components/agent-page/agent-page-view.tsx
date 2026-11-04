import React from "react";
import { AlertTriangle, Brain, Check } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../../convex/_generated/api";
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
  uniqueModelIcons,
  type PlanMicros,
} from "@/lib/agent-display";
import { AgentRating, normaliseRating } from "../agent-rating";
import { RunAgentButton } from "./run-agent-button";
import { AgentBanner } from "./agent-banner";
import { AgentActivityCharts } from "./agent-activity-charts";

export type AgentPageData = NonNullable<
  FunctionReturnType<typeof api.agentPage.getBySlug>
>;

const initial = (name: string) => name.trim().charAt(0).toUpperCase() || "?";

/** Label on the left, content on the right, a hairline between rows. */
function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-3 border-t border-border py-7 md:grid-cols-[10rem_1fr] md:gap-8">
      <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </h2>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function Avatar({
  src,
  name,
  className,
}: {
  src?: string | null;
  name: string;
  className: string;
}) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name}
      className={`${className} rounded-full object-cover`}
    />
  ) : (
    <span
      className={`${className} rounded-full bg-muted text-muted-foreground flex items-center justify-center font-medium`}
    >
      {initial(name)}
    </span>
  );
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="p-4">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums text-foreground">
        {value}
      </p>
      {note && (
        <p className="mt-0.5 text-[11px] text-muted-foreground">{note}</p>
      )}
    </div>
  );
}

/** Compact one-line price for the header, from the agent's stored pricing plan. */
function priceSummary(pricing: AgentPageData["pricing"]): string {
  if (!pricing) return "No price set";
  if (pricing.shape === "per_run")
    return `${fmtMicros(pricing.priceMicros)} / run`;
  if (pricing.shape === "per_unit")
    return `${fmtMicros(pricing.pricePerUnitMicros)} / ${pricing.unitLabel}`;
  const prices = pricing.tiers.map((t) => t.priceMicros);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  return lo === hi
    ? `${fmtMicros(lo)} / run`
    : `${fmtMicros(lo)} – ${fmtMicros(hi)} / run`;
}

function Pricing({ pricing }: { pricing: AgentPageData["pricing"] }) {
  if (!pricing)
    return <p className="text-sm text-muted-foreground">No price set.</p>;

  if (pricing.shape === "per_run") {
    return (
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold tracking-tight text-foreground">
          {fmtMicros(pricing.priceMicros)}
        </span>
        <span className="text-sm text-muted-foreground">per run</span>
        {"negotiable" in pricing && pricing.negotiable && (
          <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
            Negotiable
          </span>
        )}
      </div>
    );
  }

  if (pricing.shape === "per_unit") {
    return (
      <div className="space-y-2">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tracking-tight text-foreground">
            {fmtMicros(pricing.pricePerUnitMicros)}
          </span>
          <span className="text-sm text-muted-foreground">
            per {pricing.unitLabel}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Minimum {fmtMicros(pricing.minChargeMicros)} per run
          {pricing.maxUnitsPerRun
            ? ` · up to ${pricing.maxUnitsPerRun} ${pricing.unitLabel}s`
            : ""}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {SHAPE_NAME[pricing.shape]} by{" "}
        <span className="font-mono">{pricing.fieldKey}</span>
      </p>
      <div className="rounded-lg border border-border divide-y divide-border max-w-sm">
        {pricing.tiers.map((t) => (
          <div
            key={t.value}
            className="flex items-center justify-between px-3.5 py-2 text-xs"
          >
            <span className="font-mono">{t.value}</span>
            <span className="font-semibold">{fmtMicros(t.priceMicros)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Fields({ title, json }: { title: string; json: string }) {
  const fields = schemaFields(json);
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">{title}</TableHead>
            <TableHead className="text-xs">Type</TableHead>
            <TableHead className="text-xs text-right">Required</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {fields.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="text-xs text-muted-foreground">
                No fields declared.
              </TableCell>
            </TableRow>
          ) : (
            fields.map((f) => (
              <TableRow key={f.name}>
                <TableCell className="text-xs font-mono">{f.name}</TableCell>
                <TableCell className="text-xs font-mono text-muted-foreground">
                  {f.type}
                </TableCell>
                <TableCell className="text-xs text-right text-muted-foreground">
                  {f.required ? "Yes" : "No"}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export function AgentPageView({ agent }: { agent: AgentPageData }) {
  const { stats } = agent;
  const hasRuns = stats.totalRuns > 0;
  const avgLatency = hasRuns
    ? Math.round(stats.totalLatencyMs / stats.totalRuns)
    : null;
  const successRate = hasRuns
    ? Math.round((stats.successRuns / stats.totalRuns) * 100)
    : null;
  const modelIcons = uniqueModelIcons(agent.models);

  return (
    <div className="flex-1 h-full overflow-y-auto scrollbar-thin bg-background">
      <AgentBanner />

      <div className="mx-auto w-full max-w-250 px-6 pb-16">
        {/* Identity */}
        <header className="-mt-10 relative">
          <div className="flex items-end justify-between gap-4">
            {agent.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={agent.logoUrl}
                alt={agent.name}
                className="size-20 rounded-2xl border-4 border-background bg-background object-cover"
              />
            ) : (
              <span className="size-20 rounded-2xl border-4 border-background bg-muted flex items-center justify-center text-2xl font-semibold text-muted-foreground">
                {initial(agent.name)}
              </span>
            )}
            <div className="flex items-center gap-10 pb-1 pt-1">
              <AgentRating
                value={agent.ratingAvg}
                reviewCount={agent.ratingCount}
              />
              <RunAgentButton agentName={agent.name} pricing={agent.pricing as PlanMicros | null} />
            </div>
          </div>

          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-foreground">
            {agent.name}
          </h1>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Avatar
                src={agent.owner.image}
                name={agent.owner.name}
                className="size-4 text-[9px]"
              />
              {agent.owner.name}
            </span>
            <span>·</span>
            <span>v{agent.version}</span>
            <span>·</span>
            <span>Listed {fmtDate(agent.createdAt)}</span>
            {modelIcons.length > 0 && (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-1.5">
                  {modelIcons.map((icon) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={icon.src}
                      src={icon.src}
                      alt={icon.name}
                      title={icon.name}
                      className={`size-4 ${icon.theme ?? ""}`}
                    />
                  ))}
                </span>
              </>
            )}
            <Tooltip>
              <TooltipTrigger
                aria-label="About listed models"
                className="inline-flex items-center text-amber-600 hover:text-amber-500"
              >
                <AlertTriangle className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                className="max-w-xs flex-col items-start gap-1 py-2 leading-snug"
              >
                <span className="font-medium">Models are not confirmed</span>
                <span>
                  There can be more models than the ones shown here. Additional
                  models are only discovered when the agent is invoked and those
                  models are actually called.
                </span>
                <span>
                  The marketplace builds trust by showing only the models that
                  have shown up during a run.
                </span>
              </TooltipContent>
            </Tooltip>
            {agent.status === "paused" && (
              <>
                <span>·</span>
                <span className="text-amber-600">Paused</span>
              </>
            )}
          </div>

          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-foreground/80">
            {agent.description || "No description provided."}
          </p>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex flex-wrap gap-1.5">
              {agent.tags.map((id) => (
                <span
                  key={id}
                  className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground"
                >
                  {tagById(id)?.label ?? id}
                </span>
              ))}
            </div>
            <span className="text-sm font-semibold text-foreground">
              {priceSummary(agent.pricing)}
            </span>
          </div>
        </header>

        <div className="mt-10">
          {agent.keyCapabilities.length > 0 && (
            <Row label="Key capabilities">
              <ul className="grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
                {agent.keyCapabilities.map((c) => (
                  <li
                    key={c}
                    className="flex items-start gap-2.5 text-sm text-foreground"
                  >
                    <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                    <span className="leading-snug">{c}</span>
                  </li>
                ))}
              </ul>
            </Row>
          )}

          <Row label="Pricing">
            <Pricing pricing={agent.pricing} />
          </Row>

          <Row label="Activity">
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 rounded-xl border border-border divide-x divide-y sm:divide-y-0 divide-border overflow-hidden">
                <Stat
                  label="Total runs"
                  value={hasRuns ? stats.totalRuns.toLocaleString() : "0"}
                />
                <Stat
                  label="Success"
                  value={hasRuns ? stats.successRuns.toLocaleString() : "—"}
                  note={
                    successRate !== null
                      ? `${successRate}% success rate`
                      : undefined
                  }
                />
                <Stat
                  label="Failed"
                  value={hasRuns ? stats.failedRuns.toLocaleString() : "—"}
                />
                <Stat
                  label="Avg latency"
                  value={
                    avgLatency !== null
                      ? `${avgLatency.toLocaleString()} ms`
                      : "None"
                  }
                />
              </div>

              {hasRuns ? (
                <AgentActivityCharts daily={agent.daily} />
              ) : (
                <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
                  <p className="text-sm font-medium text-foreground">
                    No runs before
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Nobody has called this agent yet, so you would be the first.
                    Charts appear after the first run.
                  </p>
                </div>
              )}
            </div>
          </Row>

          <Row label="Models">
            {agent.models.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No models reported.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {agent.models.map((m) => {
                  const icon = modelIcon(m.id, m.provider);
                  return (
                    <li
                      key={m.id}
                      className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"
                    >
                      {icon ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={icon.src}
                          alt={icon.name}
                          className={`size-4 ${icon.theme ?? ""}`}
                        />
                      ) : (
                        <Brain className="size-4 text-muted-foreground" />
                      )}
                      <span className="text-xs font-mono text-foreground">
                        {m.id}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Row>

          <Row label="Input & output">
            <div className="grid gap-4 lg:grid-cols-2">
              <Fields title="Input" json={agent.inputSchemaJson} />
              <Fields title="Output" json={agent.outputSchemaJson} />
            </div>
          </Row>

          <Row label="Reviews">
            {agent.reviews.length === 0 ? (
              <p className="text-sm text-muted-foreground">No reviews yet.</p>
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {agent.reviews.map((r) => (
                  <li key={r.id} className="p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar
                          src={r.userAvatar}
                          name={r.userName}
                          className="size-7 text-xs"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-foreground">
                            {r.userName}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {fmtDate(r.createdAt)}
                          </p>
                        </div>
                      </div>
                      <AgentRating value={normaliseRating(r.rating)} />
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-foreground/80">
                      {r.comment}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Row>
        </div>
      </div>
    </div>
  );
}
