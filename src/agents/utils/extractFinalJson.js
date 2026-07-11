/**
 * Extract the final JSON fenced block from an Analyst response.
 * Scratchpad comes first; JSON last — never parse the whole response.
 */

export function extractFinalJson(fullText) {
  const text = String(fullText ?? "");
  const fenceRe = /```json\s*([\s\S]*?)```/gi;
  let match;
  let lastMatch = null;
  while ((match = fenceRe.exec(text)) !== null) {
    lastMatch = match;
  }

  if (!lastMatch) {
    throw new Error(
      "No ```json fenced block found in Analyst output — expected scratchpad first, then a final JSON block",
    );
  }

  const jsonRaw = lastMatch[1].trim();
  const scratchpad = text.slice(0, lastMatch.index).trim();

  let parsed;
  try {
    parsed = JSON.parse(jsonRaw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse Analyst final JSON block: ${detail}`);
  }

  return { scratchpad, parsed };
}
