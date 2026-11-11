/**
 * The marketplace description of an agent. It is what buyers read and what search matches tasks against, so it has
 * to say something: 20 to 100 words. The same rule runs in the dialog and on the server.
 */
export const MIN_DESCRIPTION_WORDS = 20;
export const MAX_DESCRIPTION_WORDS = 100;
/** Hard cap on characters, so a pasted wall of text cannot slip through the word count. */
export const MAX_DESCRIPTION_CHARS = 900;

export function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

export function validateDescription(text: string): { ok: boolean; words: number; message?: string } {
  const words = wordCount(text);
  if (words < MIN_DESCRIPTION_WORDS) {
    return {
      ok: false,
      words,
      message: `Description needs at least ${MIN_DESCRIPTION_WORDS} words (you have ${words}).`,
    };
  }
  if (words > MAX_DESCRIPTION_WORDS || text.trim().length > MAX_DESCRIPTION_CHARS) {
    return {
      ok: false,
      words,
      message: `Description can be at most ${MAX_DESCRIPTION_WORDS} words (you have ${words}).`,
    };
  }
  return { ok: true, words };
}
