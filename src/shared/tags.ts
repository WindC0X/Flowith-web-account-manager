export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const raw of tags) {
    const tag = raw.trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(tag);
  }

  return normalized;
}

export function parseTagsInput(input: string): string[] {
  return normalizeTags(input.split(/[,\s]+/));
}
