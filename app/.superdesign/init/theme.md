# Theme — Grain Tracker v2

Design language: "console" — a dark grain-elevator scale-house instrument panel. Crimson = action/critical, gold = instrument signal (stable/capture/positive), warm ivory = live telemetry, warm-black ground with gold-whisper hairlines. A `.day` (daylight) mode on `<html>` switches the page ground to warm paper while the sidebar stays dark. Default mode is console-dark (`:root`); there is no `.dark` class — `darkMode: ["class"]` exists in the Tailwind config but the app uses `day` for its light theme.

## Part 1 — Compact token summary

### Color palette (HSL channel triplets, consumed as `hsl(var(--token))`)

| Token | `:root` (console dark) | `.day` (daylight) |
| --- | --- | --- |
| `--background` | `345 14% 5%` | `45 15% 94%` |
| `--foreground` | `45 20% 94%` | `345 20% 12%` |
| `--card` | `345 10% 9%` | `0 0% 99%` |
| `--card-foreground` | `45 20% 94%` | `345 20% 12%` |
| `--popover` | `345 10% 10%` | `0 0% 99%` |
| `--popover-foreground` | `45 20% 94%` | `345 20% 12%` |
| `--primary` (crimson) | `348 86% 54%` | `348 80% 44%` |
| `--primary-foreground` | `0 0% 100%` | `0 0% 100%` |
| `--secondary` | `335 8% 14%` | `42 10% 91%` |
| `--secondary-foreground` | `45 15% 90%` | `345 15% 16%` |
| `--muted` | `335 8% 13%` | `42 8% 92%` |
| `--muted-foreground` | `40 8% 64%` | `345 6% 44%` |
| `--accent` | `335 10% 16%` | `40 14% 89%` |
| `--accent-foreground` | `45 20% 95%` | `345 15% 15%` |
| `--destructive` | `348 84% 60%` | `348 78% 47%` |
| `--destructive-foreground` | `0 0% 100%` | `0 0% 100%` |
| `--border` | `36 14% 20%` | `40 12% 84%` |
| `--input` | `36 12% 24%` | `40 10% 78%` |
| `--ring` | `348 86% 54%` | `348 80% 44%` |

### Sidebar tokens (identical in both modes — the rail stays dark)

| Token | Value |
| --- | --- |
| `--sidebar-background` | `345 16% 4%` |
| `--sidebar-foreground` | `45 15% 88%` |
| `--sidebar-primary` (gold) | `42 96% 58%` |
| `--sidebar-primary-foreground` | `36 70% 8%` |
| `--sidebar-accent` | `335 10% 13%` |
| `--sidebar-accent-foreground` | `45 20% 94%` |
| `--sidebar-border` | `36 12% 16%` |
| `--sidebar-ring` | `348 86% 54%` |

Available as Tailwind `sidebar`, `sidebar-primary`, `sidebar-accent`, `sidebar-border`, `sidebar-ring`, `sidebar-foreground` color utilities.

### Console signal tokens (special)

| Token | `:root` | `.day` | Meaning |
| --- | --- | --- | --- |
| `--live` | `48 30% 88%` (warm ivory) | `345 12% 36%` | moving telemetry / LIVE |
| `--go` | `42 96% 58%` (gold) | `38 90% 40%` | stable / capture / positive (WEIGH buttons) |
| `--crit` | `348 95% 64%` (crimson) | `348 78% 47%` | overdue / critical / offline banner |
| `--readout` | `345 25% 3%` | `45 20% 97%` | inset readout surface ground |

Mapped to Tailwind utilities `live`, `go`, `crit`, `readout` (e.g. `bg-go`, `text-live`, `border-crit/50`, `bg-readout`).

### Fonts

- **Inter** (400/500/600/700/800) — body, loaded from Google Fonts in `index.html`; `font-feature-settings: "cv02", "cv03", "cv04"`.
- **JetBrains Mono** (400–800 + italic 400) — `.font-mono`, `code`, `kbd`; used everywhere for numbers, tickets, labels, eyebrows.
- No custom `fontFamily` in the Tailwind config — families are set in `src/index.css` base layer.

### Type scale conventions (no custom scale in config; Tailwind defaults)

