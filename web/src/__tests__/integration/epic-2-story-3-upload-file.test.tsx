/**
 * Story Metadata:
 * - Epic 2, Story 3: Upload a transaction file
 * - Route: /files/upload
 * - Target File: web/src/app/files/upload/page.tsx
 * - Page Action: create_new
 *
 * Requirements: R2 (Importer uploads via drag-and-drop or file picker; the upload
 * carries FileSettingId / FileSettingName / FileName; the UI surfaces progress and
 * explicit success/failure feedback), BR11 (the Upload screen is Importer-only; an
 * Approver hitting the route sees an in-page permission-denied banner). NFR5
 * (every async op has a user-visible error state with a retry affordance).
 *
 * Failing-first (TDD red) tests for the VITEST-tagged acceptance criteria — each
 * behaviour lives in the React render and is jsdom-observable (testing-policy
 * §"Test at the layer where the behaviour lives"):
 *   - AC-4: Confirm is unavailable until BOTH a file and a File Setting are chosen
 *           — disabled with neither, with only a file, and with only a setting;
 *           enabled once both are present.
 *   - AC-3: an upload failure shows a user-visible error state with a retry
 *           affordance AND does NOT navigate away (the user stays on /files/upload
 *           so they can retry against the same selection).
 *
 * AC-1 (select file via drag-and-drop or picker + pick a setting before confirm),
 * AC-2 (progress → explicit success → path to the File Logs list) and AC-5 (an
 * Approver navigating directly sees the permission-denied banner, not the form)
 * are PLAYWRIGHT-tagged and covered by the sibling spec — they cross the browser
 * round-trip and the real role resolution, so they are not re-driven here.
 *
 * How the page works (story summary + project-brief §9 File Upload):
 *   - On mount it loads the File Setting options from
 *     `GET /api/transactions/v1/file-settings` (operation FileSettingGetList,
 *     plural `{ FileSettings: [...] }` envelope, which the API client unwraps to a
 *     bare array before the page sees it).
 *   - The Importer picks a file (drag-and-drop dropzone OR the file-picker
 *     `<input type="file">` fallback) and a File Setting, then confirms.
 *   - On confirm the page POSTs the file binary to
 *     `POST /api/transactions/v1/files/upload?FileSettingId=…&FileSettingName=…&FileName=…`
 *     as `application/octet-stream` via the shared API client (CLAUDE.md §3 — never
 *     raw fetch). On success it links to the File Logs list; on failure it shows an
 *     error with retry and stays put.
 *
 * Mocking (testing-policy §Mocking strategy): only the HTTP client
 * (@/lib/api/client) and the Next.js navigation boundary are mocked. The page, the
 * dropzone, the selector, and the confirm-gating logic are the REAL code under
 * test. Because the binary upload may ride the client through `post` OR the lower
 * `apiClient` (the octet-stream body bypasses the JSON `post` helper), ALL three
 * client exports are mocked: `get` resolves the setting list; `post` and
 * `apiClient` are the upload sink a test can reject. The page is wrapped in the
 * existing RequireSession guard (reads the client-side session marker via
 * useSyncExternalStore), so each test seeds the marker through the real
 * session-client helper rather than mocking the guard.
 *
 * Role-gating note: the Importer-only / permission-denied behaviour (BR11) is the
 * PLAYWRIGHT-tagged AC-5 — it depends on the live role resolution and the
 * Approver's view. To exercise the vitest-tagged form behaviour we resolve the
 * role as an Importer (the persona that SEES the form) via the real
 * `fetchCurrentRole`, which reads the role from the swappable source — so we stub
 * that source's GET (`/users` / `/userinfo`) to return an Importer record.
 *
 * Shape source: documentation/transactions-api.yaml
 * (FileSettingRead/FileSettingReadList, files/upload operation) + project-brief
 * §6/§9/§13. No api-shape-report.md exists for this build. The unwrapped array the
 * mocked get() resolves models exactly what the page sees after the client strips
 * the single-key envelope.
 *
 * The axe matcher is registered globally by web/vitest.setup.ts, so only `axe`
 * is imported here.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Production import — the route does NOT exist yet (create_new), so this import
// fails to resolve and every test errors in the TDD red phase.
import UploadPage from '@/app/files/upload/page';
import { get, post, apiClient } from '@/lib/api/client';
import { markSessionStart, clearSession } from '@/lib/session/session-client';
import {
  createMockFileSettingList,
  type MockFileSetting,
} from '../helpers/epic-2-mock-data';

// HTTP client — mocked per testing-policy. `get` feeds the setting list AND the
// Importer role source; `post` / `apiClient` are the upload sink (the page may use
// either for the octet-stream body).
vi.mock('@/lib/api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  apiClient: vi.fn(),
}));
const mockGet = get as ReturnType<typeof vi.fn>;
const mockPost = post as ReturnType<typeof vi.fn>;
const mockApiClient = apiClient as ReturnType<typeof vi.fn>;

// Navigation boundary — RequireSession touches the router; AC-3 asserts the page
// does NOT navigate on a failed upload, so we capture push/replace.
const pushMock = vi.fn();
const replaceMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, refresh: vi.fn() }),
  usePathname: () => '/files/upload',
  useSearchParams: () => new URLSearchParams(),
}));

/** The File Setting the tests pick. */
const SETTINGS: MockFileSetting[] = createMockFileSettingList();
const CHOSEN = SETTINGS[0]; // { Id: 12, Name: 'Daily Bank Import' }

