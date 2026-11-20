import type { CitationValidation, Passage } from "./types";

const CITATION = /\[\[([^[\]\n]{1,512})\]\]/g;

export function escapeCitationText(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function validateCitations(
  answer: string,
  passages: readonly Passage[]
): CitationValidation {
  const supplied = new Map(passages.map((passage) => [passage.id, passage]));
  const cited = new Map<string, Passage>();
  const cleaned = answer.replace(CITATION, (_match, rawId: string) => {
    const passage = supplied.get(rawId.trim());

    if (passage !== undefined) {
      cited.set(passage.id, passage);
    }

    return "";
  });

  return {
    answer: cleaned,
    citations: [...cited.values()],
    unsupported: cited.size === 0,
  };
}
