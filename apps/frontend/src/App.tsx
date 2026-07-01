import { StrictMode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { DirectionProvider } from '@context/direction-provider'
import { FontProvider } from '@context/font-provider'
import { ThemeProvider } from '@context/theme-provider'
import { queryClient } from '@lib/tanstack-query-client'
//order is important here, queryClient must be imported before router
import { routerClient } from './lib/tanstack-react-router'

// declare module '@tanstack/react-router' {
//   interface Register {
//     router: typeof router
//   }
// }

const router = routerClient(queryClient)
export default function App() {
  return (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <FontProvider>
            <DirectionProvider>
              <RouterProvider router={router} />
            </DirectionProvider>
          </FontProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </StrictMode>
  )
}
