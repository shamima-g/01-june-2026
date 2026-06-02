/**
 * Seeded test credentials for Playwright E2E specs.
 *
 * These identities are used against MOCKED same-origin /api/* routes
 * (page.route interception) — the password values are never sent to a real
 * backend during E2E, so they are deterministic placeholders. Specs MUST import
 * from here rather than hard-coding credentials inline (web/e2e/README.md).
 *
 * The two role identities below drive the role-based-landing assertions for
 * Epic 1, Story 2: the mocked auth/userinfo/users responses key off the email so
 * an Importer lands on the file-import surface and an Approver on the
 * transactions surface. The role-resolution source is unconfirmed on the live
 * backend (project-brief §13.E) — the mocks cover login-body, userinfo, and
 * /v1/users so whichever source the implementation reads resolves correctly.
 */

export interface TestUser {
  /** Email entered into the login form (used as the backend `Username`). */
  email: string;
  password: string;
  /** Role name as returned in the User.Roles / userinfo payload. */
  role: 'Importer' | 'Approver';
  firstName: string;
  lastName: string;
}

export const importerUser: TestUser = {
  email: process.env.TEST_IMPORTER_USERNAME ?? 'importer@example.co.za',
  password:
    process.env.TEST_IMPORTER_PASSWORD ??
    process.env.TEST_PASSWORD ??
    'Importer-Pass-1',
  role: 'Importer',
  firstName: 'Imani',
  lastName: 'Naidoo',
};

export const approverUser: TestUser = {
  email: process.env.TEST_APPROVER_USERNAME ?? 'approver@example.co.za',
  password:
    process.env.TEST_APPROVER_PASSWORD ??
    process.env.TEST_PASSWORD ??
    'Approver-Pass-1',
  role: 'Approver',
  firstName: 'Anele',
  lastName: 'Khumalo',
};

/** A deliberately-wrong password used to trigger the 401 credential-failure path. */
export const wrongPassword = 'definitely-not-the-password';
