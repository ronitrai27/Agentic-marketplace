/** Case-insensitive env lookup, so differently-cased variable names still resolve. */
function envAny(...names: string[]): string | undefined {
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  for (const [k, v] of Object.entries(process.env)) {
    if (v && wanted.has(k.toLowerCase())) return v;
  }
  return undefined;
}

export const groqApiKey = (): string | undefined => envAny("GROQ_API_KEY");
export const anthropicApiKey = (): string | undefined => envAny("ANTHROPIC_API_KEY");
