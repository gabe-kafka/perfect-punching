import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper:   "#FFFFFF",
        surface: "#F5F5F5",
        ink:     "#1A1A1A",
        muted:   "#6B6B6B",
        dim:     "#505050",
        border:  "#D4D4D4",
        subtle:  "#E8E8E8",
        accentBlue:   "#0057FF",
        accentRed:    "#DC2626",
        accentAmber:  "#D97706",
        accentGreen:  "#16A34A",
        accentCyan:   "#06B6D4",
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"IBM Plex Mono"', "ui-monospace", "Menlo", "monospace"],
        sans: ['"JetBrains Mono"', "ui-monospace", "Menlo", "monospace"],
      },
      borderRadius: { none: "0", sm: "2px", DEFAULT: "0" },
    },
  },
  plugins: [],
} satisfies Config;
