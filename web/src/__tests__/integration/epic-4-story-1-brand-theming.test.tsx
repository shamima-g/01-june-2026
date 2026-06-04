/**
 * Story Metadata:
 * - Epic 4, Story 1: Brand theming pass — apply the financial-services palette
 *   across all screens.
 * - Route: null (infrastructure-only; design-token layer change). The sibling
 *   Playwright call emits a non-routable test.fixme() spec — this file is the
 *   only automated coverage for the story.
 * - Target File: web/src/app/globals.css
 * - Page Action: modify_existing
 *
 * Requirements: NFR1 (WCAG 2.2 AA — colour is never the sole signal; AA contrast
 * is the manual AC-4), R15.
 *
 * Failing-first (TDD red). The story replaces the default Shadcn *neutral*
 * palette in globals.css with the brief §11 brand tokens (primary #1E40AF,
 * secondary #334155, accent #D97706, surface/text/muted) and wires Inter as the
 * heading/body font.
 *
 * ── TEST SEAM ───────────────────────────────────────────────────────────────
 * jsdom does NOT apply real stylesheets, so asserting *computed* colours is
 * impossible here. Two seams are used instead:
 *
 *   1. STYLESHEET-TEXT seam (AC-1, AC-2, AC-3 token half): read the raw
 *      globals.css source and assert the declared custom-property VALUES. The
 *      brief §11 explicitly states "No oklch round-trip applied" — tokens are
 *      raw brand hex — so we assert the brand hex literals are the resolved
 *      value of `--primary`/`--secondary`/`--accent`/etc., and that the
 *      neutral defaults (`oklch(0.205 0 0)` for --primary, the Geist font) are
 *      GONE. This directly verifies the token layer the story changes.
 *
 *   2. RENDER seam (AC-3 colour-not-alone half): render StatusBadge for one
 *      representative of each status group and assert it STILL pairs an icon
 *      with a visible text label after the theming pass — real jsdom-observable
 *      behaviour that guards NFR1's "colour never the sole signal" invariant
 *      through the palette change.
 *
 * AC-4 (AA contrast of foreground/background and primary-on-primary-foreground)
 * is coverage:none / MANUAL — verified by eye on the accessibility checklist, not
 * asserted here, because real contrast needs applied CSS that jsdom lacks.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

// Production import — the component must keep its icon+label contract through the
// theming pass. (Already exists from Epic 1 Story 5; the render seam guards it.)
import { StatusBadge } from '@/components/status-badge/StatusBadge';

/** Resolve and read the design-token stylesheet the story edits. */
const GLOBALS_CSS_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../app/globals.css',
);
const css = readFileSync(GLOBALS_CSS_PATH, 'utf8');

/**
 * Resolve the *declared* value of a `--token` from the :root block. Returns the
 * literal RHS text (e.g. "#1E40AF" or "oklch(0.205 0 0)") with surrounding
 * whitespace trimmed, or null if the token is not declared.
 *
 * Intentionally simple — operates on the raw stylesheet text (the only seam
 * available without applied CSS) rather than computed style.
 */
function tokenValue(name: string): string | null {
  // Match `--name: <value>;` (last declaration wins, mirroring CSS cascade).
  const re = new RegExp(`--${name}\\s*:\\s*([^;]+);`, 'g');
  let match: RegExpExecArray | null;
  let last: string | null = null;
  while ((match = re.exec(css)) !== null) {
    last = match[1].trim();
  }
  return last;
}

/** Case-insensitive hex equality so #1e40af and #1E40AF compare equal. */
function hexEquals(actual: string | null, hex: string): boolean {
  return actual != null && actual.toLowerCase() === hex.toLowerCase();
}

