import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZodTypeAny } from "zod";

export type SchemaLike = ZodTypeAny | Record<string, unknown> | any;

export function isZodSchema(schema: unknown): boolean {
  return (
    typeof schema === "object" &&
    schema !== null &&
    (("_def" in schema) || ("def" in schema) || ("_zod" in schema)) &&
    (typeof (schema as any).safeParse === "function" || typeof (schema as any).parse === "function")
  );
}

/**
 * Converts a Zod schema (v3 or v4) or passes through a JSON schema object
 * to standard JSON Schema.
 */
export function toJsonSchema(schema: SchemaLike, title?: string): Record<string, unknown> {
  if (!schema) return { type: "object" };

  // 1. Zod v4 native toJSONSchema() support
  if (typeof (schema as any).toJSONSchema === "function") {
    try {
      const nativeJson = (schema as any).toJSONSchema();
      if (nativeJson && typeof nativeJson === "object") {
        return nativeJson;
      }
    } catch (err) {
      console.warn("[catelog] Native toJSONSchema failed, falling back to converter:", err);
    }
  }

  // 2. Zod v3 conversion via zod-to-json-schema
  if (isZodSchema(schema)) {
    try {
      const converted = zodToJsonSchema(schema as any, {
        target: "jsonSchema7",
        $refStrategy: "none",
      }) as any;

      if (converted && typeof converted === "object") {
        if (converted.definitions && typeof converted.definitions === "object") {
          const keys = Object.keys(converted.definitions);
          if (keys.length > 0) {
            return {
              $schema: "http://json-schema.org/draft-07/schema#",
              ...converted.definitions[keys[0]],
            };
          }
        }
        if (converted.properties || converted.type) {
          return converted;
        }
      }
    } catch (err) {
      console.error("[catelog] Failed to convert Zod schema to JSON Schema:", err);
    }
  }

  // 3. Raw JSON schema object pass-through
  if (typeof schema === "object") {
    return schema as Record<string, unknown>;
  }

  return { type: "object" };
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
    const result = (schema as any).safeParse(data);
    if (result.success) {
      return { success: true, data: result.data as T };
    }
    const issues = result.error?.issues ?? result.error?.errors ?? []; // zod 4: .issues, zod 3: .errors
    const formattedErrors = issues.map(
      (err: any) => `${err.path?.join(".") || "root"}: ${err.message}`
    );
    return { success: false, errors: formattedErrors };
  }

  // Raw JSON schema pass-through (pre-validated by gateway as per spec rule 4)
  return { success: true, data: data as T };
}
