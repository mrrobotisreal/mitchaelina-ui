import AuthGate from '@/components/auth-gate';
import AppShell from '@/components/app-shell';

// Everything under (app) — /, /c/[sessionId], /p/[projectId], /stats — is
// gated, then wrapped in the private shell. The route group keeps /auth
// outside this boundary so sign-in renders bare. The gate is UX-only; the API
// (Firebase token + email allowlist) is the real enforcement boundary.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <AppShell>{children}</AppShell>
    </AuthGate>
  );
}
