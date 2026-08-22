import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { CLERK_PUBLISHABLE_KEY } from './lib/env'
import { ThemeProvider } from './theme/ThemeProvider'
import { AuthGate } from './components/auth/AuthGate'
import { AuthBridge } from './components/auth/AuthBridge'
import { router } from './router'
import './index.css'

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
      <AuthBridge>
        <ThemeProvider>
          <QueryClientProvider client={queryClient}>
            <AuthGate>
              <RouterProvider router={router} />
            </AuthGate>
          </QueryClientProvider>
        </ThemeProvider>
      </AuthBridge>
    </ClerkProvider>
  </StrictMode>,
)