/**
 * Routes a mocked `get(endpoint)` call by URL path:
 *   - file-settings path → the unwrapped FileSetting list (what the page sees)
 *   - users / userinfo path (the role source behind fetchCurrentRole) → an
 *     Importer record so the form (not the permission-denied banner) renders.
 * Either side may be overridden per test.
 */
function wireGet(settings: MockFileSetting[] | Error = SETTINGS): void {
  mockGet.mockImplementation((endpoint: string) => {
    if (endpoint.includes('/file-settings')) {
      return settings instanceof Error
        ? Promise.reject(settings)
        : Promise.resolve(settings);
    }
    // Role source consumed by fetchCurrentRole (userinfo best-effort, then
    // /users fallback). Resolve an Importer so the upload form is shown.
    if (endpoint.includes('/userinfo')) {
      return Promise.resolve({
        RolesString: 'Importer',
        Email: 'imp@acme.test',
      });
    }
    if (endpoint.includes('/users')) {
      return Promise.resolve([
        { RolesString: 'Importer', Email: 'imp@acme.test' },
      ]);
    }
    return Promise.reject(new Error(`Unexpected endpoint: ${endpoint}`));
  });
}

/** A small in-memory CSV file the picker accepts. */
function makeCsvFile(name = 'transactions_2026-04-15.csv'): File {
  return new File(['Reference,Amount\nTXN-1,100'], name, { type: 'text/csv' });
}

/**
 * Renders the upload page with an authenticated client-side session so
 * RequireSession yields its protected content, then waits for the setting list
 * (and role) to settle — proxied by the File Setting selector becoming available.
 */
async function renderUpload() {
  markSessionStart();
  const utils = render(<UploadPage />);
  // The setting selector is the gate for an enabled Confirm, so wait for it.
  await screen.findByLabelText(/file setting/i);
  return utils;
}

/**
 * Picks the given file through the file-picker `<input type="file">` fallback,
 * which is always present even when the visual surface is a drag-and-drop zone.
 */
async function pickFile(user: ReturnType<typeof userEvent.setup>, file: File) {
  // The hidden/visible file input is the accessible picker fallback. Query by the
  // file-input role-equivalent: a labelled input of type file.
  const input = screen.getByLabelText(/choose|select|upload|browse|file/i, {
    selector: 'input[type="file"]',
  });
  await user.upload(input, file);
}

/** Picks the chosen File Setting in the selector by its visible Name. */
async function pickSetting(user: ReturnType<typeof userEvent.setup>) {
  const select = screen.getByLabelText(/file setting/i);
  await user.selectOptions(select, String(CHOSEN.Id));
}

function confirmButton(): HTMLButtonElement {
  return screen.getByRole('button', {
    name: /(confirm|upload|start upload)/i,
  }) as HTMLButtonElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  wireGet();
});

afterEach(() => {
  clearSession();
});

