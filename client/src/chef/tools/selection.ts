/**
 * The picker sends exactly this message, so a click maps to one agent by name and never goes through the
 * model's wording. Client-safe: no server imports.
 */
export function selectionMessage(name: string): string {
  return `Selected agent: "${name}"`;
}
export function parseSelection(text: string): string | null {
  const m = /^\s*selected agent:\s*"(.+)"\s*$/i.exec(text);
  return m ? m[1].trim() : null;
}
