/**
 * API Type Definitions Template
 *
 * Generic type definitions for API communication
 * Customize these based on your API's response format
 */

/**
 * DefaultResponse - Standard API response structure
 * Customize this based on your API's response format
 * Common in REST APIs for mutation endpoints (POST, PUT, DELETE)
 */
export interface DefaultResponse {
  Id: number;
  MessageType: string;
  Messages: string[];
}

/**
 * APIError - Standardized error object for API failures
 * Used throughout the application for consistent error handling
 */
export interface APIError {
  message: string;
  statusCode?: number;
  details?: string[];
  endpoint?: string;
}

export type QueryParamScalar = string | number | boolean;
export type QueryParams = Record<
  string,
  QueryParamScalar | ReadonlyArray<QueryParamScalar> | undefined
>;

/**
 * APIRequestConfig - Configuration options for API requests
 * Extends standard fetch RequestInit with additional options
 */
export interface APIRequestConfig extends RequestInit {
  params?: QueryParams;
  /**
   * When true, the client injects an auth header from getAuthHeader() (env-var
   * driven, populated by api-connectivity-agent during INTAKE Step 4b). Caller-
   * supplied headers always win — set headers explicitly to override.
   */
  requiresAuth?: boolean;
  lastChangedUser?: string; // For audit trails - remove if not needed
  isBinaryResponse?: boolean; // Flag to indicate response should be treated as binary data
}

/**
 * APIResponse - Generic wrapper for successful API responses
 * Provides type-safe response handling
 */
export interface APIResponse<T> {
  data: T;
  status: number;
  statusText: string;
}

/**
 * API Message Type enum values
 * Customize based on your API's message types
 */
export const APIMessageType = {
  SUCCESS: 'SUCCESS',
  ERROR: 'ERROR',
  WARNING: 'WARNING',
  INFO: 'INFO',
} as const;

export type APIMessageTypeValue =
  (typeof APIMessageType)[keyof typeof APIMessageType];

/**
 * HTTP Status Codes - Common status codes used in the application
 */
export const HTTPStatus = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
} as const;

export type HTTPStatusCode = (typeof HTTPStatus)[keyof typeof HTTPStatus];

/**
 * FileLog — a file-ingestion log entry as the live transactions backend emits
 * it, in observed PascalCase (project-brief §6 / §13.C / §13.F).
 *
 * Field-shape notes the UI must honour:
 *   - The collection arrives wrapped in the SINGULAR `{ FileLog: [...] }`
 *     envelope, which the API client (handleSuccessResponse) unwraps to a bare
 *     `FileLog[]` before any caller sees it.
 *   - `RecordCount` arrives as a STRING (spec + observed drift), not a number —
 *     consumers format/coerce it.
 *   - "File Name" binds to `CurrentFileName` (§13.F).
 *   - File Status is DERIVED from `LastExecutedActivityName` (preferred) /
 *     `CurrentStatus` — see `deriveFileStatus`.
 */
export interface FileLog {
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
 * The derived File Status lifecycle enum (project-brief §6, R16). Rendered by
 * the shared StatusBadge, which colour+icon+label-maps each value.
 */
export const FileStatus = {
  Uploaded: 'Uploaded',
  Processing: 'Processing',
  Completed: 'Completed',
  Failed: 'Failed',
} as const;

export type FileStatusValue = (typeof FileStatus)[keyof typeof FileStatus];

/**
 * Transaction — a single bank-transaction record as the live transactions
 * backend emits it, in observed PascalCase (project-brief §6 / §13.C / §13.D).
 *
 * Field-shape notes the UI must honour:
 *   - The collection arrives wrapped in the SINGULAR `{ Transactions: [...] }`
 *     envelope (spec `TransactionReadList.Transactions`), which the API client
 *     (handleSuccessResponse) unwraps to a bare `Transaction[]` before any
 *     caller sees it.
 *   - `GET /v1/transactions` takes NO `FileLogId` filter param (project-brief
 *     §9 Transaction Review + story summary) — callers fetch the full set and
 *     filter CLIENT-SIDE by `FileLogId` to obtain a single file's slice.
 *   - `Status` carries the TransactionStatus lifecycle (`Imported` / `Approved`
 *     / `Rejected`), rendered via the shared StatusBadge.
 *   - `Amount` is numeric; consumers format it. `TransactionType` value format
 *     (`C`/`D` vs `Debit`) is unresolved across spec/BRD (§13.D) — consumers
 *     display the raw value.
 */
export interface Transaction {
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
 * FileSetting — a file-import configuration as the live transactions backend
 * emits it, in observed PascalCase (project-brief §6, spec
 * `components.schemas.FileSettingRead`, operation `FileSettingGetList` on
 * `GET /v1/file-settings`).
 *
 * Field-shape notes the upload surface must honour:
 *   - The collection arrives wrapped in the PLURAL `{ FileSettings: [...] }`
 *     envelope (spec `FileSettingReadList.FileSettings`) — distinct from the
 *     file-logs SINGULAR `{ FileLog: [...] }` oddity — which the API client
 *     (handleSuccessResponse) unwraps to a bare `FileSetting[]` before any
 *     caller sees it (project-brief §6 / §13.C).
 *   - At upload time the picked record's `Id` is sent as the `FileSettingId`
 *     query param and its `Name` as `FileSettingName` (project-brief §9 File
 *     Upload, R2). The spec carries more fields (`StagingTable`,
 *     `ProcessDefinitionId`, audit fields); only the ones the selector and the
 *     upload request consume are modelled here.
 */
export interface FileSetting {
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
 * ValidationColumn — a column-metadata record describing one column of the
 * validation-errors grid for a `Failed` File Log (Epic 2, Story 4 — R13). Maps
 * to the transactions-api `ColumnDefinition` schema (operation
 * `FileValidationErrorColumnGetList` on
 * `GET /v1/files/validation-errors/columns`).
 *
 * Field-shape notes the validation-errors view must honour:
 *   - The collection arrives wrapped in the SINGULAR `{ ColumnList: [...] }`
 *     envelope whose value is an ARRAY, so the API client unwraps it to a bare
 *     `ValidationColumn[]` before any caller sees it (project-brief §6 / §13.C).
 *   - `HeaderText` is the human-facing column heading the grid renders;
 *     `Name` keys into each invalid-row object (the parsed JsonArray records).
 *   - A column with `Visible: false` must NOT render — neither its heading nor
 *     its cells.
 */
export interface ValidationColumn {
  Name: string;
  HeaderText: string;
  Visible: boolean;
  CellAlignment: string;
  CellDisplay: string;
  Classes: string;
}

/**
 * InvalidRow — a single parsed invalid-row record from the validation-errors
 * payload (Epic 2, Story 4 — R13). The backend returns the rows as a STRINGIFIED
 * JSON array nested under `{ ValidationErrors: { JsonArray: "<stringified[]>" } }`
 * (a single key whose value is an OBJECT, so the client's array-only single-key
 * unwrap leaves it intact — the page reaches into `.ValidationErrors.JsonArray`
 * and `JSON.parse`-s the STRING — project-brief §13-C).
 *
 * Each parsed row is an open string-keyed map: the keys align with the columns'
 * `Name` values, and the grid reads each cell by column `Name`.
 */
export type InvalidRow = Record<string, string>;

/**
 * The validation-errors payload EXACTLY as the API client hands it back: the
 * un-unwrapped `{ ValidationErrors: { JsonArray } }` object (the single key's
 * value is an object, not an array, so the client does not strip it —
 * project-brief §6 / §13.C).
 */
export interface ValidationErrorsResponse {
  ValidationErrors: { JsonArray: string };
}
