/**
 * Shared mock-data factories for Epic 2 (File Import & Lifecycle).
 *
 * Created by Epic 2 Story 1's test-generator. Subsequent Epic 2 stories import
 * and EXTEND this file — never duplicate shapes per test file.
 *
 * Shape source of truth (in priority order):
 *   1. `generated-docs/context/api-shape-report.md` — NOT present for this build,
 *      so the spec + observed-drift notes below are authoritative.
 *   2. `documentation/transactions-api.yaml` → `components.schemas.FileLog` /
 *      `FileLogList`. Confirmed field types: `Id: integer`, every other field
 *      consumed here (`ProcessDate`, `RecordCount`, `CurrentStatus`,
 *      `LastExecutedActivityName`, `CurrentFileName`, `HasBulkErrorFile`,
 *      `BulkErrorFile`) is a `string`. Note `RecordCount` is a STRING, not a
 *      number — the table must coerce/format it.
 *   3. project-brief §6 + §13.C/§13.F observed-runtime drift:
 *      - Collections arrive wrapped in a PascalCase single-key envelope. The
 *        File Log collection key is the SINGULAR `FileLog` (spec schema
 *        `FileLogList.FileLog`), e.g. `{ "FileLog": [...] }` — NOT a bare array
 *        and NOT a plural `FileLogs` key. The API client unwraps the single-key
 *        envelope to the bare array before the page sees it.
 *      - `GET /v1/file-logs` requires `?IsActive=Yes` (smoke-test 400 without it).
 *      - File Status is DERIVED from `LastExecutedActivityName` / `CurrentStatus`
 *        and maps onto the FileStatus enum (Uploaded / Processing / Completed /
 *        Failed) the shared StatusBadge renders.
 *
 * Factories return the RAW PascalCase record exactly as the live backend emits
 * it (the page is responsible for unwrapping/deriving/formatting), so a test can
 * assert the page's transformation rather than re-implementing it in the fixture.
 */

/**
 * A single FileLog record in observed PascalCase shape. `RecordCount` is a
 * string per the spec; `CurrentStatus` / `LastExecutedActivityName` carry the
 * raw values the page derives File Status from.
 */
export interface MockFileLog {
  Id: number;
  ProcessDate: string;
  SettingId: number;
  SettingName: string;
  CurrentFileName: string;
  RecordCount: string;
  CurrentStatus: string;
  LastExecutedActivityName: string;
  IsActive: boolean;
  HasBulkErrorFile: string;
  BulkErrorFile: string;
}

/**
 * Builds a single FileLog record. Defaults model a healthy, completed file; pass
 * `overrides` to flip status, name, record count, or process date for sorting /
 * status-mapping cases.
 */
export const createMockFileLog = (
  overrides: Partial<MockFileLog> = {},
): MockFileLog => ({
  Id: 5001,
  ProcessDate: '2026-04-15T08:30:00Z',
  SettingId: 12,
  SettingName: 'Daily Bank Import',
  CurrentFileName: 'transactions_2026-04-15.csv',
  RecordCount: '128',
  CurrentStatus: 'Completed',
  LastExecutedActivityName: 'Completed',
  IsActive: true,
  HasBulkErrorFile: 'No',
  BulkErrorFile: '',
  ...overrides,
});

/**
 * The File Log collection as the live backend returns it: a single-key
 * PascalCase envelope under the SINGULAR `FileLog` key. The API client under
 * test unwraps this to a bare `MockFileLog[]` before the page receives it — so
 * page-level mocks of `get()` should resolve the UNWRAPPED array (what the page
 * actually sees), while envelope-aware tests of the client use this factory.
 */
export const createFileLogEnvelope = (
  items: MockFileLog[] = [createMockFileLog()],
): { FileLog: MockFileLog[] } => ({ FileLog: items });

/**
 * Convenience: a spread of FileLog rows covering each FileStatus the StatusBadge
 * must render, with distinct File Names, Process Dates and Record Counts so a
 * single-column sort produces an unambiguous ordering to assert against.
 *
 * Ordering of the array is deliberately NOT pre-sorted by any column — the page's
 * sort logic is the thing under test.
 */
export const createMockFileLogList = (): MockFileLog[] => [
  createMockFileLog({
    Id: 5001,
    CurrentFileName: 'charlie_2026-04-10.csv',
    ProcessDate: '2026-04-10T06:00:00Z',
    RecordCount: '300',
    CurrentStatus: 'Completed',
    LastExecutedActivityName: 'Completed',
  }),
  createMockFileLog({
    Id: 5002,
    CurrentFileName: 'alpha_2026-04-12.csv',
    ProcessDate: '2026-04-12T09:15:00Z',
    RecordCount: '50',
    CurrentStatus: 'Failed',
    LastExecutedActivityName: 'Failed',
    HasBulkErrorFile: 'Yes',
    BulkErrorFile: 'alpha_errors.csv',
  }),
  createMockFileLog({
    Id: 5003,
    CurrentFileName: 'bravo_2026-04-11.csv',
    ProcessDate: '2026-04-11T14:45:00Z',
    RecordCount: '128',
    CurrentStatus: 'Processing',
    LastExecutedActivityName: 'Processing',
  }),
];

/**
 * Generates `count` distinct FileLog rows for pagination/page-size assertions.
 * File Names and Ids are unique and zero-padded so a name sort is deterministic
 * and `within(row)` lookups never collide.
 */
export const createMockFileLogPage = (count: number): MockFileLog[] =>
  Array.from({ length: count }, (_, i) => {
    const n = String(i + 1).padStart(3, '0');
    return createMockFileLog({
      Id: 6000 + i,
      CurrentFileName: `file_${n}.csv`,
      RecordCount: String((i + 1) * 10),
      ProcessDate: `2026-04-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`,
    });
  });