- Page title: `text-xl font-semibold tracking-tight` (rendered by pages; Layout header h1: `text-lg font-semibold`)
- Eyebrow label (`.gt-eyebrow`): mono `text-[10px]` semibold uppercase, `letter-spacing: 0.18em`, muted color
- Scale readout digits: `font-mono text-5xl md:text-6xl font-bold tabular-nums tracking-tight`
- Stat numbers: `font-mono text-xl font-bold tabular-nums`
- Body/table text: `text-sm` (tables often `font-mono text-xs`)

### Radius, shadows, spacing, breakpoints

- `--radius: 0.375rem` → Tailwind `rounded-xs` = radius−6px (0), `sm` = −4px, `md` = −2px (0.25rem), `lg` = `--radius` (0.375rem), `xl` = +4px
- Shadow extension: `shadow-xs: 0 1px 2px 0 rgb(0 0 0 / 0.05)` (plus CSS-only shadows: `.gt-panel` inset-lit panel, gold glow on `button.bg-go`, crimson glow on `button.bg-primary` — dark mode only)
- Spacing: default Tailwind scale; Layout content column `max-w-[1400px]` with `p-6`
- Breakpoints: Tailwind defaults (sm 640 / md 768 / lg 1024 / xl 1280 / 2xl 1536)
- Animations (config): `accordion-down/up 0.2s ease-out`, `caret-blink 1.25s ease-out infinite`; plugin `tailwindcss-animate`
- Keyframes (CSS): `gt-pulse` (LED blink 1.5s; crit 1.1s), `gt-sweep` (radar 4.2s), `gt-ticker` (marquee 48s); all disabled under `prefers-reduced-motion`

### `.gt-*` utility classes (`src/index.css` `@layer components`)

| Class | Purpose |
| --- | --- |
| `.gt-panel` | hairline console panel: `rounded-md border border-border bg-card` + inset top-edge light and depth shadow — used on most Cards |
| `.gt-brand` | gold→crimson gradient text (115deg, `42 96% 62%` → `38 92% 54%` → `348 86% 62%`), background-clip text |
| `.gt-eyebrow` | mono uppercase micro-label (see type conventions) |
| `.gt-led` + `.gt-led-on` / `-live` / `-warn` / `-crit` | 6px glowing status dot (gold/ivory/crimson/primary) with `gt-pulse` animation |
| `.gt-scan` | CRT scanline overlay (`::after` repeating-linear-gradient, 1px/3px) for readout surfaces; dark lines in `.day` |
| `.gt-ticker` + `.gt-ticker-track` | status marquee: horizontal mask fade, 48s loop, pause on hover |
| `.gt-radar` | circular radar sweep (`::before` conic-gradient in primary, `gt-sweep` rotation) — logo mark |
| `.gt-node` | 18px radar-node toggle dot (`data-on="true"` → gold glow + pulse) — replaces switches |
| (element-scoped) `html:not(.day) button.bg-go` | brushed-gold gradient + glow for WEIGH buttons (disabled state flat) |
| (element-scoped) `html:not(.day) button.bg-primary` | crimson gloss + glow on primary buttons |
| (element-scoped) `.gt-scan .text-go` / `.text-live` | dark-mode text glow on readout digits |

Other global base styles: `::selection` gold on dark; thin 6px scrollbars (webkit + `scrollbar-width: thin`); `:focus-visible` double ring (background + ring); ambient fixed radial gradients on `body` (crimson top-left + gold top-right in console; warm vignette in day); `#ticket-print` print rules that hide the app and show a paper scale ticket (inverted for on-screen proofing in dark mode).

## Part 2 — Raw source dumps

