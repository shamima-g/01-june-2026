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

/* ------------------------------------------------------------------ *
 * Story 2 — Sign-in with role-based landing
 * ------------------------------------------------------------------ */

/**
 * A single role record as the auth backend returns it within UserInfoRead /
 * RoleRead (auth-api.yaml components.schemas.RoleRead). The role name drives
 * post-login routing.
 */
export interface MockRole {
  Id: number;
  Name: string;
}

/**
 * The role-source payload the login flow resolves AFTER a successful
 * `POST /v1/auth/login`. The brief (§13-E) records `GET /v1/auth/userinfo` as
 * UNCONFIRMED on the running backend, so the source is intentionally swappable
 * (userinfo, or a `GET /v1/users` record matched to the signed-in username).
 * Both candidate sources expose the role the same way — a `RolesString` scalar
 * and/or a `Roles[]` array — so this factory models the common shape the role
 * resolver consumes regardless of which endpoint supplied it.
 */
export interface MockUserInfo {
  Id: number;
  Email: string;
  FirstName: string;
  LastName: string;
  RolesString: string;
  Roles: MockRole[];
}

/**
 * Builds the resolved-user payload for a given role. `RolesString` and the
 * `Roles[]` array agree on the role name so a resolver reading either field
 * lands on the same answer. Pass `role` to flip between Importer / Approver;
 * omit fields via `overrides` to model partial/unknown-role responses.
 */
export const createMockUserInfo = (
  role: string,
  overrides: Partial<MockUserInfo> = {},
): MockUserInfo => ({
  Id: 7,
  Email: `${role.toLowerCase()}@example.com`,
  FirstName: 'Sam',
  LastName: 'Operator',
  RolesString: role,
  Roles: [{ Id: 1, Name: role }],
  ...overrides,
});

/**
 * The login endpoint returns a PascalCase `DefaultResponse` envelope
 * (auth-api.yaml: 200 → DefaultResponse `{ Messages: ["Login successful"] }`).
 * Critically it does NOT carry the role — confirming the role must be resolved
 * from a separate source after login. Modelled here so a test can assert the
 * flow does not naively read a role off the login response.
 */
export const createLoginSuccessResponse = (): {
  Id: number;
  MessageType: string;
  Messages: string[];
} => ({
  Id: 0,
  MessageType: 'SUCCESS',
  Messages: ['Login successful'],
});
