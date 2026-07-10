import AuthView from '@/components/auth-view';

// /auth — the dedicated sign-in page. Lives OUTSIDE the (app) route group so
// it renders without the authenticated shell and is not wrapped by AuthGate
// (which would redirect-loop). Email + password only.
export default function AuthPage() {
  return <AuthView />;
}
