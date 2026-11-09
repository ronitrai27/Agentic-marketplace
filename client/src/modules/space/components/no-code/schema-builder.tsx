"use client";

import React, { useState } from "react";
import {
  Braces,
  Hash,
  List,
  ListChecks,
  Plus,
  ToggleRight,
  Trash2,
  Type,
  Wand2,
  X,
  type LucideIcon,
} from "lucide-react";
import { SectionHeading } from "../section-heading";
import {
  FIELD_TYPES,
  FIELD_TYPE_HINT,
  FIELD_TYPE_LABEL,
  MAX_FIELDS,
  MAX_OPTIONS,
  fieldsToSchema,
  inferFields,
  newField,
  toFieldName,
  type FieldType,
  type SchemaField,
} from "./schema-fields";

export const FIELD_ICON: Record<FieldType, LucideIcon> = {
  text: Type,
  number: Hash,
  boolean: ToggleRight,
  choice: ListChecks,
  list: List,
};

function OptionsEditor({
  options,
  onChange,
}: {
  options: string[];
  onChange: (o: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = toFieldName(draft);
    if (!v || options.includes(v) || options.length >= MAX_OPTIONS) return;
    onChange([...options, v]);
    setDraft("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-dashed border-border bg-muted/30 p-2 font-sans">
      <span className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300 mr-1">Options</span>
      {options.map((o) => (
        <span
          key={o}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-sans font-medium text-foreground"
        >
          {o}
          <button
            type="button"
            onClick={() => onChange(options.filter((x) => x !== o))}
            className="text-zinc-600 dark:text-zinc-400 hover:text-foreground cursor-pointer"
            aria-label={`Remove ${o}`}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      {options.length < MAX_OPTIONS && (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
          placeholder="Add option ↵"
          className="min-w-24 flex-1 bg-transparent text-[11px] font-sans text-foreground outline-none placeholder:text-zinc-500 dark:placeholder:text-zinc-400"
        />
      )}
    </div>
  );
}

function FieldRow({
  field,
  index,
  onChange,
  onRemove,
}: {
  field: SchemaField;
  index: number;
  onChange: (f: SchemaField) => void;
  onRemove: () => void;
}) {
  const Icon = FIELD_ICON[field.type];
  return (
    <div className="group rounded-lg border border-border bg-card shadow-2xs transition-colors hover:border-foreground/25 font-sans">
      <div className="flex items-center gap-3 p-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-foreground">
          <Icon className="size-4" />
        </span>

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <input
              value={field.name}
              onChange={(e) => onChange({ ...field, name: toFieldName(e.target.value) })}
              placeholder={`field_${index + 1}`}
              spellCheck={false}
              className="w-40 min-w-0 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-sans font-semibold text-foreground outline-none hover:border-border focus:border-foreground/40 focus:bg-background placeholder:text-zinc-500 dark:placeholder:text-zinc-400"
            />
            <button
              type="button"
              onClick={() => onChange({ ...field, required: !field.required })}
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors cursor-pointer ${
                field.required
                  ? "border-foreground bg-foreground text-background"
                  : "border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 hover:text-foreground"
              }`}
              title="Click to switch between required and optional"
            >
              {field.required ? "Required" : "Optional"}
            </button>
          </div>
          <input
            value={field.description}
            onChange={(e) => onChange({ ...field, description: e.target.value.slice(0, 160) })}
            placeholder="What is this? Buyers see this hint."
            className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-xs font-sans font-medium text-zinc-800 dark:text-zinc-200 outline-none hover:border-border focus:border-foreground/40 focus:bg-background focus:text-foreground placeholder:text-zinc-600 dark:placeholder:text-zinc-400"
          />
        </div>

        <button
          type="button"
          onClick={onRemove}
          className="rounded-md p-1.5 text-zinc-700 dark:text-zinc-300 transition hover:bg-destructive/10 hover:text-destructive cursor-pointer"
          aria-label="Remove field"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1 border-t border-border/70 bg-muted/20 px-3 py-2">
        {FIELD_TYPES.map((t) => {
          const TIcon = FIELD_ICON[t];
          const active = field.type === t;
          return (
            <button
              key={t}
              type="button"
              title={FIELD_TYPE_HINT[t]}
              onClick={() =>
                onChange({
                  ...field,
                  type: t,
                  options: t === "choice" && field.options.length === 0 ? ["option_a", "option_b"] : field.options,
                })
              }
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                active
                  ? "bg-background text-foreground shadow-xs ring-1 ring-zinc-300 dark:ring-zinc-700"
                  : "text-zinc-800 dark:text-zinc-200 hover:text-foreground"
              }`}
            >
              <TIcon className="size-3" />
              {FIELD_TYPE_LABEL[t]}
            </button>
          );
        })}
      </div>

      {field.type === "choice" && (
        <div className="px-3 pb-3 pt-1">
          <OptionsEditor
            options={field.options}
            onChange={(options) => onChange({ ...field, options })}
          />
        </div>
      )}
    </div>
  );
}

