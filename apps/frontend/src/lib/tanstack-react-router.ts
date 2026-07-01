import { QueryClient } from '@tanstack/react-query'
import { createRouter } from '@tanstack/react-router'
// import { queryClient } from './tanstack-query-client'
// Generated Routes
import { routeTree } from '../routeTree.gen'

// Create a new router instance
export const routerClient = (queryClient: QueryClient) =>
  createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
  })
