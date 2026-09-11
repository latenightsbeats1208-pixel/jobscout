export const tokens = {
  colors: {
    bg: "#ffffff",
    surface: "#fbfbfd",
    surfaceHover: "#f5f5f7",
    border: "#d2d2d7",
    text: "#1d1d1f",
    textSecondary: "#6e6e73",
    accent: "#0071e3",
    accentHover: "#0077ed",
    success: "#30d158",
    warning: "#ff9f0a",
    danger: "#ff3b30",
  },
  radius: { sm: 6, md: 10, lg: 14, xl: 20 },
  spacing: [0, 4, 8, 12, 16, 24, 32, 48, 64, 96] as const,
  shadow: {
    card: "0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)",
    elevated: "0 4px 24px rgba(0,0,0,0.08)",
  },
} as const;
