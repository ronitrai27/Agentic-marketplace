/**
 * Jev (TypeSafe decision model) through the OpenRouter Decisions API.
 * Verified response shape: { answers: { <id>: { type, noul } | { type, choice, probabilities, confidence } } }.
 */
const DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";

export type NoulQuestion = {
  type: "noul";
  instructions: string;
  criteria?: { true: string; false: string };
};
export type ChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
};
export type JevQuestion = NoulQuestion | ChoiceQuestion;

export type JevAnswer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number };

export type JevResponse = { answers: Record<string, JevAnswer>; usage?: { input_tokens?: number; output_tokens?: number } };

export class JevError extends Error {}

/** One request, many questions; they are answered independently. Throws JevError on any failure or timeout. */
export async function askJev(
  state: Record<string, string>,
  questions: Record<string, JevQuestion>,
  timeoutMs = 2500,
): Promise<JevResponse> {
  const key = process.env.OPENROUTER_JEV;
  const model = process.env.JEV_MODEL;
  if (!key || !model) throw new JevError("OPENROUTER_JEV / JEV_MODEL not set");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(DECISIONS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, state, questions }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new JevError(`Jev HTTP ${res.status}`);
    const json = (await res.json()) as JevResponse;
    if (!json?.answers) throw new JevError("Jev response has no answers");
    return json;
  } catch (e) {
    if (e instanceof JevError) throw e;
    throw new JevError(e instanceof Error ? e.message : "Jev request failed");
  } finally {
    clearTimeout(timer);
  }
}