### `src/index.css` (full)

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  /* ---- Console (dark) — default ------------------------------------
     Crimson / grey / gold / black, layered: warm-black ground with a
     crimson undertone, warm-grey cards and hairlines with a gold whisper,
     crimson for action + critical signal, gold as the instrument signal
     color (stable weight, capture, positive). */
  :root {
    --background: 345 14% 5%;
    --foreground: 45 20% 94%;
    --card: 345 10% 9%;
    --card-foreground: 45 20% 94%;
    --popover: 345 10% 10%;
    --popover-foreground: 45 20% 94%;
    --primary: 348 86% 54%;
    --primary-foreground: 0 0% 100%;
    --secondary: 335 8% 14%;
    --secondary-foreground: 45 15% 90%;
    --muted: 335 8% 13%;
    --muted-foreground: 40 8% 64%;
    --accent: 335 10% 16%;
    --accent-foreground: 45 20% 95%;
    --destructive: 348 84% 60%;
    --destructive-foreground: 0 0% 100%;
    --border: 36 14% 20%;
    --input: 36 12% 24%;
    --ring: 348 86% 54%;
    --radius: 0.375rem;
    --sidebar-background: 345 16% 4%;
    --sidebar-foreground: 45 15% 88%;
    --sidebar-primary: 42 96% 58%;
    --sidebar-primary-foreground: 36 70% 8%;
    --sidebar-accent: 335 10% 13%;
    --sidebar-accent-foreground: 45 20% 94%;
    --sidebar-border: 36 12% 16%;
    --sidebar-ring: 348 86% 54%;
    /* console signal tokens */
    --live: 48 30% 88%; /* warm ivory — moving telemetry */
    --go: 42 96% 58%; /* gold — stable / capture / positive */
    --crit: 348 95% 64%; /* crimson — overdue / critical */
    --readout: 345 25% 3%; /* inset readout ground */
  }

  /* ---- Daylight mode ----------------------------------------------
     Same structure, soft warm-grey paper ground for office / daylight
     use; crimson stays the action color, gold darkens for contrast. */
  .day {
    --background: 45 15% 94%;
    --foreground: 345 20% 12%;
    --card: 0 0% 99%;
    --card-foreground: 345 20% 12%;
    --popover: 0 0% 99%;
    --popover-foreground: 345 20% 12%;
    --primary: 348 80% 44%;
    --primary-foreground: 0 0% 100%;
    --secondary: 42 10% 91%;
    --secondary-foreground: 345 15% 16%;
    --muted: 42 8% 92%;
    --muted-foreground: 345 6% 44%;
    --accent: 40 14% 89%;
    --accent-foreground: 345 15% 15%;
    --destructive: 348 78% 47%;
    --destructive-foreground: 0 0% 100%;
    --border: 40 12% 84%;
    --input: 40 10% 78%;
    --ring: 348 80% 44%;
    --sidebar-background: 345 16% 4%;
    --sidebar-foreground: 45 15% 88%;
    --sidebar-primary: 42 96% 58%;
    --sidebar-primary-foreground: 36 70% 8%;
    --sidebar-accent: 335 10% 13%;
    --sidebar-accent-foreground: 45 20% 94%;
    --sidebar-border: 36 12% 16%;
    --sidebar-ring: 348 86% 54%;
    --live: 345 12% 36%;
    --go: 38 90% 40%;
    --crit: 348 78% 47%;
    --readout: 45 20% 97%;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  html {
    color-scheme: dark;
  }
  html.day {
    color-scheme: light;
  }
  body {
    @apply bg-background text-foreground;
    font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    font-feature-settings: "cv02", "cv03", "cv04";
  }
  .font-mono,
  code,
  kbd {
    font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  ::selection {
    background: hsl(var(--go));
    color: hsl(var(--sidebar-primary-foreground));
  }
  /* thin console scrollbar */
  ::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  ::-webkit-scrollbar-track {
    background: transparent;
  }
  ::-webkit-scrollbar-thumb {
    background: hsl(var(--border));
    border-radius: 3px;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: hsl(var(--go) / 0.65);
  }
  * {
    scrollbar-width: thin;
    scrollbar-color: hsl(var(--border)) transparent;
  }
  :focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px hsl(var(--background)), 0 0 0 4px hsl(var(--ring));
  }
  /* ambient console glow — faint crimson and gold wash from the top */
  html:not(.day) body {
    background-image: radial-gradient(
        1100px 480px at 12% -8%,
        hsl(348 86% 54% / 0.08),
        transparent 62%
      ),
      radial-gradient(950px 420px at 88% -8%, hsl(42 96% 58% / 0.06), transparent 60%);
    background-attachment: fixed;
  }
  /* daylight: soft warm paper vignette instead */
  html.day body {
    background-image: radial-gradient(1200px 520px at 50% -10%, hsl(42 60% 70% / 0.12), transparent 65%);
    background-attachment: fixed;
  }
}

