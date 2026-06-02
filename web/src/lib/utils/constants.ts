/**
 * Application Constants Template
 *
 * Define your application-specific constants here
 * Examples include API configuration, UI settings, and business logic constants
 */

/**
 * Browser-side API base URL.
 *
 * Empty by design: the browser API client issues every request to a
 * SAME-ORIGIN `/api/*` path (see web/src/app/api/[...proxy]/route.ts). The
 * real backend origins are server-side only — `AUTH_API_BASE_URL` (auth
 * :10010) and `API_BASE_URL` (transactions :10005/transactions-api) are
 * consumed by the proxy route handler, never by browser fetch URLs. These vars
 * deliberately omit the `NEXT_PUBLIC_` prefix so Next.js does NOT inline them
 * into the browser bundle (which would leak the backend origins client-side).
 * The session cookie is `SameSite=Strict`, so any cross-origin browser fetch
 * would be rejected — keeping the client same-origin is mandatory (NFR7).
 *
 * Endpoint functions therefore pass full same-origin paths to the client,
 * e.g. `get('/api/transactions/v1/transactions')`.
 */
export const API_BASE_URL = '';

/**
 * Default pagination settings
 * Customize based on your application's needs
 */
export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 25,
  PAGE_SIZE_OPTIONS: [10, 25, 50, 100],
} as const;

/**
 * Toast notification settings
 */
export const TOAST_SETTINGS = {
  DEFAULT_DURATION: 5000, // 5 seconds
  SUCCESS_DURATION: 3000, // 3 seconds
  ERROR_DURATION: 7000, // 7 seconds
  MAX_TOASTS: 3,
} as const;

/**
 * Modal settings
 */
export const MODAL_SETTINGS = {
  ANIMATION_DURATION: 150, // 150ms for enter/exit animations
} as const;

// Add your application-specific constants below
// Example:
// export const DATE_FORMATS = {
//   DISPLAY: 'dd MMM yyyy',
//   API: 'yyyy-MM-dd',
// } as const;
