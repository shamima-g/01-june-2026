'use client';

/**
 * Sign-in with role-based landing (Epic 1, Story 2 — R1, R18).
 *
 * Email + password form composed from Shadcn primitives. On submit it posts
 * `{ Username, Password }` to the same-origin auth login path (proxied to the
 * auth backend), then resolves the signed-in user's role from the swappable
 * source in `@/lib/auth/roles` and routes to the role-specific landing surface
 * (Importer → file import, Approver → transactions).
 *
 * Error handling (R18) DISTINGUISHES two failure classes with non-overlapping
 * wording:
 *   - a 401 → a CREDENTIAL-failure message ("email or password is incorrect"),
 *   - a network / connectivity failure (the client surfaces `statusCode: 0`) →
 *     a DISTINCT "can't reach the service" message.
 * Both keep the user on `/login` and surface inline via `role="alert"` (and a
 * toast) — never a redirect.
 *
 * On success it also records the client-side session-start marker (Epic 1,
 * Story 3) so the SessionManager can enforce the 8-hour absolute cap and so
 * authenticated surfaces can perform their lightweight "is there a session?"
 * route check.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { post } from '@/lib/api/client';
import type { APIError } from '@/types/api';
import { fetchSignedInRole, resolveLandingRoute } from '@/lib/auth/roles';
import { markSessionStart } from '@/lib/session/session-client';
import { useToast } from '@/contexts/ToastContext';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Same-origin login path — proxied to `${AUTH_BASE}/v1/auth/login`. */
const LOGIN_PATH = '/api/auth/login';

const CREDENTIAL_ERROR =
  'The email or password you entered is incorrect. Please try again.';
const CONNECTIVITY_ERROR =
  "We can't reach the sign-in service right now. Please check your connection and try again.";

/**
 * Narrows an unknown thrown value to the client's typed APIError shape.
 * Anything without a numeric `statusCode` is treated as a connectivity failure
 * (the safest default — we never imply "wrong password" for an unknown fault).
 */
function isApiError(error: unknown): error is APIError {
  return typeof error === 'object' && error !== null && 'statusCode' in error;
}

export default function LoginPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      // The backend expects PascalCase {Username, Password}; the email field is
      // the username (project-brief §3 / §9).
      await post(LOGIN_PATH, { Username: email, Password: password });

      // Login succeeded (session cookie now set). Record the client-side
      // session-start marker so the SessionManager's absolute-cap clock and the
      // authenticated-surface route guard have a signal to read.
      markSessionStart();

      // Resolve the role from the swappable source, then route to the
      // role-specific landing surface.
      const role = await fetchSignedInRole(email);
      router.push(resolveLandingRoute(role));
    } catch (err) {
      const isCredentialFailure = isApiError(err) && err.statusCode === 401;
      const message = isCredentialFailure
        ? CREDENTIAL_ERROR
        : CONNECTIVITY_ERROR;

      setError(message);
      showToast({
        variant: 'error',
        title: isCredentialFailure ? 'Sign-in failed' : 'Connection problem',
        message,
      });
      setSubmitting(false);
    }
  }

  return (
    <main
      aria-labelledby="login-heading"
      className="bg-background flex min-h-screen items-center justify-center px-4 py-8"
    >
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle id="login-heading" className="text-2xl">
            Sign in
          </CardTitle>
          <CardDescription>
            Enter your email and password to access the Transaction Import &amp;
            Approval System.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleSubmit}
            noValidate
            className="flex flex-col gap-6"
          >
            {error && (
              <p
                role="alert"
                className="text-destructive border-destructive/40 bg-destructive/10 rounded-md border px-3 py-2 text-sm"
              >
                {error}
              </p>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
