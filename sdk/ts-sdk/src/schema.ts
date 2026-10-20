import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZodTypeAny } from "zod";

export type SchemaLike = ZodTypeAny | Record<string, unknown>;

export function isZodSchema(schema: unknown): schema is ZodTypeAny {
  return (
    typeof schema === "object" &&
    schema !== null &&
    "_def" in schema &&
    typeof (schema as { safeParse?: unknown }).safeParse === "function"
  );
}

/**
 * Converts a Zod schema or passes through a JSON schema object
 * to standard JSON Schema (Draft-07).
 */
export function toJsonSchema(schema: SchemaLike, title?: string): Record<string, unknown> {
  if (isZodSchema(schema)) {
    const converted = zodToJsonSchema(schema, {
      name: title,
      target: "jsonSchema7",
      $refStrategy: "none",
    });

    // If wrapped in definitions, unwrap the root object
    if (converted && typeof converted === "object") {
      const record = converted as Record<string, unknown>;
      const defs = record.definitions as Record<string, unknown> | undefined;
      if (defs && title && defs[title]) {
        return defs[title] as Record<string, unknown>;
      }
      return record;
    }
    return converted as Record<string, unknown>;
  }

  // Already a raw JSON schema object
  return schema as Record<string, unknown>;
}

/**
 * Validates input against schema (if Zod is provided).
 * Returns { success: true, data } or { success: false, error }
 */
export function validateSchemaData<T>(
  schema: SchemaLike,
  data: unknown
): { success: true; data: T } | { success: false; errors: string[] } {
  if (isZodSchema(schema)) {
    const result = schema.safeParse(data);
    if (result.success) {
      return { success: true, data: result.data as T };
    }
    const formattedErrors = result.error.errors.map(
      (err) => `${err.path.join(".") || "root"}: ${err.message}`
    );
    return { success: false, errors: formattedErrors };
  }

  // Raw JSON schema pass-through (pre-validated by gateway as per spec rule 4)
  return { success: true, data: data as T };
}
