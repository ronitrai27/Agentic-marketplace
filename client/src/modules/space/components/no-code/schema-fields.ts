/** Field model behind the no-code schema builder, and its conversion to a strict JSON Schema. */

export type FieldType = "text" | "number" | "boolean" | "choice" | "list";

export interface SchemaField {
  id: string;
  name: string;
  type: FieldType;
  required: boolean;
  description: string;
  /** Only for "choice". */
  options: string[];
}

export const MAX_FIELDS = 20;
export const MAX_OPTIONS = 8;

export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  text: "Text",
  number: "Number",
  boolean: "Yes / No",
  choice: "Choice",
  list: "List",
};

export const FIELD_TYPE_HINT: Record<FieldType, string> = {
  text: "Any words or sentences",
  number: "A whole or decimal number",
  boolean: "A true / false switch",
  choice: "One of a few fixed options",
  list: "Several text values",
};

export const FIELD_TYPES: FieldType[] = ["text", "number", "boolean", "choice", "list"];

const NAME_RE = /^[a-z][a-z0-9_]{0,39}$/;

export const newId = () => Math.random().toString(36).slice(2, 10);

export function newField(type: FieldType, name = ""): SchemaField {
  return {
    id: newId(),
    name,
    type,
    required: true,
    description: "",
    options: type === "choice" ? ["option_a", "option_b"] : [],
  };
}

/** Field names become JSON keys: lower snake_case, starting with a letter. */
export function toFieldName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .slice(0, 40);
}

/** The first problem with this list of fields, or null when it is fine. */
export function fieldsProblem(fields: SchemaField[], label: string): string | null {
  if (fields.length === 0) return `Add at least one ${label} field.`;
  const seen = new Set<string>();
  for (const f of fields) {
    if (!NAME_RE.test(f.name)) return `Every ${label} field needs a name (lowercase letters, numbers, _).`;
    if (seen.has(f.name)) return `Two ${label} fields are named "${f.name}".`;
    seen.add(f.name);
    if (f.type === "choice") {
      const opts = f.options.map((o) => o.trim()).filter(Boolean);
      if (opts.length < 2) return `"${f.name}" needs at least 2 options.`;
      if (new Set(opts).size !== opts.length) return `"${f.name}" has the same option twice.`;
    }
  }
  return null;
}

function propertyFor(f: SchemaField): Record<string, unknown> {
  const base: Record<string, unknown> =
    f.type === "text"
      ? { type: "string" }
      : f.type === "number"
        ? { type: "number" }
        : f.type === "boolean"
          ? { type: "boolean" }
          : f.type === "choice"
            ? { type: "string", enum: f.options.map((o) => o.trim()).filter(Boolean) }
            : { type: "array", items: { type: "string" } };
  if (f.description.trim()) base.description = f.description.trim();
  return base;
}

/** Strict object schema: only the declared keys, required ones listed. */
export function fieldsToSchema(fields: SchemaField[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const f of fields) if (f.name) properties[f.name] = propertyFor(f);
  const required = fields.filter((f) => f.required && f.name).map((f) => f.name);
  return {
    type: "object",
    properties,
    ...(required.length > 0 && { required }),
    additionalProperties: false,
  };
}

/** Builds fields from a sample JSON object, e.g. the body your n8n webhook expects or returns. */
export function inferFields(json: string): SchemaField[] {
  const parsed = JSON.parse(json);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Paste a JSON object, like { \"name\": \"Jane\" }.");
  }
  return Object.entries(parsed as Record<string, unknown>)
    .slice(0, MAX_FIELDS)
    .map(([key, value]) => {
      const type: FieldType =
        typeof value === "number"
          ? "number"
          : typeof value === "boolean"
            ? "boolean"
            : Array.isArray(value)
              ? "list"
              : "text";
      return { ...newField(type, toFieldName(key)), name: toFieldName(key) };
    });
}

/** A starting value for each field in the dry-run form. */
export function sampleValue(f: SchemaField): unknown {
  if (f.type === "number") return 1;
  if (f.type === "boolean") return false;
  if (f.type === "choice") return f.options[0] ?? "";
  if (f.type === "list") return [];
  return "";
}

export interface FieldCheck {
  name: string;
  ok: boolean;
  message: string;
}

function typeMatches(f: SchemaField, value: unknown): boolean {
  if (f.type === "text") return typeof value === "string";
  if (f.type === "number") return typeof value === "number" && Number.isFinite(value);
  if (f.type === "boolean") return typeof value === "boolean";
  if (f.type === "choice") return typeof value === "string" && f.options.includes(value);
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/** Checks a webhook answer against the declared output fields, one line per field. */
export function checkOutput(fields: SchemaField[], output: unknown): FieldCheck[] {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return [{ name: "response", ok: false, message: "The answer must be a JSON object." }];
  }
  const obj = output as Record<string, unknown>;
  const checks: FieldCheck[] = fields.map((f) => {
    const present = f.name in obj && obj[f.name] !== null && obj[f.name] !== undefined;
    if (!present) {
      return f.required
        ? { name: f.name, ok: false, message: "Missing, but it is required" }
        : { name: f.name, ok: true, message: "Optional, not returned" };
    }
    return typeMatches(f, obj[f.name])
      ? { name: f.name, ok: true, message: `${FIELD_TYPE_LABEL[f.type]} as declared` }
      : { name: f.name, ok: false, message: `Expected ${FIELD_TYPE_LABEL[f.type].toLowerCase()}` };
  });
  const declared = new Set(fields.map((f) => f.name));
  for (const key of Object.keys(obj)) {
    if (!declared.has(key)) {
      checks.push({ name: key, ok: false, message: "Not declared. Add it to the output or remove it in n8n" });
    }
  }
  return checks;
}
