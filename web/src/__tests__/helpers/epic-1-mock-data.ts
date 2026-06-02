/**
 * Shared mock-data factories for Epic 1 (Auth & Foundation).
 *
 * Shapes follow the observed runtime contract captured in the project brief
 * (§6 + §13.C) and the INTAKE smoke-test (intake-manifest.json → observedDrift):
 * collection responses arrive wrapped in a PascalCase single-key envelope, e.g.
 * `{ "Transactions": [...] }`, `{ "Users": [...] }`. Bare arrays are NOT returned.
 *
 * Created by Epic 1 Story 1's test-generator. Subsequent stories import and
 * extend — never duplicate.
 */

export interface MockTransaction {
  Id: number;
  FileLogId: number;
  Reference: string;
  AccountNumber: string;
  Amount: number;
  Currency: string;
  Status: string;
}

export interface MockUser {
  Id: number;
  Email: string;
  FirstName: string;
  LastName: string;
  RolesString: string;
}

/** A single Transaction record in observed PascalCase shape. */
export const createMockTransaction = (
  overrides: Partial<MockTransaction> = {},
): MockTransaction => ({
  Id: 101,
  FileLogId: 5,
  Reference: 'TXN-20260415-0001',
  AccountNumber: '1234-5678-9012',
  Amount: 1500.5,
  Currency: 'ZAR',
  Status: 'Imported',
  ...overrides,
});

/** A single User record in observed PascalCase shape. */
export const createMockUser = (
  overrides: Partial<MockUser> = {},
): MockUser => ({
  Id: 1,
  Email: 'approver@example.com',
  FirstName: 'Thandi',
  LastName: 'Mokoena',
  RolesString: 'Approver',
  ...overrides,
});

/**
 * Collection responses as the live backend returns them: a single-key
 * PascalCase envelope wrapping the array. The client under test must unwrap
 * these to the bare array before callers see them.
 */
export const createTransactionsEnvelope = (
  items: MockTransaction[] = [createMockTransaction()],
): { Transactions: MockTransaction[] } => ({ Transactions: items });

export const createUsersEnvelope = (
  items: MockUser[] = [createMockUser()],
): { Users: MockUser[] } => ({ Users: items });
