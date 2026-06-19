import { createBrowserRouter } from "react-router";
import { Layout } from "./components/Layout";
import { Dashboard } from "./components/Dashboard";
import { LiveSessions } from "./components/LiveSessions";
import { CustomerJourney } from "./components/CustomerJourney";
import { AIDecisions } from "./components/AIDecisions";
import { Interventions } from "./components/Interventions";
import { Analytics } from "./components/Analytics";
import { Settings } from "./components/Settings";
import { Alerts } from "./components/Alerts";
import { RevenueIntelligence } from "./components/RevenueIntelligence";
import { CustomerSegments } from "./components/CustomerSegments";
import { ABTesting } from "./components/ABTesting";
import { Playbooks } from "./components/Playbooks";
import { Integrations } from "./components/Integrations";
import { NotFound } from "./components/NotFound";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Layout,
    children: [
      { index: true, Component: Dashboard },
      { path: "live-sessions", Component: LiveSessions },
      { path: "journey/:id", Component: CustomerJourney },
      { path: "ai-decisions", Component: AIDecisions },
      { path: "revenue", Component: RevenueIntelligence },
      { path: "segments", Component: CustomerSegments },
      { path: "interventions", Component: Interventions },
      { path: "playbooks", Component: Playbooks },
      { path: "ab-testing", Component: ABTesting },
      { path: "analytics", Component: Analytics },
      { path: "integrations", Component: Integrations },
      { path: "alerts", Component: Alerts },
      { path: "settings", Component: Settings },
      { path: "*", Component: NotFound },
    ],
  },
]);