/** Visual builder for a strict JSON Schema: typed field cards, required/optional pills, JSON import and preview. */
export function SchemaBuilder({
  icon,
  title,
  hint,
  label,
  fields,
  onChange,
  samplePlaceholder,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  /** "input" / "output": used in messages. */
  label: string;
  fields: SchemaField[];
  onChange: (fields: SchemaField[]) => void;
  samplePlaceholder: string;
}) {
  const [panel, setPanel] = useState<"none" | "import" | "json">("none");
  const [sample, setSample] = useState("");
  const [importError, setImportError] = useState("");
  const full = fields.length >= MAX_FIELDS;

  const add = (type: FieldType) => {
    if (!full) onChange([...fields, newField(type)]);
  };

  const runImport = () => {
    try {
      const inferred = inferFields(sample);
      if (inferred.length === 0) throw new Error("That object has no keys.");
      onChange(inferred);
      setPanel("none");
      setSample("");
      setImportError("");
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Not valid JSON.");
    }
  };

  const toggle = (p: "import" | "json") => setPanel((cur) => (cur === p ? "none" : p));

  return (
    <section className="space-y-4 border-b border-border pb-8 font-sans">
      <SectionHeading
        icon={icon}
        title={title}
        right={
          <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
            <button
              type="button"
              onClick={() => toggle("import")}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                panel === "import" ? "bg-muted text-foreground" : "text-zinc-800 dark:text-zinc-200 hover:text-foreground"
              }`}
            >
              <Wand2 className="size-3" />
              From JSON
            </button>
            <button
              type="button"
              onClick={() => toggle("json")}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                panel === "json" ? "bg-muted text-foreground" : "text-zinc-800 dark:text-zinc-200 hover:text-foreground"
              }`}
            >
              <Braces className="size-3" />
              Schema
            </button>
          </div>
        }
      >
        {hint}
      </SectionHeading>

      {panel === "import" && (
        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-[11px] font-medium text-zinc-800 dark:text-zinc-200">
            Paste one example {label} object. Every key becomes a field you can fine-tune. This replaces the fields below.
          </p>
          <textarea
            value={sample}
            onChange={(e) => setSample(e.target.value)}
            rows={4}
            spellCheck={false}
            placeholder={samplePlaceholder}
            className="w-full resize-none rounded-md border border-border bg-background p-2.5 font-sans text-[11px] text-foreground outline-none focus:border-foreground/40 placeholder:text-zinc-500 dark:placeholder:text-zinc-400"
          />
          {importError && <p className="text-[11px] text-destructive">{importError}</p>}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={runImport}
              disabled={!sample.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-[11px] font-medium text-background hover:bg-foreground/90 disabled:opacity-40 cursor-pointer"
            >
              <Wand2 className="size-3" />
              Detect fields
            </button>
          </div>
        </div>
      )}

      {panel === "json" && (
        <pre className="max-h-56 overflow-auto rounded-lg border border-border bg-muted/40 p-3 font-sans text-[11px] leading-relaxed text-foreground">
          {JSON.stringify(fieldsToSchema(fields), null, 2)}
        </pre>
      )}

      {fields.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
          <p className="text-sm font-semibold text-foreground">No {label} fields yet</p>
          <p className="mt-1 text-xs font-medium text-zinc-700 dark:text-zinc-300">
            Pick a type below, or detect them from a JSON example.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {fields.map((f, i) => (
            <FieldRow
              key={f.id}
              field={f}
              index={i}
              onChange={(nf) => onChange(fields.map((x) => (x.id === f.id ? nf : x)))}
              onRemove={() => onChange(fields.filter((x) => x.id !== f.id))}
            />
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-800 dark:text-zinc-200">
          <Plus className="size-3" />
          Add
        </span>
        {FIELD_TYPES.map((t) => {
          const TIcon = FIELD_ICON[t];
          return (
            <button
              key={t}
              type="button"
              disabled={full}
              onClick={() => add(t)}
              title={FIELD_TYPE_HINT[t]}
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-300 dark:border-zinc-700 bg-background px-3 py-1 text-[11px] font-semibold text-foreground shadow-2xs transition hover:-translate-y-px hover:border-foreground/40 hover:shadow-xs disabled:opacity-40 cursor-pointer"
            >
              <TIcon className="size-3" />
              {FIELD_TYPE_LABEL[t]}
            </button>
          );
        })}
        <span className="ml-auto text-[11px] font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">
          {fields.length}/{MAX_FIELDS}
        </span>
      </div>
    </section>
  );
}