@layer components {
  /* hairline console panel — with a lit top edge and depth */
  .gt-panel {
    @apply rounded-md border border-border bg-card;
    box-shadow:
      inset 0 1px 0 hsl(45 40% 85% / 0.05),
      0 2px 10px hsl(345 30% 2% / 0.5);
  }
  /* gold→crimson gradient brand wordmark */
  .gt-brand {
    background: linear-gradient(
      115deg,
      hsl(42 96% 62%),
      hsl(38 92% 54%) 45%,
      hsl(348 86% 62%)
    );
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  /* brushed-gold capture buttons (WEIGH IN / OUT) */
  html:not(.day) button.bg-go {
    background-image: linear-gradient(
      180deg,
      hsl(48 100% 72% / 0.32),
      hsl(38 96% 52% / 0.1) 55%,
      hsl(30 90% 32% / 0.28)
    );
    box-shadow:
      inset 0 1px 0 hsl(0 0% 100% / 0.28),
      0 0 0 1px hsl(42 96% 58% / 0.4),
      0 8px 26px hsl(42 96% 58% / 0.22);
  }
  html:not(.day) button.bg-go:disabled {
    background-image: none;
    box-shadow: none;
  }
  /* crimson gloss on primary action buttons */
  html:not(.day) button.bg-primary {
    background-image: linear-gradient(
      180deg,
      hsl(0 0% 100% / 0.16),
      hsl(0 0% 0% / 0.06) 55%,
      hsl(348 90% 24% / 0.35)
    );
    box-shadow:
      inset 0 1px 0 hsl(0 0% 100% / 0.18),
      0 6px 18px hsl(348 86% 54% / 0.28);
  }
  html:not(.day) button.bg-primary:disabled {
    background-image: none;
    box-shadow: none;
  }
  /* glowing readout digits on scanline surfaces */
  html:not(.day) .gt-scan .text-go {
    text-shadow:
      0 0 10px hsl(42 96% 58% / 0.55),
      0 0 30px hsl(42 96% 58% / 0.25);
  }
  html:not(.day) .gt-scan .text-live {
    text-shadow:
      0 0 10px hsl(48 30% 88% / 0.45),
      0 0 30px hsl(48 30% 88% / 0.2);
  }
  /* mono eyebrow label — uppercase, wide tracking */
  .gt-eyebrow {
    font-family: "JetBrains Mono", ui-monospace, monospace;
    @apply text-[10px] font-semibold uppercase text-muted-foreground;
    letter-spacing: 0.18em;
  }
  /* glowing status LED */
  .gt-led {
    display: inline-block;
    height: 6px;
    width: 6px;
    border-radius: 9999px;
    background: hsl(var(--muted-foreground) / 0.5);
  }
  .gt-led-on {
    background: hsl(var(--go));
    box-shadow: 0 0 6px hsl(var(--go) / 0.9), 0 0 14px hsl(var(--go) / 0.45);
    animation: gt-pulse 1.5s ease-in-out infinite;
  }
  .gt-led-live {
    background: hsl(var(--live));
    box-shadow: 0 0 6px hsl(var(--live) / 0.9), 0 0 14px hsl(var(--live) / 0.45);
    animation: gt-pulse 1.5s ease-in-out infinite;
  }
  .gt-led-warn {
    background: hsl(var(--primary));
    box-shadow: 0 0 6px hsl(var(--primary) / 0.9), 0 0 14px hsl(var(--primary) / 0.45);
    animation: gt-pulse 1.5s ease-in-out infinite;
  }
  .gt-led-crit {
    background: hsl(var(--crit));
    box-shadow: 0 0 6px hsl(var(--crit) / 0.9), 0 0 14px hsl(var(--crit) / 0.45);
    animation: gt-pulse 1.1s ease-in-out infinite;
  }
  /* scanline texture overlay for readout surfaces */
  .gt-scan {
    position: relative;
    isolation: isolate;
  }
  .gt-scan::after {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 1;
    pointer-events: none;
    background: repeating-linear-gradient(
      0deg,
      hsl(0 0% 100% / 0.028) 0px,
      hsl(0 0% 100% / 0.028) 1px,
      transparent 1px,
      transparent 3px
    );
  }
  .day .gt-scan::after {
    background: repeating-linear-gradient(
      0deg,
      hsl(0 0% 20% / 0.035) 0px,
      hsl(0 0% 20% / 0.035) 1px,
      transparent 1px,
      transparent 3px
    );
  }
  /* status ticker marquee */
  .gt-ticker {
    overflow: hidden;
    -webkit-mask-image: linear-gradient(90deg, transparent, black 4%, black 96%, transparent);
    mask-image: linear-gradient(90deg, transparent, black 4%, black 96%, transparent);
  }
  .gt-ticker-track {
    display: flex;
    width: max-content;
    animation: gt-ticker 48s linear infinite;
  }
  .gt-ticker:hover .gt-ticker-track {
    animation-play-state: paused;
  }
  /* radar sweep (logo / live indicator) */
  .gt-radar {
    position: relative;
    overflow: hidden;
    border-radius: 9999px;
  }
  .gt-radar::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: conic-gradient(
      from 0deg,
      hsl(var(--primary) / 0.85),
      hsl(var(--primary) / 0.15) 70deg,
      transparent 110deg
    );
    animation: gt-sweep 4.2s linear infinite;
  }
  /* radar-node toggle (replaces standard switch for operator options) */
  .gt-node {
    position: relative;
    height: 18px;
    width: 18px;
    flex: none;
    border-radius: 9999px;
    border: 1px solid hsl(var(--muted-foreground) / 0.6);
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }
  .gt-node::after {
    content: "";
    position: absolute;
    inset: 5px;
    border-radius: 9999px;
    background: transparent;
    transition: background 0.15s ease, box-shadow 0.15s ease;
  }
  .gt-node[data-on="true"] {
    border-color: hsl(var(--go));
    box-shadow: 0 0 8px hsl(var(--go) / 0.5);
  }
  .gt-node[data-on="true"]::after {
    background: hsl(var(--go));
    box-shadow: 0 0 6px hsl(var(--go) / 0.9);
    animation: gt-pulse 1.6s ease-in-out infinite;
  }
}

