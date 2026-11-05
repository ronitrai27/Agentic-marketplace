"use client";

import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export type FieldKind = "file" | "text" | "longtext" | "number" | "integer" | "boolean" | "enum" | "json";

export interface FormField {
  name: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  description?: string;
  options?: string[];
  initial?: string | boolean;
  /** file: extensions to offer in the picker, e.g. ".pdf,.docx" (read from the field's description). */
  accept?: string;
  /** file: the sibling field that receives the picked file's name (shown nowhere, filled automatically). */
  filenameField?: string;
  hidden?: boolean;
}

/** Largest file we accept: its base64 form must still fit the 8 MB the agents allow for a request. */
export const MAX_FILE_BYTES = 6 * 1024 * 1024;

export type FormValues = Record<string, string | boolean>;

type Schema = Record<string, unknown>;
const isRecord = (v: unknown): v is Schema => !!v && typeof v === "object" && !Array.isArray(v);

/** Unwraps nullable wrappers like anyOf: [{type: "string"}, {type: "null"}]. */
function resolve(prop: Schema): Schema {
  const variants = (prop.anyOf ?? prop.oneOf) as unknown;
  if (Array.isArray(variants)) {
    const real = variants.filter(isRecord).find((s) => s.type !== "null");
    if (real) return { ...real, title: prop.title ?? real.title, description: prop.description ?? real.description, default: prop.default ?? real.default };
  }
  return prop;
}

/** Turns an agent's input JSON Schema into the fields of a form. */
export function fieldsFromSchema(schemaJson: string): FormField[] {
  let schema: Schema;
  try {
    schema = JSON.parse(schemaJson);
  } catch {
    return [];
  }
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);

  const built = Object.entries(properties).filter(([, p]) => isRecord(p)).map(([name, raw]) => {
    const prop = resolve(raw as Schema);
    const options = Array.isArray(prop.enum) ? prop.enum.map(String) : undefined;
    const type = Array.isArray(prop.type) ? prop.type.find((t) => t !== "null") : prop.type;
    const maxLength = typeof prop.maxLength === "number" ? prop.maxLength : 0;

    const looksLikeFile =
      type === "string" && !options && (/base64$/i.test(name) || prop.contentEncoding === "base64" || /base64/i.test(String(prop.description ?? "")));

    let kind: FieldKind = "json";
    if (looksLikeFile) kind = "file";
    else if (options) kind = "enum";
    else if (type === "string") kind = maxLength > 200 || /prompt|query|instruction|description|text|message|body/i.test(name) ? "longtext" : "text";
    else if (type === "number") kind = "number";
    else if (type === "integer") kind = "integer";
    else if (type === "boolean") kind = "boolean";

    const fallback = prop.default;
    const sibling = name.replace(/_?base64$/i, "") + "_filename";
    const accept = [...new Set([...String(prop.description ?? "").matchAll(/\.([a-z0-9]{2,5})\b/gi)].map((m) => `.${m[1].toLowerCase()}`))].join(",");
    return {
      accept: kind === "file" && accept ? accept : undefined,
      filenameField: kind === "file" && sibling in properties ? sibling : undefined,
      name,
      label: typeof prop.title === "string" ? prop.title : name,
      kind,
      required: required.has(name),
      description: typeof prop.description === "string" ? prop.description : undefined,
      options,
      initial:
        kind === "boolean"
          ? Boolean(fallback)
          : fallback === undefined
            ? kind === "enum" && required.has(name) ? options?.[0] ?? "" : ""
            : kind === "json" ? JSON.stringify(fallback) : String(fallback),
    };
  });
  return markCompanions(built);
}

/** Hides each file field's filename companion: picking a file fills both. */
function markCompanions(fields: FormField[]): FormField[] {
  const companions = new Set(fields.flatMap((f) => (f.filenameField ? [f.filenameField] : [])));
  return fields.map((f) => (companions.has(f.name) ? { ...f, hidden: true } : f));
}

export function initialValues(fields: FormField[]): FormValues {
  return Object.fromEntries(fields.map((f) => [f.name, f.initial ?? (f.kind === "boolean" ? false : "")]));
}

