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

/* -------------------------------------------------------------------------- */
/* Transactions (Epic 2, Story 2 — file detail's read-only transaction slice) */
/* -------------------------------------------------------------------------- */

/**
 * A single Transaction record in observed PascalCase shape, matching
 * `documentation/transactions-api.yaml` → `components.schemas.TransactionRead`.
 *
 * Shape notes the file-detail surface must honour:
 *   - The collection arrives under the SINGULAR-keyed `{ Transactions: [...] }`
 *     envelope (spec `TransactionReadList.Transactions`), which the API client
 *     unwraps to a bare `MockTransaction[]` before the page sees it — so a
 *     page-level mock of `get()` should resolve the UNWRAPPED array.
 *   - `GET /v1/transactions` takes NO FileLogId filter param (confirmed in the
 *     spec), so the page fetches ALL transactions and filters CLIENT-SIDE by
 *     `FileLogId`. The fixture therefore models `FileLogId` so a test can prove
 *     the page only renders the slice belonging to the file under view.
 *   - `Id` / `FileLogId` are declared `integer` in the spec but the spec EXAMPLES
 *     are string-coerced (`'1'`); the live transactions API has shown the same
 *     coercion on integer ids. We model them as `number` here (the spec's
 *     declared type). If a future api-shape-report.md records string ids, this
 *     factory is the single place to flip them.
 *   - `Amount` is a numeric `number` per the spec; the table formats it.
 */
export interface MockTransaction {
  Id: number;
  FileLogId: number;
  FileName: string;
  Reference: string;
  TransactionDate: string;
  AccountNumber: string;
  Description: string;
  Amount: number;
  TransactionType: string;
  Currency: string;
  Status: string;
  UserNote: string;
  LastChangedUser: string;
  LastChangedDate: string;
}

/**
 * Builds a single Transaction record. Defaults model an `Imported` debit that
 * belongs to FileLog 5001 (the default `createMockFileLog` Id); pass `overrides`
 * to re-parent it to a different `FileLogId`, change the `Status`, or vary the
 * displayed columns.
 */
export const createMockTransaction = (
  overrides: Partial<MockTransaction> = {},
): MockTransaction => ({
  Id: 9001,
  FileLogId: 5001,
  FileName: 'transactions_2026-04-15.csv',
  Reference: 'TXN-00001',
  TransactionDate: '2026-04-15T15:00:00Z',
  AccountNumber: '1234567890',
  Description: 'Payment for invoice 1234',
  Amount: 1500.5,
  TransactionType: 'Debit',
  Currency: 'ZAR',
  Status: 'Imported',
  UserNote: '',
  LastChangedUser: 'John Doe',
  LastChangedDate: '2026-04-15T15:00:00Z',
  ...overrides,
});

/**
 * A spread of transactions belonging to `fileLogId` (default 5001) with unique
 * References and Account Numbers so `within(row)` lookups never collide. Use
 * this for the populated read-only slice in the file-detail tests.
 */
export const createMockTransactionsForFile = (
  fileLogId = 5001,
  count = 3,
): MockTransaction[] =>
  Array.from({ length: count }, (_, i) => {
    const n = String(i + 1).padStart(3, '0');
    return createMockTransaction({
      Id: 9000 + i,
      FileLogId: fileLogId,
      Reference: `TXN-${n}`,
      AccountNumber: `100000000${i}`,
      Amount: (i + 1) * 100,
    });
  });

/**
 * The Transaction collection as the live backend returns it: a single-key
 * PascalCase envelope under the SINGULAR `Transactions` key. The API client
 * unwraps this to a bare `MockTransaction[]` before the page receives it — so
 * page-level mocks of `get()` should resolve the UNWRAPPED array, while
 * envelope-aware client tests use this factory.
 */
export const createTransactionEnvelope = (
  items: MockTransaction[] = [createMockTransaction()],
): { Transactions: MockTransaction[] } => ({ Transactions: items });

/* -------------------------------------------------------------------------- */
/* File Settings (Epic 2, Story 3 — upload's File Setting selector)           */
/* -------------------------------------------------------------------------- */

/**
 * A single FileSetting record in observed PascalCase shape, matching
 * `documentation/transactions-api.yaml` → `components.schemas.FileSettingRead`
 * (the `FileSettingGetList` operation on `GET /v1/file-settings`). No
 * api-shape-report.md exists for this build, so the spec schema is authoritative.
 *
 * Shape notes the upload surface honours:
 *   - The list arrives under the PLURAL-keyed `{ FileSettings: [...] }` envelope
 *     (spec `FileSettingReadList.FileSettings`), which the API client unwraps to
 *     a bare `MockFileSetting[]` before the page sees it — so a page-level mock
 *     of `get()` should resolve the UNWRAPPED array.
 *   - On confirm the upload sends the picked record's `Id` as the `FileSettingId`
 *     query param and its `Name` as `FileSettingName` (project-brief §9 File
 *     Upload, R2). The selector therefore binds those two fields; the rest mirror
 *     the spec for completeness.
 *
 * Only the fields the upload screen consumes are kept narrow; the spec carries
 * more (`StagingSchema`, `TargetTable`, audit fields, etc.) but they don't shape
 * the selector or the upload request, so modelling them would be noise.
 */
export interface MockFileSetting {
  Id: number;
  Name: string;
  SourceId: number;
  SourceName: string;
  TypeId: number;
  TypeName: string;
  Direction: string;
  IsActive: boolean;
}

/**
 * Builds a single FileSetting record. Defaults model an active "Daily Bank
 * Import" inbound setting; pass `overrides` to vary the `Id`/`Name` the selector
 * surfaces and the upload sends.
 */
export const createMockFileSetting = (
  overrides: Partial<MockFileSetting> = {},
): MockFileSetting => ({
  Id: 12,
  Name: 'Daily Bank Import',
  SourceId: 3,
  SourceName: 'Bank A',
  TypeId: 1,
  TypeName: 'CSV',
  Direction: 'Inbound',
  IsActive: true,
  ...overrides,
});

/**
 * A spread of FileSetting options with distinct Ids and Names so the selector
 * renders multiple choices and a test can pick an unambiguous one.
 */
export const createMockFileSettingList = (): MockFileSetting[] => [
  createMockFileSetting({ Id: 12, Name: 'Daily Bank Import' }),
  createMockFileSetting({ Id: 14, Name: 'Weekly Reconciliation' }),
  createMockFileSetting({ Id: 21, Name: 'Ad-hoc Manual Upload' }),
];

/**
 * The FileSetting collection as the live backend returns it: a single-key
 * PascalCase envelope under the PLURAL `FileSettings` key (spec
 * `FileSettingReadList.FileSettings`). The API client unwraps this to a bare
 * `MockFileSetting[]` before the page receives it — so page-level mocks of
 * `get()` should resolve the UNWRAPPED array, while envelope-aware client tests
 * use this factory.
 */
export const createFileSettingEnvelope = (
  items: MockFileSetting[] = [createMockFileSetting()],
): { FileSettings: MockFileSetting[] } => ({ FileSettings: items });
