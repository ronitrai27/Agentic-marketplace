import React from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  Check,
  MessageSquare,
  Sparkles,
} from "lucide-react";
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
import { AgentRating } from "../agent-rating";
import { RunAgentButton } from "./run-agent-button";
import { AgentBanner } from "./agent-banner";
import { AgentVersionInfo } from "./agent-version-info";
import { AgentHistoryGate } from "./agent-history";
import { AgentActivity } from "./agent-activity";
import { AgentReviews } from "./agent-reviews";

export type AgentPageData = NonNullable<
  FunctionReturnType<typeof api.agentPage.getBySlug>
>;

const initial = (name: string) => name.trim().charAt(0).toUpperCase() || "?";

/** Heading with an icon on top, content below at full width, a hairline between sections. */
function Row({
  label,
  icon: Icon,
  children,
  id,
}: {
  id?: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className=" py-4 scroll-mt-4">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
        <Icon className="size-4 text-muted-foreground" />
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
  const modelIcons = uniqueModelIcons(agent.models).map((icon) => ({
    ...icon,
    ids: agent.models
      .filter((m) => modelIcon(m.id, m.provider)?.src === icon.src)
      .map((m) => m.id),
  }));

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
                scrollTo="agent-reviews"
              />
              <RunAgentButton
                agentName={agent.name}
                agentSlug={agent.slug}
                pricing={agent.pricing as PlanMicros | null}
              />
            </div>
          </div>

          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-foreground">
            {agent.name}
          </h1>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-primary">
            <span className="inline-flex items-center gap-1.5">
              <Avatar
                src={agent.owner.image}
                // fallback={agent.owner.name.charAt(0).toUpperCase()}
                name={agent.owner.name}
                className="size-4 text-[9px]"
              />
              {agent.owner.name}
            </span>
            <span>·</span>
            <AgentVersionInfo
              version={agent.version}
              listedAt={agent.createdAt}
              updatedAt={agent.updatedAt ?? agent.createdAt} /* older cached pages lack these */
              versions={agent.versions ?? []}
            />
            {modelIcons.length > 0 && (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-1.5">
                  {modelIcons.map((icon) => (
                    <Tooltip key={icon.src}>
                      <TooltipTrigger
                        aria-label={icon.ids.join(", ")}
                        className="inline-flex cursor-default"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={icon.src}
                          alt={icon.name}
                          className={`size-4 ${icon.theme ?? ""}`}
                        />
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="font-mono">
                        {icon.ids.join(", ")}
                      </TooltipContent>
                    </Tooltip>
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

          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-foreground">
            {agent.description || "No description provided."}
          </p>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 ">
            <div className="flex flex-wrap gap-1.5">
              {agent.tags.map((id) => (
                <span
                  key={id}
                  className="rounded-full border border-border px-2.5 py-1 text-[11px] text-foreground"
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

        <div className="mt-5">
          {agent.keyCapabilities.length > 0 && (
            <Row label="Key capabilities" icon={Sparkles}>
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

          <AgentHistoryGate slug={agent.slug}>
            <Row label="Activity" icon={Activity}>
              <AgentActivity
                slug={agent.slug}
                initial={{ stats: agent.stats, daily: agent.daily }}
              />
            </Row>

            <Row label="Input & output" icon={ArrowLeftRight}>
              <div className="grid gap-4 lg:grid-cols-2">
                <Fields title="Input" json={agent.inputSchemaJson} />
                <Fields title="Output" json={agent.outputSchemaJson} />
              </div>
            </Row>

            <Row id="agent-reviews" label="Reviews" icon={MessageSquare}>
              <AgentReviews
                slug={agent.slug}
                initial={agent.reviews.map((r) => ({ ...r, userAvatar: r.userAvatar }))}
              />
            </Row>
          </AgentHistoryGate>
        </div>
      </div>
    </div>
  );
}