describe('Epic 4, Story 1 — brand palette tokens (AC-1)', () => {
  // AC-1: the primary brand colour replaces the default neutral --primary. The
  // template ships `--primary: oklch(0.205 0 0)` (greyscale); the brief §11
  // primary is the cool blue #1E40AF. RED until the developer swaps the token.
  it('sets --primary to the brief §11 brand blue (not the neutral default)', () => {
    const primary = tokenValue('primary');
    expect(primary).not.toBeNull();
    // The greyscale default must be gone.
    expect(primary).not.toBe('oklch(0.205 0 0)');
    // …and replaced by the brand blue.
    expect(hexEquals(primary, '#1E40AF')).toBe(true);
  });

  // AC-1: the supporting palette — secondary slate, amber accent, light-slate
  // surface, primary text, muted text — all match brief §11. One assertion per
  // token keeps the contrast (brand value vs old neutral) explicit.
  it('sets the supporting palette tokens to the brief §11 brand values', () => {
    // Secondary slate-dark #334155.
    expect(hexEquals(tokenValue('secondary'), '#334155')).toBe(true);
    // Amber accent #D97706.
    expect(hexEquals(tokenValue('accent'), '#D97706')).toBe(true);
    // Muted text #475569 (brief "Text (muted)").
    expect(hexEquals(tokenValue('muted-foreground'), '#475569')).toBe(true);
  });

  // AC-1: the surface / background / primary-text trio (brief §11). Surface is
  // the light-slate card/panel background #F1F5F9; primary text #0F172A on a
  // white background #FFFFFF. The neutral oklch defaults must be gone.
  it('sets background, foreground (text) and a surface token from brief §11', () => {
    // Background stays white #FFFFFF — assert as hex (no oklch round-trip).
    expect(hexEquals(tokenValue('background'), '#FFFFFF')).toBe(true);
    // Primary text #0F172A replaces the neutral oklch(0.145 0 0).
    const foreground = tokenValue('foreground');
    expect(foreground).not.toBe('oklch(0.145 0 0)');
    expect(hexEquals(foreground, '#0F172A')).toBe(true);
    // A light-slate surface token (#F1F5F9) exists for card/panel backgrounds.
    // The story names it `--surface`; assert that semantic token resolves to the
    // brief's surface hex.
    expect(hexEquals(tokenValue('surface'), '#F1F5F9')).toBe(true);
  });
});

describe('Epic 4, Story 1 — Inter font wiring (AC-2)', () => {
  // AC-2: Inter is wired as the heading/body font via the font token. The
  // template ships `--font-sans: var(--font-geist-sans)`. Brief §11 requires
  // Inter for both headings (600) and body (400). RED until the token points at
  // an Inter-backed family.
  it('wires the sans font token to Inter (not the Geist default)', () => {
    // The @theme `--font-sans` indirection must no longer resolve to Geist.
    const fontSans = tokenValue('font-sans');
    expect(fontSans).not.toBeNull();
    expect(fontSans).not.toBe('var(--font-geist-sans)');
    // Inter must be referenced — either directly or via an --font-inter var the
    // story introduces from next/font. Case-insensitive substring keeps the
    // assertion robust to the exact variable name.
    expect(fontSans!.toLowerCase()).toContain('inter');
  });
});

describe('Epic 4, Story 1 — status tokens + colour-not-alone (AC-3)', () => {
  // AC-3 (token half): the status colour trios match the brief §11 palette —
  // Success #15803D, Warning #B45309, Error #B91C1C, Info #0369A1, plus the
  // neutral grey. Asserting the *foreground* hex (the strong label hue) pins the
  // brand value through the theming pass.
  it('keeps the status foreground tokens aligned to the brief §11 status palette', () => {
    expect(hexEquals(tokenValue('status-success-fg'), '#15803D')).toBe(true);
    expect(hexEquals(tokenValue('status-warning-fg'), '#B45309')).toBe(true);
    expect(hexEquals(tokenValue('status-danger-fg'), '#B91C1C')).toBe(true);
    expect(hexEquals(tokenValue('status-info-fg'), '#075985')).toBe(true);
    // Neutral grey trio exists (the Uploaded state).
    expect(tokenValue('status-neutral-fg')).not.toBeNull();
  });

  // AC-3 (colour-not-alone half, NFR1): through the theming pass, every status
  // badge must STILL pair its hue with BOTH an icon and a visible text label —
  // colour is never the sole signal. Render one representative per status group
  // and assert the icon (svg) + label coexist. This is the genuinely
  // jsdom-observable guard; it would catch a regression where the theming pass
  // dropped the icon/label in favour of pure colour.
  it.each([
    ['Imported', 'info'],
    ['Approved', 'success'],
    ['Failed', 'danger'],
    ['Uploaded', 'neutral'],
  ])(
    'renders %s with both an icon and a text label (colour not the sole signal)',
    (status) => {
      render(<StatusBadge status={status} />);
      const label = screen.getByText(status);
      expect(label).toBeInTheDocument();
      const badge = label.closest('[data-status]');
      expect(badge).not.toBeNull();
      // An accompanying icon — svg is the icon primitive in this template.
      expect(badge!.querySelector('svg')).not.toBeNull();
    },
  );
});
