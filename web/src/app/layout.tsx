import type { Metadata } from 'next';
import './globals.css';
import { ToastProvider } from '@/contexts/ToastContext';
import { ToastContainer } from '@/components/toast/ToastContainer';
import { SessionManager } from '@/components/session/SessionManager';

export const metadata: Metadata = {
  title: 'Transaction Import & Approval System',
  description:
    'Upload, review, approve, reject, and export bank transactions with a role-gated, auditable workflow.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <ToastProvider>
          {/* Global session-lifecycle layer (Epic 1, Story 3 — R17 / NFR6):
              idle + absolute timeout enforcement, the warning dialog, and the
              app-wide sign-out control. Inert on /login. */}
          <SessionManager />
          <main className="min-h-screen">{children}</main>
          <ToastContainer />
        </ToastProvider>
      </body>
    </html>
  );
}
