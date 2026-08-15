import type { Config } from "tailwindcss";

/**
 * The design system, expressed as Tailwind theme values.
 *
 * globals.css holds the tokens; this makes them reachable from className, which
 * is how most of this app is written. Without it every migrated file has to
 * switch to inline styles, which is a lot of churn for no gain and loses
 * hover/focus/responsive variants.
 *
 * Deliberately semantic names — `text-muted`, `bg-paper`, `border-rule` — rather
 * than a numeric ramp. A ramp invites picking a shade, which is how the app
 * ended up with eight H1 sizes and fourteen greys. If a name is missing, that is
 * a prompt to ask what job the colour does, not to add another step.
 */
const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: "var(--paper)",
        "paper-raised": "var(--paper-raised)",
        "paper-sunken": "var(--paper-sunken)",
        ink: "var(--ink)",
        muted: "var(--ink-muted)",
        faint: "var(--ink-faint)",
        rule: "var(--rule)",
        "rule-strong": "var(--rule-strong)",
        /* The ground behind a modal. A complete rgba, never a colour plus an
           opacity modifier — `bg-ink/40` computes to rgba(0,0,0,0) because --ink
           resolves to a hex, which is how the step-up dialog shipped with no
           backdrop at all. See globals.css. */
        scrim: "var(--scrim)",

        /* State. One job each — see globals.css for why there is no "success". */
        sage: "var(--sage)",
        "sage-text": "var(--sage-text)",
        "sage-soft": "var(--sage-soft)",
        ochre: "var(--ochre)",
        "ochre-text": "var(--ochre-text)",
        "ochre-soft": "var(--ochre-soft)",
        clay: "var(--clay)",
        "clay-soft": "var(--clay-soft)",

        background: "var(--background)",
        foreground: "var(--foreground)",
      },
      fontFamily: {
        sans: ["var(--font-ui)"],
        serif: ["var(--font-read)"],
      },
      fontSize: {
        t1: "var(--t1)",
        t2: "var(--t2)",
        t3: "var(--t3)",
        t4: "var(--t4)",
        t5: "var(--t5)",
        t6: "var(--t6)",
        t7: "var(--t7)",
        t8: "var(--t8)",
        t9: "var(--t9)",
      },
      borderRadius: {
        owner: "var(--radius-owner)",
        access: "var(--radius-access)",
      },
    },
  },
  plugins: [],
};
export default config;
