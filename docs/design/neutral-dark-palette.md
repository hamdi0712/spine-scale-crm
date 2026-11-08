# Neutral dark mode (saved option, not applied)

A dark mode without the navy tint, previewed on the Dashboard in November 2026
and parked for later. To apply it, replace the matching values in the `.dark`
block of `src/app/globals.css` and the two `.dark` rules below.

Basis: Material Design's dark theme (a very dark grey near #121212, never pure
black), lighter surfaces for elevation (each layer a few percent lighter than
the one under it), and off-white rather than pure white text.

| Token | Current (navy) | Neutral |
|---|---|---|
| `--c-bg` (page) | 11 14 20 `#0B0E14` | 19 19 21 `#131315` |
| `--c-panel` (sidebar) | 16 20 27 `#10141B` | 23 23 25 `#171719` |
| `--c-surface` (cards) | 22 27 36 `#161B24` | 28 28 31 `#1C1C1F` |
| `--c-wash` (hover, inset rows) | 30 36 46 `#1E242E` | 38 38 42 `#26262A` |
| `--c-line` (borders) | 42 49 61 `#2A313D` | 46 46 51 `#2E2E33` |
| `--c-ink` (text) | 232 234 240 | 236 236 239 `#ECECEF` |
| `--c-ink-soft` | 195 201 214 | 198 198 204 `#C6C6CC` |
| `--c-muted` | 148 156 171 | 148 148 156 `#94949C` |
| `--c-accent-soft` | 25 45 80 | 34 42 58 `#222A3A` |

```css
.dark {
  --c-bg: 19 19 21;
  --c-panel: 23 23 25;
  --c-surface: 28 28 31;
  --c-wash: 38 38 42;
  --c-line: 46 46 51;
  --c-ink: 236 236 239;
  --c-ink-soft: 198 198 204;
  --c-muted: 148 148 156;
  --c-accent-soft: 34 42 58;
  --chart-grid: 46 46 51; --chart-axis: 46 46 51; --chart-tick: 148 148 156;
  --chart-tooltip-bg: 28 28 31; --chart-cursor: 38 38 42;
  --glass-panel-edge: rgb(52 52 58);
  --shadow-card: 0 1px 2px rgba(0,0,0,.45);
}
.dark .glass-panel { background-image: linear-gradient(135deg, #202024 0%, #222226 50%, #252529 100%); }
.dark .donut-glass { background-image: radial-gradient(circle at 38% 30%, rgba(255,255,255,.06), rgba(255,255,255,.02) 58%, transparent 78%); }
```

Blue stays on buttons, links, the active nav item and charts. The US business
hours card was left navy in the preview (it is a night-map image).
