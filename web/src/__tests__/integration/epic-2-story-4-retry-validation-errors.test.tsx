/**
 * Story Metadata:
 * - Epic 2, Story 4: Retry validation and review validation errors on a failed file
 * - Route: /files/[id]
 * - Target File: web/src/app/files/[id]/page.tsx (modify_existing)
 * - Page Action: modify_existing (extends the Story 2 file-detail surface)
 *
 * Requirements: R11 (an Importer may retry validation on a Failed File Log; the
 * system re-attempts processing and updates File Status; on continued failure the
 * validation-error rows are refreshed), R13 (surface validation errors on a Failed
 * file as a list of invalid rows with backend column metadata), BR5 (a Failed file
 * surfaces the validation-errors view + the Importer-only retry control; the
 * Approver sees the list read-only). NFR5 (every async op has a user-visible error
 * state with a retry affordance).
 *
 * Failing-first (TDD red) tests for the VITEST-tagged acceptance criteria — each
 * behaviour lives in the React render and is jsdom-observable (testing-policy
 * §"Test at the layer where the behaviour lives"):
 *   - AC-3: clicking Retry Validation re-runs processing; on SUCCESS the File
 *           Status updates to a non-failed state, and on CONTINUED FAILURE the
 *           invalid-row list refreshes (the refreshed rows replace the prior set).
 *   - AC-4: a failure to LOAD the validation errors shows a user-visible error
 *           state with a retry affordance (and the affordance is wired — a
 *           successful retry replaces the error with the error-row grid).
 *
 * AC-1 (the invalid-row list rendered with the backend's column headings across
 * the browser round-trip) and AC-2 (Importer sees the Retry control / Approver
 * sees the list with NO Retry control — the persona difference) are
 * PLAYWRIGHT-tagged and covered by the sibling spec; they cross the real role
 * resolution and the persona views, so they are not re-driven here.
 *
 * How the Failed-file detail resolves its data (story summary + project-brief
 * §9 Retry Validation / §6 envelopes / §13-C):
 *   - The FileLog is resolved from the active file-logs list exactly as Story 2
 *     (`GET /api/transactions/v1/file-logs?IsActive=Yes`, singular
 *     `{ FileLog: [...] }` envelope the client unwraps to a bare array, matched by
 *     Id). A Failed derived status is what gates the validation-errors view + the
 *     retry control (BR5).
 *   - The invalid rows come from `GET /v1/files/validation-errors?FileLogId=` as a
 *     `{ ValidationErrors: { JsonArray: "<stringified[]>" } }` object. The client's
 *     single-key unwrap ONLY strips a key whose value is an ARRAY — here the value
 *     is an OBJECT — so this envelope PASSES THROUGH untouched and the page must
 *     reach into `.ValidationErrors.JsonArray` and `JSON.parse` that STRING (R13).
 *   - The column headings come from
 *     `GET /v1/files/validation-errors/columns?FileLogId=` as a
 *     `{ ColumnList: [...] }` envelope whose value IS an array, so the client
 *     unwraps it to a bare `ColumnDefinition[]` before the page sees it.
 *   - Retry POSTs `POST /v1/files/retry-validation?LogId=` → a DefaultResponse
 *     `{ Id, MessageType, Messages }` (multi-key, so unwrap leaves it untouched).
 *
 * The page therefore makes SEVERAL distinct client calls. We mock by URL path so
 * each read resolves independently, letting a test keep the FileLog + columns
 * healthy while failing only the validation-errors read (AC-4), or drive a retry
 * that flips the FileLog from Failed to Completed (AC-3 success path).
 *
 * Mocking (testing-policy §Mocking strategy): only the HTTP client
 * (@/lib/api/client) and the Next.js navigation boundary are mocked. The page,
 * `deriveFileStatus`, the shared StatusBadge, the JsonArray unwrap/parse, the
 * role-gating and the retry logic are the REAL code under test. The page is
 * wrapped in the existing RequireSession guard (reads the session marker via
 * useSyncExternalStore), so each test seeds the marker through the real
 * session-client helper rather than mocking the guard.
 *
 * Role-gating note: the persona DIFFERENCE for the retry control (Importer sees
 * it / Approver does not) is the PLAYWRIGHT-tagged AC-2 — it depends on the live
 * role resolution and the Approver's view. To exercise the vitest-tagged retry
 * behaviour we resolve the role as an Importer (the persona that SEES the
 * control) via the real `fetchCurrentRole`, which reads the role from the
 * swappable source — so we stub that source's GET (`/userinfo` then `/users`) to
 * return an Importer record.
 *
 * Shape source: documentation/transactions-api.yaml (ValidationErrors, ColumnList,
 * ColumnDefinition, DefaultResponse) + project-brief §6/§9/§13. No
 * api-shape-report.md exists for this build. Fixtures model exactly what the page
 * sees AFTER the client's single-key unwrap (bare arrays for the array-valued
 * envelopes; the intact `{ ValidationErrors: { JsonArray } }` object otherwise).
 *
 * The axe matcher is registered globally by web/vitest.setup.ts, so only `axe`
 * is imported here.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Production import — the Story 2 page renders NEITHER the validation-error grid,
// NOR a retry control, NOR a validation-errors error state, so every assertion
// below fails meaningfully against the current page (TDD red).
import FileDetailPage from '@/app/files/[id]/page';
import { get, post } from '@/lib/api/client';
import { markSessionStart, clearSession } from '@/lib/session/session-client';
import {
  createMockFileLog,
  createMockValidationColumns,
  createMockInvalidRows,
  createValidationErrorsResponse,
  createMockRetryResponse,
  type MockFileLog,
  type MockValidationColumn,
  type MockInvalidRow,
} from '../helpers/epic-2-mock-data';

// HTTP client — mocked per testing-policy. `get` feeds the file-logs read, the
// validation-errors + columns reads, the transactions read, AND the Importer role
// source behind fetchCurrentRole. `post` is the retry-validation sink.
vi.mock('@/lib/api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
}));
const mockGet = get as ReturnType<typeof vi.fn>;
const mockPost = post as ReturnType<typeof vi.fn>;

// Navigation boundary — RequireSession touches the router; the detail page may
// also read params/pathname. We don't assert navigation here, so stub the surface
// so the protected content renders.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/files/5001',
  useSearchParams: () => new URLSearchParams(),
}));

/** The Failed file id under view across these tests. */
const FILE_ID = 5001;