describe('Epic 2, Story 3 — Upload: Confirm gated until file + setting chosen (AC-4)', () => {
  // AC-4: with NEITHER a file nor a setting selected, Confirm must be unavailable.
  // This is the initial state immediately after the form loads.
  it('disables Confirm when neither a file nor a File Setting is chosen', async () => {
    await renderUpload();
    expect(confirmButton()).toBeDisabled();
  });

  // AC-4: a file alone is not enough — without a File Setting the upload has no
  // FileSettingId/FileSettingName to send (R2), so Confirm stays disabled.
  it('keeps Confirm disabled when only a file is chosen', async () => {
    const user = userEvent.setup();
    await renderUpload();

    await pickFile(user, makeCsvFile());

    expect(confirmButton()).toBeDisabled();
  });

  // AC-4: a setting alone is not enough either — there is no file binary to POST,
  // so Confirm stays disabled.
  it('keeps Confirm disabled when only a File Setting is chosen', async () => {
    const user = userEvent.setup();
    await renderUpload();

    await pickSetting(user);

    expect(confirmButton()).toBeDisabled();
  });

  // AC-4: once BOTH a file and a File Setting are present, Confirm becomes
  // available. Pins the enable boundary so the disabled state above isn't a
  // permanent fixture (anti-pattern §4 — assert the contrast).
  it('enables Confirm once both a file and a File Setting are chosen', async () => {
    const user = userEvent.setup();
    await renderUpload();

    await pickFile(user, makeCsvFile());
    await pickSetting(user);

    await waitFor(() => expect(confirmButton()).toBeEnabled());
  });
});

describe('Epic 2, Story 3 — Upload: failure shows error + retry, no navigation (AC-3, NFR5)', () => {
  // AC-3 / NFR5: when the upload POST rejects, the page surfaces a user-visible
  // error state (role="alert") with a retry affordance — never a blank/broken
  // page — and does NOT navigate away, so the user can retry against the same
  // file + setting selection.
  it('shows an error with a retry affordance and does not navigate when the upload fails', async () => {
    const user = userEvent.setup();
    // The page may send the octet-stream body via post() or the lower apiClient();
    // reject both so whichever it uses fails.
    mockPost.mockRejectedValue(new Error('Upload failed'));
    mockApiClient.mockRejectedValue(new Error('Upload failed'));

    await renderUpload();

    await pickFile(user, makeCsvFile());
    await pickSetting(user);
    await user.click(confirmButton());

    // A user-visible error state with a retry control appears ...
    const alert = await screen.findByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /(retry|try again)/i }),
    ).toBeInTheDocument();

    // ... and the user stays on the upload screen (no navigation away).
    expect(pushMock).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  // AC-3 / NFR5: the retry affordance is wired, not decorative — clicking it
  // re-attempts the upload. We don't assert the post-success navigation here
  // (that's the PLAYWRIGHT-tagged AC-2 success path); we only prove a second
  // upload attempt is made, so the retry control truly re-drives the request.
  it('re-attempts the upload when the user clicks retry', async () => {
    const user = userEvent.setup();
    mockPost.mockRejectedValue(new Error('Upload failed'));
    mockApiClient.mockRejectedValue(new Error('Upload failed'));

    await renderUpload();

    await pickFile(user, makeCsvFile());
    await pickSetting(user);
    await user.click(confirmButton());

    const retry = await screen.findByRole('button', {
      name: /(retry|try again)/i,
    });

    const attemptsBefore =
      mockPost.mock.calls.length + mockApiClient.mock.calls.length;
    await user.click(retry);

    await waitFor(() => {
      const attemptsAfter =
        mockPost.mock.calls.length + mockApiClient.mock.calls.length;
      expect(attemptsAfter).toBeGreaterThan(attemptsBefore);
    });
  });
});

describe('Epic 2, Story 3 — Upload: accessibility (AC-4 baseline)', () => {
  // The loaded upload form (dropzone + picker fallback + setting selector +
  // Confirm) has no axe violations. We assert the setting selector is present
  // first so this breaks on a missing/placeholder page rather than vacuously
  // passing on an empty DOM (anti-pattern §4).
  it('has no accessibility violations when the upload form is loaded', async () => {
    const { container } = await renderUpload();

    expect(screen.getByLabelText(/file setting/i)).toBeInTheDocument();
    expect(confirmButton()).toBeInTheDocument();

    expect(await axe(container)).toHaveNoViolations();
  });
});
