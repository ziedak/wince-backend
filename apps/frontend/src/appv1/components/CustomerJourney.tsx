import { useParams, Link } from "react-router";
import { ArrowLeft, Monitor, Clock, MapPin, DollarSign, MousePointer, AlertTriangle, Zap, CheckCircle, ShoppingCart, Eye } from "lucide-react";
import { mockVisitors, generateCustomerEvents } from "../lib/mockData";

const eventIcons = {
  page_view: Eye,
  cart_add: ShoppingCart,
  cart_remove: ShoppingCart,
  scroll: MousePointer,
  hesitation: Clock,
  frustration: AlertTriangle,
  intervention: Zap,
  conversion: CheckCircle,
};

const eventColors = {
  page_view: "bg-blue-50 text-blue-700",
  cart_add: "bg-green-50 text-green-700",
  cart_remove: "bg-red-50 text-red-700",
  scroll: "bg-gray-50 text-gray-700",
  hesitation: "bg-yellow-50 text-yellow-700",
  frustration: "bg-orange-50 text-orange-700",
  intervention: "bg-purple-50 text-purple-700",
  conversion: "bg-green-50 text-green-700",
};

export function CustomerJourney() {
  const { id } = useParams();
  const visitor = mockVisitors.find(v => v.id === id);
  const events = generateCustomerEvents(id || "");

  if (!visitor) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Visitor not found</p>
        <Link to="/live-sessions" className="text-purple-600 hover:text-purple-700 mt-4 inline-block">
          Back to Live Sessions
        </Link>
      </div>
    );
  }

  const formatTime = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    }).format(date);
  };

  const timeAgo = (date: Date) => {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  return (
    <div className="space-y-6">
      {/* Back Button */}
      <Link 
        to="/live-sessions"
        className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Live Sessions
      </Link>

      {/* Visitor Header */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 bg-linear-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center text-white text-xl font-semibold">
              {visitor.name.split(' ').map(n => n[0]).join('')}
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-gray-900 mb-1">{visitor.name}</h1>
              <p className="text-gray-600 mb-3">{visitor.email}</p>
              <div className="flex flex-wrap gap-3 text-sm text-gray-600">
                <div className="flex items-center gap-1">
                  <Monitor className="w-4 h-4" />
                  <span className="capitalize">{visitor.device}</span>
                </div>
                <div className="flex items-center gap-1">
                  <MapPin className="w-4 h-4" />
                  <span>{visitor.location}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Clock className="w-4 h-4" />
                  <span>Session started {timeAgo(visitor.sessionStart)}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-xs text-gray-600 mb-1">Cart Value</p>
              <p className="text-xl font-semibold text-gray-900">${visitor.cartValue.toFixed(2)}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-xs text-gray-600 mb-1">Abandonment Risk</p>
              <p className="text-xl font-semibold text-red-600">
                {(visitor.abandonmentProbability * 100).toFixed(0)}%
              </p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4 col-span-2 lg:col-span-1">
              <p className="text-xs text-gray-600 mb-1">Frustration Score</p>
              <p className="text-xl font-semibold text-orange-600">
                {(visitor.frustrationScore * 100).toFixed(0)}%
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Current State */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Current State</h2>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <p className="text-sm text-gray-600 mb-1">Currently viewing</p>
            <p className="font-medium text-gray-900">{visitor.currentPage}</p>
          </div>
          {visitor.interventionState === "triggered" && (
            <div className="px-4 py-3 bg-blue-50 rounded-lg border border-blue-200">
              <div className="flex items-center gap-2 text-blue-700 mb-1">
                <Zap className="w-4 h-4" />
                <span className="font-medium">Intervention Active</span>
              </div>
              <p className="text-xs text-blue-600">15% discount popup displayed</p>
            </div>
          )}
          {visitor.interventionState === "converted" && (
            <div className="px-4 py-3 bg-green-50 rounded-lg border border-green-200">
              <div className="flex items-center gap-2 text-green-700">
                <CheckCircle className="w-4 h-4" />
                <span className="font-medium">Converted!</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid  lg:grid-cols-3 gap-6">
        {/* Journey Timeline */}
        <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-6">Journey Timeline</h2>
          <div className="space-y-4">
            {events.map((event, index) => {
              const Icon = eventIcons[event.type];
              const colorClass = eventColors[event.type];
              const isLast = index === events.length - 1;

              return (
                <div key={event.id} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className={`w-10 h-10 rounded-full ${colorClass} flex items-center justify-center`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    {!isLast && (
                      <div className="w-0.5 h-full min-h-[40px] bg-gray-200 mt-2" />
                    )}
                  </div>
                  <div className="flex-1 pb-6">
                    <div className="flex items-start justify-between gap-4 mb-1">
                      <p className="font-medium text-gray-900 capitalize">
                        {event.type.replace('_', ' ')}
                      </p>
                      <span className="text-sm text-gray-500">{formatTime(event.timestamp)}</span>
                    </div>
                    <p className="text-sm text-gray-600 mb-1">{event.page}</p>
                    {event.data && (
                      <div className="text-xs text-gray-500 mt-2">
                        {Object.entries(event.data).map(([key, value]) => (
                          <span key={key} className="inline-block mr-3">
                            <span className="font-medium capitalize">{key}:</span> {String(value)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Behavior Insights */}
        <div className="space-y-6">
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Behavior Insights</h3>
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-600">Engagement Level</span>
                  <span className="text-sm font-medium text-gray-900">High</span>
                </div>
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-green-500 rounded-full" style={{ width: '78%' }} />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-600">Purchase Intent</span>
                  <span className="text-sm font-medium text-gray-900">Medium</span>
                </div>
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-yellow-500 rounded-full" style={{ width: '62%' }} />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-600">Price Sensitivity</span>
                  <span className="text-sm font-medium text-gray-900">Low</span>
                </div>
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full" style={{ width: '35%' }} />
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Session Stats</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Pages Viewed</span>
                <span className="font-medium text-gray-900">8</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Time on Site</span>
                <span className="font-medium text-gray-900">
                  {Math.floor(visitor.timeOnSite / 60)}m {visitor.timeOnSite % 60}s
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Cart Actions</span>
                <span className="font-medium text-gray-900">3</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Scroll Depth</span>
                <span className="font-medium text-gray-900">75%</span>
              </div>
            </div>
          </div>

          <div className="bg-linear-to-br from-purple-50 to-blue-50 rounded-lg border border-purple-200 p-6">
            <div className="flex items-center gap-2 text-purple-700 mb-2">
              <Zap className="w-5 h-5" />
              <h3 className="font-semibold">AI Recommendation</h3>
            </div>
            <p className="text-sm text-gray-700">
              Trigger urgency intervention with limited stock message. 
              Predicted conversion probability: <span className="font-semibold">68%</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
