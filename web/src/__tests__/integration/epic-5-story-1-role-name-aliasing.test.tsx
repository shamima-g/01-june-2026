/**
 * Story Metadata:
 * - Epic 5, Story 1: Recognise the live backend's role display-names
 *   ("File Importer" / "Approver")
 * - Route: /login
 * - Target File: web/src/lib/auth/roles.ts
 * - Page Action: modify_existing
 *
 * Failing-first (TDD red) regression tests for the role-name-aliasing bug fix
 * (project-brief "Extension — 2026-06-04").
 *
 * The live backend returns role DISPLAY-NAMES via GET /v1/auth/userinfo and
 * GET /v1/users: "File Importer" for importers, "Approver" for approvers. But
 * web/src/lib/auth/roles.ts recognises only the exact canonical strings
 * "Importer" / "Approver". So an Importer is unrecognised:
 *   - resolveLandingRoute("File Importer") falls back to /transactions instead of
 *     routing to /files (the Importer surface), and
 *   - asKnownRole("File Importer") returns null, hiding every Importer-only
 *     affordance (Upload / Retry Validation / Cancel — BR9/BR10/BR11).
 *
 * The fix introduces a tolerant (case-insensitive, trimmed) display-name →
 * canonical alias ("File Importer" → Importer, "Approver" → Approver) applied
 * across the role-resolution layer. These tests assert the POST-FIX contract and
 * therefore FAIL today (the alias does not exist yet) — the correct TDD-red
 * signal.
 *
 * Requirements: R1 (role-based landing), BR9/BR10/BR11 (RBAC gating of
 * Importer-only and Approver-only controls).
 *
 * This file exercises the REAL pure exports of roles.ts (no HTTP, no React) —
 * the behaviour under repair lives entirely in the resolution layer, so it is
 * tested at that layer (testing-policy §"Test at the layer where the behaviour
 * lives"). The live browser redirect chain is covered by the sibling Playwright
 * spec (AC-4).
 */
import { describe, it, expect } from 'vitest';

// Production imports — the aliasing behaviour asserted below does not exist yet,
// so these assertions WILL FAIL until the developer adds the alias (TDD red).
import {
  resolveLandingRoute,
  asKnownRole,
  LANDING_ROUTES,
  FALLBACK_LANDING_ROUTE,
} from '@/lib/auth/roles';

// The exact display-names the live backend emits (project-brief Extension
// 2026-06-04). These are what the resolver must learn to recognise.
const BACKEND_IMPORTER = 'File Importer';
const BACKEND_APPROVER = 'Approver';

describe('Epic 5 Story 1: backend role display-name aliasing', () => {
  // AC-1 — the live backend's display-names resolve to the canonical roles
  // THROUGH the resolution layer. "File Importer" must behave as the canonical
  // Importer; "Approver" as the canonical Approver. Asserted via the two public
  // entry points callers actually use (routing + RBAC narrowing).
  describe('AC-1: backend display-names resolve to canonical roles', () => {
    it('treats the backend "File Importer" display-name as the canonical Importer', () => {
      expect(resolveLandingRoute(BACKEND_IMPORTER)).toBe(
        LANDING_ROUTES.Importer,
      );
      expect(asKnownRole(BACKEND_IMPORTER)).toBe('Importer');
    });

    it('treats the backend "Approver" display-name as the canonical Approver', () => {
      expect(resolveLandingRoute(BACKEND_APPROVER)).toBe(
        LANDING_ROUTES.Approver,
      );
      expect(asKnownRole(BACKEND_APPROVER)).toBe('Approver');
    });

    it('is tolerant of case and surrounding whitespace in backend names', () => {
      // The alias must normalise (case-insensitive + trimmed), since the backend
      // payload is not guaranteed to be exactly cased/untrimmed.
      for (const variant of [
        ' file importer ',
        'FILE IMPORTER',
        'File Importer',
      ]) {
        expect(asKnownRole(variant)).toBe('Importer');
        expect(resolveLandingRoute(variant)).toBe(LANDING_ROUTES.Importer);
      }
      for (const variant of ['approver', 'Approver ', 'APPROVER']) {
        expect(asKnownRole(variant)).toBe('Approver');
        expect(resolveLandingRoute(variant)).toBe(LANDING_ROUTES.Approver);
      }
    });

    it('still recognises the original canonical strings (does not break canonical)', () => {
      // Adding the alias must not regress the exact-match path: the canonical
      // "Importer"/"Approver" inputs already used across the suite keep working.
      expect(asKnownRole('Importer')).toBe('Importer');
      expect(asKnownRole('Approver')).toBe('Approver');
      expect(resolveLandingRoute('Importer')).toBe(LANDING_ROUTES.Importer);
      expect(resolveLandingRoute('Approver')).toBe(LANDING_ROUTES.Approver);
    });
  });

  // AC-2 — resolveLandingRoute maps the backend display-names to the correct
  // landing surfaces (Importer → /files, Approver → /transactions), and an
  // unrecognised name still falls back SAFELY to FALLBACK_LANDING_ROUTE without
  // throwing. This is the R1 role-based-landing fix: today "File Importer" wrongly
  // lands on /transactions (the fallback) because it is unrecognised.
  describe('AC-2: resolveLandingRoute routes backend names + safe unknown fallback', () => {
    it('routes a "File Importer" to /files and an "Approver" to /transactions', () => {
      expect(resolveLandingRoute(BACKEND_IMPORTER)).toBe('/files');
      expect(resolveLandingRoute(BACKEND_APPROVER)).toBe('/transactions');

      // Contrast: the two personas land on distinct surfaces. If the alias were
      // missing, the Importer would collapse onto the Approver's surface.
      expect(resolveLandingRoute(BACKEND_IMPORTER)).not.toBe(
        resolveLandingRoute(BACKEND_APPROVER),
      );
    });

    it('falls back safely for an unrecognised role name without throwing', () => {
      let fallback: string | undefined;
      expect(() => {
        fallback = resolveLandingRoute('Nope');
      }).not.toThrow();
      expect(fallback).toBe(FALLBACK_LANDING_ROUTE);

      // Missing / empty inputs are equally safe.
      expect(resolveLandingRoute(null)).toBe(FALLBACK_LANDING_ROUTE);
      expect(resolveLandingRoute(undefined)).toBe(FALLBACK_LANDING_ROUTE);
      expect(resolveLandingRoute('')).toBe(FALLBACK_LANDING_ROUTE);
    });
  });

  // AC-3 — asKnownRole is the RBAC narrowing primitive that gates Importer-only
  // controls (Upload / Retry / Cancel — BR9/BR10) and Approver-only controls
  // (approve / reject / export — BR11). It must narrow the backend display-names
  // to the canonical KnownRole, and return null (not a bogus role) for unknown
  // input so callers HIDE affordances rather than expose them.
  describe('AC-3: asKnownRole narrows backend names for RBAC gating', () => {
    it('narrows "File Importer" → Importer and "Approver" → Approver', () => {
      expect(asKnownRole(BACKEND_IMPORTER)).toBe('Importer');
      expect(asKnownRole(BACKEND_APPROVER)).toBe('Approver');
    });

    it('returns null for an unrecognised role (so Importer-only/Approver-only controls stay hidden)', () => {
      expect(asKnownRole('Nope')).toBeNull();
      expect(asKnownRole(null)).toBeNull();
      expect(asKnownRole(undefined)).toBeNull();
      expect(asKnownRole('')).toBeNull();
    });
  });
});
