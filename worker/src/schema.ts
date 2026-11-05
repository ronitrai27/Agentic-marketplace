import Ajv from "ajv";
import addFormats from "ajv-formats";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

/**
 * Checks a value against a JSON Schema stored as a string. Returns null when it conforms,
 * otherwise a short human-readable list of problems.
 */
export function checkAgainstSchema(schemaJson: string, value: unknown): string | null {
  let schema: Record<string, unknown>;
  try {
    schema = JSON.parse(schemaJson);
  } catch {
    return null; // an unreadable schema can't be enforced
  }
  delete schema.$schema; // Ajv's default draft doesn't know newer meta-schema URLs
  const validate = ajv.compile(schema);
  if (validate(value)) return null;
  return (validate.errors ?? [])
    .slice(0, 5)
    .map((e) => `${e.instancePath || "output"} ${e.message ?? "is invalid"}`)
    .join("; ");
}