/** Converts form values to the JSON input the agent expects, or lists what is wrong per field. */
export function buildInput(
  fields: FormField[],
  values: FormValues,
): { input: Record<string, unknown>; errors?: undefined } | { errors: Record<string, string>; input?: undefined } {
  const input: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const raw = values[f.name];
    if (f.kind === "boolean") {
      input[f.name] = Boolean(raw);
      continue;
    }
    const text = typeof raw === "string" ? raw.trim() : "";
    if (text === "") {
      if (f.required) errors[f.name] = "Required";
      continue;
    }
    if (f.kind === "number" || f.kind === "integer") {
      const n = Number(text);
      if (!Number.isFinite(n) || (f.kind === "integer" && !Number.isInteger(n))) errors[f.name] = f.kind === "integer" ? "Enter a whole number" : "Enter a number";
      else input[f.name] = n;
    } else if (f.kind === "json") {
      try {
        input[f.name] = JSON.parse(text);
      } catch {
        errors[f.name] = "Enter valid JSON";
      }
    } else {
      input[f.name] = text;
    }
  }
  return Object.keys(errors).length ? { errors } : { input };
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}

export function SchemaForm({
  fields,
  values,
  errors,
  disabled,
  onChange,
}: {
  fields: FormField[];
  values: FormValues;
  errors: Record<string, string>;
  disabled?: boolean;
  onChange: (name: string, value: string | boolean) => void;
}) {
  const [fileErrors, setFileErrors] = React.useState<Record<string, string>>({});
  const [picked, setPicked] = React.useState<Record<string, string>>({});

  async function pick(f: FormField, file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setFileErrors((e) => ({ ...e, [f.name]: `File is too large (max ${MAX_FILE_BYTES / 1024 / 1024} MB)` }));
      return;
    }
    setFileErrors((e) => ({ ...e, [f.name]: "" }));
    onChange(f.name, await readBase64(file));
    if (f.filenameField) onChange(f.filenameField, file.name);
    setPicked((p) => ({ ...p, [f.name]: `${file.name} · ${(file.size / 1024).toFixed(0)} KB` }));
  }

  if (fields.length === 0) {
    return <p className="text-sm text-muted-foreground">This agent takes no input. Send to start it.</p>;
  }
  return (
    <div className="space-y-4">
      {fields.filter((f) => !f.hidden).map((f) => {
        const id = `run-field-${f.name}`;
        const value = values[f.name];
        return (
          <div key={f.name} className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor={id} className="text-xs font-medium">
                {f.label}
                {f.required && <span className="ml-0.5 text-red-500">*</span>}
              </Label>
              {f.kind === "boolean" && (
                <Switch id={id} checked={Boolean(value)} disabled={disabled} onCheckedChange={(c) => onChange(f.name, Boolean(c))} />
              )}
            </div>
            {f.kind === "file" ? (
              <div className="space-y-1">
                <Input
                  id={id}
                  type="file"
                  accept={f.accept}
                  disabled={disabled}
                  onChange={(e) => void pick(f, e.target.files?.[0])}
                  className="cursor-pointer file:mr-3 file:cursor-pointer file:text-xs file:font-medium"
                />
                {picked[f.name] && <p className="text-[11px] text-emerald-600">Attached: {picked[f.name]}</p>}
              </div>
            ) : f.kind === "longtext" || f.kind === "json" ? (
              <Textarea
                id={id}
                rows={f.kind === "json" ? 4 : 5}
                value={String(value ?? "")}
                disabled={disabled}
                className={f.kind === "json" ? "font-mono text-xs" : undefined}
                placeholder={f.kind === "json" ? "JSON" : undefined}
                onChange={(e) => onChange(f.name, e.target.value)}
              />
            ) : f.kind === "enum" ? (
              <NativeSelect id={id} value={String(value ?? "")} disabled={disabled} onChange={(e) => onChange(f.name, e.target.value)}>
                {!f.required && <NativeSelectOption value="">Not set</NativeSelectOption>}
                {f.options?.map((o) => (
                  <NativeSelectOption key={o} value={o}>
                    {o}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            ) : f.kind !== "boolean" ? (
              <Input
                id={id}
                type={f.kind === "number" || f.kind === "integer" ? "number" : "text"}
                step={f.kind === "integer" ? 1 : "any"}
                value={String(value ?? "")}
                disabled={disabled}
                onChange={(e) => onChange(f.name, e.target.value)}
              />
            ) : null}
            {f.description && <p className="text-[11px] text-muted-foreground">{f.description}</p>}
            {(errors[f.name] || fileErrors[f.name]) && (
              <p className="text-[11px] text-red-500">{errors[f.name] || fileErrors[f.name]}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
