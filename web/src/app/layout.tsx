import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { ToastProvider } from '@/contexts/ToastContext';
import { ToastContainer } from '@/components/toast/ToastContainer';
import { SessionManager } from '@/components/session/SessionManager';

/**
 * Inter — the brief §11 heading (600) + body (400) typeface for the
 * financial-services brand. Loaded via next/font/google so the font is
 * self-hosted and exposed to the design-token layer through the
 * `--font-inter` CSS variable, which `--font-sans` points at in globals.css.
 */
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

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
    <html lang="en" className={inter.variable}>
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
