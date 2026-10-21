import type { Config } from "tailwindcss";
import tailwindAnimate from "tailwindcss-animate";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    // Class strings built in pure modules (badge / accent colours in
    // lib/payments/table-display.ts).
    "./src/lib/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        rd: {
          red: "var(--rd-red)",
          text: "var(--rd-text)",
          black: "var(--rd-black)",
          muted: "var(--rd-muted)",
          placeholder: "var(--rd-placeholder)",
          chevron: "var(--rd-chevron)",
          border: "var(--rd-border)",
          "border-secondary": "var(--rd-border-secondary)",
          disabled: "var(--rd-disabled)",
          divider: "var(--rd-divider)",
          fill: "var(--rd-fill)",
          page: "var(--rd-page)",
          label: "var(--rd-label)",
          "row-error": "var(--rd-row-error)",
          approved: "var(--rd-approved)",
          pending: "var(--rd-pending)",
          rejected: "var(--rd-rejected)",
          hold: "var(--rd-hold)",
        },
      },
      fontFamily: {
        gilroy: ["Gilroy", "system-ui", "-apple-system", "sans-serif"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        rd: "var(--rd-radius)",
      },
    },
  },
  plugins: [tailwindAnimate],
};
export default config;
