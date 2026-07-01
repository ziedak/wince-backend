import { createFileRoute } from '@tanstack/react-router'
// import LiveOps  from '@/features/liveops'
import LiveOps from '@/features/liveops/components/liveops4'


export const Route = createFileRoute('/_authenticated/liveops/')({
  component: LiveOps,
})

// export const Route = createFileRoute('/_authenticated/liveops/')({
//   component: App,
// })