@keyframes gt-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

@keyframes gt-sweep {
  to {
    transform: rotate(360deg);
  }
}

@keyframes gt-ticker {
  to {
    transform: translateX(-50%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .gt-led-on,
  .gt-led-live,
  .gt-led-warn,
  .gt-led-crit,
  .gt-node[data-on="true"]::after {
    animation: none;
  }
  .gt-radar::before {
    animation: none;
  }
  .gt-ticker-track {
    animation: none;
    width: auto;
  }
}

/* Printable scale ticket: hide the app, show only the ticket */
#ticket-print {
  display: none;
}
@media print {
  body * {
    visibility: hidden;
  }
  #ticket-print,
  #ticket-print * {
    visibility: visible;
  }
  #ticket-print {
    display: block;
    position: absolute;
    inset: 0;
    background: #fff;
    color: #000;
  }
}
/* console-dark ticket: invert back to paper for on-screen proofing */
html:not(.day) #ticket-print {
  filter: invert(1) hue-rotate(180deg);
}
```

### `tailwind.config.js` (full)

```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
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
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
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
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        live: "hsl(var(--live))",
        go: "hsl(var(--go))",
        crit: "hsl(var(--crit))",
        readout: "hsl(var(--readout))",
      },
      borderRadius: {
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xs: "calc(var(--radius) - 6px)",
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "caret-blink": {
          "0%,70%,100%": { opacity: "1" },
          "20%,50%": { opacity: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "caret-blink": "caret-blink 1.25s ease-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
```

### `index.html` — font loading (full)

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400&display=swap"
      rel="stylesheet"
    />
    <title>Grain Tracker v2</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### Notes

- `src/App.css` exists (default Vite template styles: `#root { max-width: 1280px; … }`) but is **not imported anywhere** — ignore it.
- No theme provider component; theming is a class toggle (`day`) on `<html>` driven by `src/components/Layout.tsx` (`localStorage["gt-theme"]`), and the sonner Toaster mirrors it via MutationObserver.
- PostCSS: standard `tailwindcss` + `autoprefixer` (see `postcss.config.js`).
