export type UserAgentPreset = {
  id: string;
  label: string;
  value: string;
};

export const USER_AGENT_PRESETS: UserAgentPreset[] = [
  {
    id: "chrome_win",
    label: "Chrome (Windows)",
    value:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  },
  {
    id: "chrome_mac",
    label: "Chrome (macOS)",
    value:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  },
  {
    id: "chrome_linux",
    label: "Chrome (Linux)",
    value:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  },
  {
    id: "safari_ios",
    label: "Safari (iOS)",
    value:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  },
];

export function findUserAgentPreset(id: string): UserAgentPreset | null {
  const trimmed = id.trim();
  if (!trimmed) return null;
  return USER_AGENT_PRESETS.find((p) => p.id === trimmed) ?? null;
}
