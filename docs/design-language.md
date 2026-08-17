# Maily Design Language — Apple-grade software UI

The bar: what a customer expects when they pay **$29/mo**. Modeled on Apple's
software design (HIG + Liquid Glass, incl. the 2026 revision), adapted to
Maily's graphite system. This doc is the contract every surface pass follows.

Sources: Apple HIG (developer.apple.com/design/human-interface-guidelines),
"Meet Liquid Glass" (WWDC25 session 219), Apple Newsroom Jun 2025, Liquid Glass
2026 revision notes (reduced transparency, user-tunable tint).

---

## 1. The three principles (Apple's, ours verbatim)

1. **Clarity** — legible, precise, easy to understand. If a color pair fails
   in either theme, it's a bug (see the dark-only sweep recipe below).
2. **Deference** — the UI serves the content and never competes with it.
   Email text, drafts, reports = content. Chrome stays quiet.
3. **Depth** — layers + motion convey hierarchy. Depth is *communication*
   (what floats above what), never decoration.

## 2. Where glass goes (and where it doesn't)

Apple's rule: **glass is for floating controls, not for content.**

- **Glass** (`.boult-glass`, `.boult-glass-card`, `.boult-glass-pill` in
  `globals.css`): things that float *over* content — sticky bars, the
  composer, processing-trace cards, result/artifact cards, message pills,
  confirmation cards, modals' chrome.
- **Liquid Glass** (`.liquid-glass`, `.liquid-glass-card`,
  `.liquid-glass-btn` in `globals.css`): the iOS-26 refraction-rim upgrade —
  directional inset specular arc (bright top-left, faint counter-light
  bottom-right) + diagonal sheen + blur(24px)/saturate(180%). Use for
  floating controls and feed cards where the surface should read as a lens
  over the page (home-feed tab switcher, briefing cards, refresh control,
  FloatingNavbar — which also layers the `#liquid-glass-distortion` SVG
  turbulence filter). Radius comes from markup so one vocabulary covers
  circles, pills, and cards.
- **Calm opaque ground** (`bg-boult-bg/-elevated/-surface` tokens): content
  areas — document bodies (CanvasPanel body), email text, list interiors,
  settings panes.
- **Never stack glass on glass.** A control inside a blurred bar stays a
  flat tint. The home-feed Today/Inbox switcher resolves this the Apple way:
  the full-width blurred bar was REMOVED and the pill itself is the (only)
  glass, floating directly over the feed.
- **Restraint**: Apple *reduced* default transparency in the 2026 revision.
  When in doubt, less blur, lower opacity delta, stronger hairline.

## 3. Color

- Only **semantic tokens** (`boult-fg`, `-fg-secondary`, `-fg-tertiary`,
  `-fg-muted`, `-fg-inverse`; `boult-bg`, `-elevated`, `-surface`,
  `-surface-hover`, `-raised`; `boult-border`, `-divider`) or explicit
  light/dark **pairs** (`text-black/60 dark:text-white/60`). Never a bare
  `text-white/…`, `bg-[#hex]`, or `zinc-…` without its counterpart.
- Accent colors carry **meaning only**: emerald = success/sent, rose = error,
  amber = at-risk/waiting, blue = link/active. Decorative color is noise.
- Status colors need pairs too: `text-emerald-600 dark:text-emerald-400`
  (the `-300/-400` shades vanish on light).

## 4. Typography (SF-style scale, weight = hierarchy)

One family, hierarchy by weight/size — not by color gymnastics.

| Role            | Size (px) | Weight    |
|-----------------|-----------|-----------|
| Page title      | 28–34     | semibold  |
| Section title   | 20–22     | semibold  |
| Headline/card   | 15–17     | semibold  |
| Body            | 14–15     | regular   |
| Secondary/meta  | 12.5–13   | medium    |
| Caption/labels  | 10.5–11 uppercase tracking-wide | semibold |

- Body floor ~14px in-app; never render reading text below 12.5px.
- Numbers that update: `tabular-nums`.

## 5. Spacing, radii, hit targets

- **8px grid** (4px subdivisions). Padding steps: 8/12/16/24/32.
- **Concentric radii** (Apple "harmony"): inner radius = outer radius −
  padding. Card `rounded-2xl` (16) with `p-2` → inner tiles `rounded-xl`
  (12). Panels 24 (`rounded-[24px]`), cards 16–20, tiles/inputs 12, chips
  full.
- **Hit targets ≥ 40px** (Apple: 44pt); icon buttons get padding, not tiny
  boxes.

## 6. Depth recipe (borders + shadows)

- Boundaries = **hairline border + soft layered shadow**, never heavy
  single shadows. Light theme shadows are *much* lighter than dark
  (`rgba(0,0,0,0.14–0.22)` vs `0.6–0.8`).
- Hairlines: `border-black/[0.05–0.08] dark:border-white/[0.06–0.10]`.
- Hover lift: −1px translateY + slightly deeper shadow
  (`.boult-glass-hover`), 200–300ms `cubic-bezier(0.22,1,0.36,1)`.

## 7. Motion

- Springs or `[0.16,1,0.3,1]` ease-out; 180–350ms. Motion communicates
  hierarchy changes (expand, arrive, complete) — never loops decoratively.
- Respect `prefers-reduced-motion` (the glass utilities already do).
- Loading = skeletons that mirror the layout, not bare spinners.

## 8. The recurring bug classes (hunt these on every surface)

1. **Dark-only styling** — `bg-[#…]`/`text-white/*` with no `dark:` pair →
   broken on light. Sweep: grep counts of `bg-\[#`/`text-white/` vs `dark:`
   per file; false positives = the `isDark` JS pattern and dead components.
2. **Computed state dropped before the pixels** — rich labels/params/statuses
   tracked in state but never rendered (LiveStepTracker verbs, orchestration
   plan). Check the render path before adding intelligence.
3. **AI-only surfaces that vanish** — anything that renders nothing when the
   LLM returns empty needs a deterministic fallback from real data.

## 9. Verification bar

`npx tsc --noEmit` **and** `npm run build` green, plus: zero un-paired
`-white` tokens in touched files (grep, don't eyeball), and a live look at
both themes for any surface that changed class.
