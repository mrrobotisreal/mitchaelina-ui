# mitchaelina-ui

The Mitchaelina UI — a private, two-user AI chat lab. Next.js 16 App Router /
React 19 / TypeScript / Tailwind v4 / shadcn/ui / TanStack Query v5 / Firebase
Web SDK (email/password sign-in only) / Firebase Analytics (GA4).

Deploys to Vercel at `www.mitchaelina.com`; talks to the Go API at
`api.mitchaelina.com` (see the API repo's `docs/mitchaelina-deploy-runbook.md`).

## Local dev

```bash
npm install
cp .env.example .env.local   # fill in (NEXT_PUBLIC_API_BASE_URL=http://localhost:8790/api)
npm run dev                  # http://localhost:3000
```

## Verify

```bash
npx tsc --noEmit && npm run lint && npm run build
```

The build must pass with NO env vars set — missing `NEXT_PUBLIC_*` values never
crash a build; auth/analytics degrade to clear runtime messages / silent no-ops.
