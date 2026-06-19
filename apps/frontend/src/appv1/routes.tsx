import { createBrowserRouter } from 'react-router';
import { Layout } from './components/Layout';
import { Dashboard } from './components/Dashboard';
import { LiveSessions } from './components/LiveSessions';
import { CustomerJourney } from './components/CustomerJourney';
import { AIDecisions } from './components/AIDecisions';
import { Interventions } from './components/Interventions';
import { Analytics } from './components/Analytics';
import { Settings } from './components/Settings';
import { Alerts } from './components/Alerts';
import { NotFound } from './components/NotFound';

export const router = createBrowserRouter([
  {
    path: '/',
    Component: Layout,
    children: [
      { index: true, Component: Dashboard },
      { path: 'live-sessions', Component: LiveSessions },
      { path: 'journey/:id', Component: CustomerJourney },
      { path: 'ai-decisions', Component: AIDecisions },
      { path: 'interventions', Component: Interventions },
      { path: 'analytics', Component: Analytics },
      { path: 'settings', Component: Settings },
      { path: 'alerts', Component: Alerts },
      { path: '*', Component: NotFound },
    ],
  },
]);