/** A Failed FileLog — the status that gates the validation-errors view (BR5). */
function failedFileLog(): MockFileLog {
  return createMockFileLog({
    Id: FILE_ID,
    CurrentFileName: 'broken_2026-04-15.csv',
    CurrentStatus: 'Failed',
    LastExecutedActivityName: 'Validation Failed',
    HasBulkErrorFile: 'Yes',
    BulkErrorFile: 'broken_errors.csv',
  });
}

/**
 * A path-routed `get()` mock. Each side is supplied as a value (resolve) or an
 * Error (reject) so a test can fail exactly one read while keeping the rest
 * healthy. The `/validation-errors/columns` branch MUST be tested before the
 * `/validation-errors` branch (the latter is a substring of the former).
 *
 * `validationErrors` is the un-unwrapped `{ ValidationErrors: { JsonArray } }`
 * object (or an Error); `columns` is the UNWRAPPED bare column array (or an
 * Error); `fileLogs` is the UNWRAPPED bare FileLog array.
 */
function wireGet({
  fileLogs,
  columns,
  validationErrors,
}: {
  fileLogs: MockFileLog[] | Error;
  columns: MockValidationColumn[] | Error;
  validationErrors: ReturnType<typeof createValidationErrorsResponse> | Error;
}) {
  mockGet.mockImplementation((endpoint: string) => {
    // Importer role source consumed by fetchCurrentRole (userinfo best-effort,
    // then /users fallback) — resolve an Importer so the retry control is shown.
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
    if (endpoint.includes('/validation-errors/columns')) {
      return columns instanceof Error
        ? Promise.reject(columns)
        : Promise.resolve(columns);
    }
    if (endpoint.includes('/validation-errors')) {
      return validationErrors instanceof Error
        ? Promise.reject(validationErrors)
        : Promise.resolve(validationErrors);
    }
    if (endpoint.includes('/file-logs')) {
      return fileLogs instanceof Error
        ? Promise.reject(fileLogs)
        : Promise.resolve(fileLogs);
    }
    if (endpoint.includes('/transactions')) {
      // A Failed file has no terminal transaction slice to show; resolve empty so
      // the Story 2 transactions read settles without affecting these tests.
      return Promise.resolve([]);
    }
    return Promise.reject(new Error(`Unexpected endpoint: ${endpoint}`));
  });
}

/**
 * Renders the file-detail page for `id` with an authenticated client-side session
 * so RequireSession yields its protected content, then waits for the initial
 * reads to settle (loading indicator gone).
 */
async function renderFileDetail(id: number = FILE_ID) {
  markSessionStart();
  const utils = render(
    <FileDetailPage params={Promise.resolve({ id: String(id) })} />,
  );
  await waitFor(() =>
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument(),
  );
  return utils;
}

