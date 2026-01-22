export function redactSensitive(text: string): string {
  return text
    .replace(/\\b[a-zA-Z0-9_\\-]{24,}\\b/g, "[REDACTED]")
    .slice(0, 400);
}

