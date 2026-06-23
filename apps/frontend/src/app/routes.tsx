import { createBrowserRouter } from 'react-router';
import { Layout } from './views/Layout';
import { Dashboard } from './views/dashboard/Dashboard';
import { LiveSessions } from './views/liveSessions/LiveSessions';
import { CustomerJourney } from './views/CustomerJourney';
import { AIDecisions } from './views/AIDecisions';
import { Interventions } from './views/Interventions';
import { Analytics } from './views/Analytics';
import { Settings } from './views/Settings';
import { Alerts } from './views/Alerts';
import { RevenueIntelligence } from './views/RevenueIntelligence';
import { CustomerSegments } from './views/CustomerSegments';
import { ABTesting } from './views/ABTesting';
import { Playbooks } from './views/Playbooks';
import { Integrations } from './views/Integrations';
import { NotFound } from './views/NotFound';
import Login from './views/Login';
import ProtectedRoute from './components/custom/ProtectedRoute';
import Test  from './views/Test';
import Board from './views/Board';

export const router = createBrowserRouter([
  {
    path: '/test',
    Component: () => <Test />,
  },
  {
    path: '/board',
    Component: () => <Board />,
  },
  {
    path: 'auth',
    // Component: AuthLayout,
    children: [
      { path: 'login', Component: Login },
      //  { path: 'register', Component: Register },
    ],
  },
  {
    path: '/',
    Component: Layout,
    children: [
      {
        index: true,
        element: (
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        ),
      },
      { path: 'live-sessions', Component: LiveSessions },
      { path: 'journey/:id', Component: CustomerJourney },
      { path: 'ai-decisions', Component: AIDecisions },
      { path: 'revenue', Component: RevenueIntelligence },
      { path: 'segments', Component: CustomerSegments },
      { path: 'interventions', Component: Interventions },
      { path: 'playbooks', Component: Playbooks },
      { path: 'ab-testing', Component: ABTesting },
      { path: 'analytics', Component: Analytics },
      { path: 'integrations', Component: Integrations },
      { path: 'alerts', Component: Alerts },
      { path: 'settings', Component: Settings },
      { path: '*', Component: NotFound },
    ],
  },
]);