/** The Importer-only retry-validation control. */
function retryValidationButton(): HTMLElement {
  return screen.getByRole('button', { name: /retry validation/i });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  clearSession();
});

describe('Epic 2, Story 4 — Retry Validation re-runs processing (AC-3, R11)', () => {
  // AC-3 (success path): clicking Retry Validation POSTs retry-validation; on
  // success the system re-attempts processing and the File Status updates to a
  // NON-failed state. We model the live behaviour: the retry POST succeeds, and a
  // subsequent file-logs re-read returns the file now derived as Completed — so
  // the page must re-resolve the FileLog and the visible status flips from Failed
  // to Completed (the StatusBadge renders the status text label).
  it('updates the File Status to a non-failed state when retry succeeds', async () => {
    const user = userEvent.setup();

    // file-logs returns Failed on the first read, Completed after the retry.
    let fileLogReads = 0;
    const completed = createMockFileLog({
      Id: FILE_ID,
      CurrentFileName: 'broken_2026-04-15.csv',
      CurrentStatus: 'Completed',
      LastExecutedActivityName: 'Completed',
    });
    mockGet.mockImplementation((endpoint: string) => {
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
      if (endpoint.includes('/validation-errors/columns')) {
        return Promise.resolve(createMockValidationColumns());
      }
      if (endpoint.includes('/validation-errors')) {
        return Promise.resolve(createValidationErrorsResponse());
      }
      if (endpoint.includes('/file-logs')) {
        fileLogReads += 1;
        return Promise.resolve([
          fileLogReads === 1 ? failedFileLog() : completed,
        ]);
      }
      if (endpoint.includes('/transactions')) {
        return Promise.resolve([]);
      }
      return Promise.reject(new Error(`Unexpected endpoint: ${endpoint}`));
    });
    mockPost.mockResolvedValue(
      createMockRetryResponse({ MessageType: 'SUCCESS' }),
    );

    await renderFileDetail();

    // The file starts Failed (the gate for the retry control) ...
    expect(await screen.findByText('Failed')).toBeInTheDocument();
    await user.click(retryValidationButton());

    // ... the retry POSTs the retry-validation endpoint with this file's LogId ...
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalled();
      const [endpoint] = mockPost.mock.calls[0];
      expect(String(endpoint)).toContain('/files/retry-validation');
      expect(String(endpoint)).toContain(String(FILE_ID));
    });

    // ... and the visible File Status flips to a non-failed (Completed) state.
    await waitFor(() => {
      expect(screen.getByText('Completed')).toBeInTheDocument();
    });
    expect(screen.queryByText('Failed')).not.toBeInTheDocument();
  });

  // AC-3 (continued-failure path): when re-validation fails again, the invalid-row
  // list is REFRESHED with the updated set (R11). We seed two distinct error-row
  // sets — the initial rows, then a smaller refreshed set after the retry — and
  // prove the page replaces the old rows with the refreshed rows (the dropped row
  // disappears, the surviving row remains). This pins a genuine refresh rather than
  // a stale render.
  it('refreshes the invalid-row list when re-validation fails again', async () => {
    const user = userEvent.setup();

    const initialRows: MockInvalidRow[] = createMockInvalidRows(2); // BADTXN-001, -002
    const refreshedRows: MockInvalidRow[] = [
      { Reference: 'BADTXN-002', Amount: '', Error: 'Amount is required' },
    ];

    let veReads = 0;
    mockGet.mockImplementation((endpoint: string) => {
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
      if (endpoint.includes('/validation-errors/columns')) {
        return Promise.resolve(createMockValidationColumns());
      }
      if (endpoint.includes('/validation-errors')) {
        veReads += 1;
        return Promise.resolve(
          createValidationErrorsResponse(
            veReads === 1 ? initialRows : refreshedRows,
          ),
        );
      }
      if (endpoint.includes('/file-logs')) {
        // Still Failed after the retry — continued-failure path.
        return Promise.resolve([failedFileLog()]);
      }
      if (endpoint.includes('/transactions')) {
        return Promise.resolve([]);
      }
      return Promise.reject(new Error(`Unexpected endpoint: ${endpoint}`));
    });
    mockPost.mockResolvedValue(
      createMockRetryResponse({ MessageType: 'ERROR' }),
    );

    await renderFileDetail();

    // Both initial invalid rows are listed ...
    expect(await screen.findByText('BADTXN-001')).toBeInTheDocument();
    expect(screen.getByText('BADTXN-002')).toBeInTheDocument();

    await user.click(retryValidationButton());

    // ... after the failed retry the list refreshes: the resolved row is gone and
    // the still-failing row remains.
    await waitFor(() => {
      expect(screen.queryByText('BADTXN-001')).not.toBeInTheDocument();
    });
    expect(screen.getByText('BADTXN-002')).toBeInTheDocument();
    // The file is still Failed (continued failure), so the retry control persists.
    expect(retryValidationButton()).toBeInTheDocument();
  });

  // AC-3 (R13 supporting): the invalid-row grid renders the BACKEND-supplied
  // column headings (HeaderText), not a hard-coded column set — proving the view
  // is driven by the columns metadata. Asserted alongside the unwrapped JsonArray
  // cell so this fails on a placeholder that lacks the grid entirely.
  it('renders the invalid rows under the backend-supplied column headings', async () => {
    wireGet({
      fileLogs: [failedFileLog()],
      columns: createMockValidationColumns(), // Reference / Amount / "Error Detail"
      validationErrors: createValidationErrorsResponse(
        createMockInvalidRows(2),
      ),
    });

    await renderFileDetail();

    // The backend HeaderText (NOT the column Name) is rendered as a heading ...
    expect(
      await screen.findByRole('columnheader', { name: /error detail/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: /reference/i }),
    ).toBeInTheDocument();

    // ... and the parsed JsonArray cell values appear under them.
    const firstRow = screen
      .getByText('BADTXN-001')
      .closest('tr') as HTMLElement;
    expect(
      within(firstRow).getByText(/amount is not numeric/i),
    ).toBeInTheDocument();
  });
});

