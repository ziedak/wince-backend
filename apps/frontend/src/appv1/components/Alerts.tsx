import { AlertTriangle, CheckCircle, XCircle, Info, TrendingDown, Activity, Database, Zap } from "lucide-react";

interface Alert {
  id: string;
  type: "error" | "warning" | "success" | "info";
  category: "recovery" | "ai" | "traffic" | "system";
  title: string;
  message: string;
  timestamp: Date;
  resolved: boolean;
}

const mockAlerts: Alert[] = [
  {
    id: "a1",
    type: "warning",
    category: "ai",
    title: "AI Model Confidence Drop",
    message: "AI prediction confidence has decreased by 8% in the last hour. This may indicate data drift or changing user behavior patterns.",
    timestamp: new Date(Date.now() - 1800000),
    resolved: false,
  },
  {
    id: "a2",
    type: "error",
    category: "recovery",
    title: "Intervention Failure Spike",
    message: "15% discount intervention is failing to display for mobile users. 23 potential conversions affected in the last 30 minutes.",
    timestamp: new Date(Date.now() - 3600000),
    resolved: false,
  },
  {
    id: "a3",
    type: "success",
    category: "traffic",
    title: "Traffic Surge Detected",
    message: "200% increase in traffic detected from social media campaign. AI has automatically scaled intervention capacity.",
    timestamp: new Date(Date.now() - 7200000),
    resolved: true,
  },
  {
    id: "a4",
    type: "info",
    category: "system",
    title: "Scheduled Maintenance",
    message: "System maintenance scheduled for tonight at 2:00 AM PST. Expected downtime: 30 minutes.",
    timestamp: new Date(Date.now() - 10800000),
    resolved: false,
  },
  {
    id: "a5",
    type: "warning",
    category: "traffic",
    title: "Unusual Traffic Pattern",
    message: "Bot-like behavior detected from 12 IP addresses. Traffic filtering has been automatically enabled.",
    timestamp: new Date(Date.now() - 14400000),
    resolved: true,
  },
];

const alertTypeConfig = {
  error: {
    icon: XCircle,
    bgColor: "bg-red-50",
    borderColor: "border-red-200",
    textColor: "text-red-700",
    iconColor: "text-red-600",
  },
  warning: {
    icon: AlertTriangle,
    bgColor: "bg-yellow-50",
    borderColor: "border-yellow-200",
    textColor: "text-yellow-700",
    iconColor: "text-yellow-600",
  },
  success: {
    icon: CheckCircle,
    bgColor: "bg-green-50",
    borderColor: "border-green-200",
    textColor: "text-green-700",
    iconColor: "text-green-600",
  },
  info: {
    icon: Info,
    bgColor: "bg-blue-50",
    borderColor: "border-blue-200",
    textColor: "text-blue-700",
    iconColor: "text-blue-600",
  },
};

const categoryIcons = {
  recovery: Zap,
  ai: Activity,
  traffic: TrendingDown,
  system: Database,
};

export function Alerts() {
  const activeAlerts = mockAlerts.filter(a => !a.resolved);
  const resolvedAlerts = mockAlerts.filter(a => a.resolved);

  const formatTime = (date: Date) => {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-semibold text-gray-900 mb-2">Alerts & Operations</h1>
        <p className="text-gray-600">Monitor system health and operational issues</p>
      </div>

      {/* Alert Summary */}
      <div className="grid  md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-red-50 rounded-lg flex items-center justify-center">
              <XCircle className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Critical</p>
              <p className="text-2xl font-semibold text-gray-900">
                {mockAlerts.filter(a => !a.resolved && a.type === "error").length}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-yellow-50 rounded-lg flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-yellow-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Warnings</p>
              <p className="text-2xl font-semibold text-gray-900">
                {mockAlerts.filter(a => !a.resolved && a.type === "warning").length}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
              <Info className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Info</p>
              <p className="text-2xl font-semibold text-gray-900">
                {mockAlerts.filter(a => !a.resolved && a.type === "info").length}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Resolved</p>
              <p className="text-2xl font-semibold text-gray-900">{resolvedAlerts.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* System Health */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-6">System Health</h2>
        <div className="grid  md:grid-cols-3 gap-6">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">API Response Time</span>
              <span className="text-sm font-medium text-green-600">Healthy</span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-green-500 rounded-full" style={{ width: '95%' }} />
            </div>
            <p className="text-xs text-gray-500 mt-1">avg 124ms</p>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">AI Model Performance</span>
              <span className="text-sm font-medium text-yellow-600">Degraded</span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-yellow-500 rounded-full" style={{ width: '78%' }} />
            </div>
            <p className="text-xs text-gray-500 mt-1">78% accuracy</p>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Database Connectivity</span>
              <span className="text-sm font-medium text-green-600">Healthy</span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-green-500 rounded-full" style={{ width: '100%' }} />
            </div>
            <p className="text-xs text-gray-500 mt-1">All connections stable</p>
          </div>
        </div>
      </div>

      {/* Active Alerts */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Active Alerts</h2>
        </div>
        <div className="divide-y divide-gray-200">
          {activeAlerts.length === 0 ? (
            <div className="p-12 text-center">
              <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
              <p className="text-gray-600">No active alerts. All systems operational!</p>
            </div>
          ) : (
            activeAlerts.map((alert) => {
              const config = alertTypeConfig[alert.type];
              const Icon = config.icon;
              const CategoryIcon = categoryIcons[alert.category];

              return (
                <div key={alert.id} className={`p-6 border-l-4 ${config.borderColor}`}>
                  <div className="flex items-start gap-4">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${config.bgColor}`}>
                      <Icon className={`w-5 h-5 ${config.iconColor}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4 mb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-gray-900">{alert.title}</h3>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize ${config.bgColor} ${config.textColor}`}>
                            <CategoryIcon className="w-3 h-3 mr-1" />
                            {alert.category}
                          </span>
                        </div>
                        <span className="text-sm text-gray-500 whitespace-nowrap">{formatTime(alert.timestamp)}</span>
                      </div>
                      <p className="text-sm text-gray-700 mb-4">{alert.message}</p>
                      <div className="flex gap-2">
                        <button className="px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm font-medium">
                          Investigate
                        </button>
                        <button className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium">
                          Mark Resolved
                        </button>
                        <button className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium">
                          Dismiss
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Recently Resolved */}
      {resolvedAlerts.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Recently Resolved</h2>
          </div>
          <div className="divide-y divide-gray-200">
            {resolvedAlerts.map((alert) => {
              const config = alertTypeConfig[alert.type];
              const Icon = config.icon;
              const CategoryIcon = categoryIcons[alert.category];

              return (
                <div key={alert.id} className="p-6 opacity-60 hover:opacity-100 transition-opacity">
                  <div className="flex items-start gap-4">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${config.bgColor}`}>
                      <Icon className={`w-5 h-5 ${config.iconColor}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4 mb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-gray-900">{alert.title}</h3>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize ${config.bgColor} ${config.textColor}`}>
                            <CategoryIcon className="w-3 h-3 mr-1" />
                            {alert.category}
                          </span>
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            Resolved
                          </span>
                        </div>
                        <span className="text-sm text-gray-500 whitespace-nowrap">{formatTime(alert.timestamp)}</span>
                      </div>
                      <p className="text-sm text-gray-700">{alert.message}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
