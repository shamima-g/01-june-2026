'use client';

/**
 * `useMediaQuery` — a small SSR-safe client hook that reports whether a CSS
 * media query currently matches (Epic 4, Story 3 — NFR3).
 *
 * Why a JS hook (not a CSS-only Tailwind `md:` hide/show): the responsive
 * table-to-card collapse must render EITHER the desktop `<table>` OR the mobile
 * card list — never both in the DOM at once — so that:
 *   - jsdom (which performs no layout and can't observe a `display:none` coming
 *     from a media query) can exercise the card layout in the Vitest suite, and
 *   - at mobile width no wide desktop table exists to force a horizontal scroll
 *     (NFR3's "desktop tables are not horizontally scrolled on mobile").
 *
 * SSR safety: `window`/`matchMedia` don't exist on the server, so the lazy state
 * initializer returns `false` (the desktop layout — the safe, content-complete
 * default) on the server and the FIRST client render. On the client the same
 * initializer reads the real `matchMedia(query).matches` so the first paint
 * already reflects the viewport; the effect then ONLY subscribes to subsequent
 * `change` events and tears the listener down on unmount / query change. No
 * synchronous `setState` runs inside the effect body — initial state comes from
 * the lazy initializer and updates come from the `change` callback — which keeps
 * the hook free of the `react-hooks/set-state-in-effect` lint rule.
 *
 * The subscription uses the modern `addEventListener('change', …)`, so a
 * viewport resize across the breakpoint re-renders the consumer.
 */

import { useEffect, useState } from 'react';

/** True only when `window.matchMedia` is usable (client + supported). */
function canMatchMedia(): boolean {
  return (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  );
}

export function useMediaQuery(query: string): boolean {
  // Lazy initializer: `false` on the server / first SSR render, and the real
  // match on the client. Reading the match here (instead of synchronously in the
  // effect) is what keeps the effect free of `set-state-in-effect`.
  const [matches, setMatches] = useState<boolean>(() =>
    canMatchMedia() ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    if (!canMatchMedia()) return;

    const mediaQueryList = window.matchMedia(query);

    // Subscribe to subsequent changes only. If the query changed since the last
    // render, the `change` listener will carry the next match; the functional
    // updater below resolves the current value without a synchronous setState in
    // the effect body, so a viewport already matching at mount is reflected by
    // the lazy initializer rather than a setState here.
    const handleChange = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };

    mediaQueryList.addEventListener('change', handleChange);
    return () => {
      mediaQueryList.removeEventListener('change', handleChange);
    };
  }, [query]);

  return matches;
}

/** The shared mobile breakpoint (below 768px → card layout) — NFR3. */
export const MOBILE_QUERY = '(max-width: 767px)';