describe('Epic 2, Story 4 — Validation-errors load failure shows error + retry (AC-4, NFR5)', () => {
  // AC-4 / NFR5: when the validation-errors fetch rejects (the FileLog + columns
  // resolving fine), the page surfaces a user-visible error state (role="alert")
  // with a retry affordance — never a blank/broken grid.
  it('shows an error state with a retry affordance when the validation-errors fetch fails', async () => {
    wireGet({
      fileLogs: [failedFileLog()],
      columns: createMockValidationColumns(),
      validationErrors: new Error('Network error'),
    });

    await renderFileDetail();

    const alert = await screen.findByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(
      within(alert).getByRole('button', { name: /(retry|try again)/i }),
    ).toBeInTheDocument();
  });

  // AC-4 / NFR5: the error-state retry affordance is WIRED, not decorative —
  // clicking it re-attempts the validation-errors fetch and, on success, replaces
  // the error with the populated invalid-row grid. (This is the load-error retry
  // affordance — distinct from the Retry-Validation control which re-runs
  // processing.)
  it('re-fetches and renders the invalid-row grid when the user clicks the error retry', async () => {
    const user = userEvent.setup();

    let veAttempts = 0;
    mockGet.mockImplementation((endpoint: string) => {
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
      if (endpoint.includes('/validation-errors/columns')) {
        return Promise.resolve(createMockValidationColumns());
      }
      if (endpoint.includes('/validation-errors')) {
        veAttempts += 1;
        return veAttempts === 1
          ? Promise.reject(new Error('Network error'))
          : Promise.resolve(
              createValidationErrorsResponse(createMockInvalidRows(1)),
            );
      }
      if (endpoint.includes('/file-logs')) {
        return Promise.resolve([failedFileLog()]);
      }
      if (endpoint.includes('/transactions')) {
        return Promise.resolve([]);
      }
      return Promise.reject(new Error(`Unexpected endpoint: ${endpoint}`));
    });

    await renderFileDetail();

    const alert = await screen.findByRole('alert');
    const retry = within(alert).getByRole('button', {
      name: /(retry|try again)/i,
    });
    await user.click(retry);

    await waitFor(() => {
      expect(screen.getByText('BADTXN-001')).toBeInTheDocument();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('Epic 2, Story 4 — accessibility (AC-3 baseline)', () => {
  // The populated Failed-file detail (status badge + invalid-row grid + retry
  // control) has no axe violations. We assert the grid + control rendered first so
  // this breaks on a placeholder/missing surface rather than vacuously passing on
  // an empty DOM (anti-pattern §4 — assert the contrast).
  it('has no accessibility violations on a populated failed-file detail', async () => {
    wireGet({
      fileLogs: [failedFileLog()],
      columns: createMockValidationColumns(),
      validationErrors: createValidationErrorsResponse(
        createMockInvalidRows(2),
      ),
    });

    const { container } = await renderFileDetail();

    expect(await screen.findByText('BADTXN-001')).toBeInTheDocument();
    expect(retryValidationButton()).toBeInTheDocument();

    expect(await axe(container)).toHaveNoViolations();
  });
});
