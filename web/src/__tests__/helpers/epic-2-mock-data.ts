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
 * page-level mocks of `get()` should resolve the UNWRAPPED array, while
 * envelope-aware tests of the client use this factory.
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

/* -------------------------------------------------------------------------- */
/* Validation errors + columns (Epic 2, Story 4 — R11, R13, BR5)              */
/* -------------------------------------------------------------------------- */

/**
 * A single column-definition record for the validation-errors grid, matching
 * `documentation/transactions-api.yaml` → `components.schemas.ColumnDefinition`
 * (operation `FileValidationErrorColumnGetList` on
 * `GET /v1/files/validation-errors/columns`). No api-shape-report.md exists for
 * this build, so the spec schema is authoritative.
 *
 * Shape notes the validation-errors view honours:
 *   - The list arrives under the SINGULAR-keyed `{ ColumnList: [...] }` envelope
 *     (spec `ColumnList.ColumnList`) whose value is an ARRAY — so the API
 *     client's single-key unwrap strips it to a bare `MockValidationColumn[]`
 *     before the page sees it (page-level mocks of `get()` resolve the UNWRAPPED
 *     array).
 *   - `HeaderText` is the human-facing column heading the grid renders; `Name`
 *     keys into each invalid-row object (the JsonArray records). The view binds
 *     headings from `HeaderText` and reads each row cell by `Name`.
 */
export interface MockValidationColumn {
  Name: string;
  HeaderText: string;
  Visible: boolean;
  CellAlignment: string;
  CellDisplay: string;
  Classes: string;
}

/**
 * Builds a single column definition. Defaults model a visible left-aligned text
 * column; pass `overrides` to vary the `Name`/`HeaderText` the grid keys on and
 * renders.
 */
export const createMockValidationColumn = (
  overrides: Partial<MockValidationColumn> = {},
): MockValidationColumn => ({
  Name: 'Name',
  HeaderText: 'Name',
  Visible: true,
  CellAlignment: 'left',
  CellDisplay: 'text',
  Classes: 'col-name',
  ...overrides,
});

/**
 * A spread of column definitions with distinct `Name`/`HeaderText` pairs so a
 * test can assert the grid renders the BACKEND-supplied headings (`HeaderText`)
 * rather than a hard-coded column set — and key each invalid row by `Name`.
 */
export const createMockValidationColumns = (): MockValidationColumn[] => [
  createMockValidationColumn({ Name: 'Reference', HeaderText: 'Reference' }),
  createMockValidationColumn({
    Name: 'Amount',
    HeaderText: 'Amount',
    CellAlignment: 'right',
    CellDisplay: 'number',
  }),
  createMockValidationColumn({ Name: 'Error', HeaderText: 'Error Detail' }),
];

/**
 * The column collection as the live backend returns it: the single-key
 * PascalCase `{ ColumnList: [...] }` envelope whose value is an array. The API
 * client unwraps this to a bare `MockValidationColumn[]` before the page sees it
 * — so page-level mocks of `get()` resolve the UNWRAPPED array, while
 * envelope-aware client tests use this factory.
 */
export const createColumnListEnvelope = (
  items: MockValidationColumn[] = createMockValidationColumns(),
): { ColumnList: MockValidationColumn[] } => ({ ColumnList: items });

/**
 * A single invalid-row object as it appears INSIDE the JsonArray string. Keys
 * align with the column `Name`s above so the grid can read each cell by column
 * `Name`. The spec example (a Bison row) carries arbitrary per-table columns; we
 * model transaction-flavoured keys so the fixture reads as a realistic failed
 * transaction file while preserving the same string-encoded-array shape.
 */
export interface MockInvalidRow {
  Reference: string;
  Amount: string;
  Error: string;
  [extra: string]: string;
}

/**
 * Builds a spread of invalid-row objects (the PARSED contents of JsonArray).
 * Distinct References so `within(row)` lookups never collide.
 */
export const createMockInvalidRows = (count = 2): MockInvalidRow[] =>
  Array.from({ length: count }, (_, i) => {
    const n = String(i + 1).padStart(3, '0');
    return {
      Reference: `BADTXN-${n}`,
      Amount: i % 2 === 0 ? 'not-a-number' : '',
      Error: i % 2 === 0 ? 'Amount is not numeric' : 'Amount is required',
    };
  });

/**
 * The validation-errors payload EXACTLY as the page receives it from the API
 * client. CRITICAL shape note (spec `components.schemas.ValidationErrors` +
 * the client's `unwrapEnvelope`):
 *
 *   - The backend returns `{ ValidationErrors: { JsonArray: "<stringified[]>" } }`.
 *   - The client's single-key unwrap ONLY strips a key whose value is an ARRAY;
 *     here the single `ValidationErrors` key's value is an OBJECT, so the
 *     envelope PASSES THROUGH UNTOUCHED. The page therefore receives the full
 *     `{ ValidationErrors: { JsonArray } }` object — NOT a bare array — and is
 *     responsible for reaching into `.ValidationErrors.JsonArray` and
 *     `JSON.parse`-ing that STRING into the invalid-row array (R13, §13-C).
 *
 * So a page-level mock of `get()` for the validation-errors endpoint must
 * resolve THIS factory's output (the un-unwrapped object with a STRING
 * `JsonArray`), letting the test prove the page does the parse/unwrap rather
 * than the fixture pre-parsing it for the page.
 */
export const createValidationErrorsResponse = (
  rows: MockInvalidRow[] = createMockInvalidRows(),
): { ValidationErrors: { JsonArray: string } } => ({
  ValidationErrors: { JsonArray: JSON.stringify(rows) },
});

/**
 * A retry-validation mutation response in observed PascalCase shape, matching
 * `documentation/transactions-api.yaml` → `components.schemas.DefaultResponse`
 * (operation `FilesRetryValidation` on `POST /v1/files/retry-validation`). This
 * is a multi-key object, so the client's single-key unwrap leaves it untouched —
 * the caller sees `{ Id, MessageType, Messages }` verbatim. Defaults model a
 * success; pass `overrides` for a continued-failure message.
 */
export const createMockRetryResponse = (
  overrides: Partial<{
    Id: number;
    MessageType: string;
    Messages: string[];
  }> = {},
): { Id: number; MessageType: string; Messages: string[] } => ({
  Id: 0,
  MessageType: 'SUCCESS',
  Messages: ['Validation re-run completed'],
  ...overrides,
});
