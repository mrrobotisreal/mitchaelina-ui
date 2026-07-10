'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@/components/ui/sonner';
import AnalyticsListener from '@/components/analytics-listener';

// One QueryClient for the app lifetime. Created lazily inside the component so
// each browser tab gets its own instance and it is never shared across requests
// on the server.
let browserQueryClient: QueryClient | undefined;
function getQueryClient(): QueryClient {
  if (!browserQueryClient) browserQueryClient = new QueryClient();
  return browserQueryClient;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(getQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
        {children}
        <Toaster />
        <AnalyticsListener />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
