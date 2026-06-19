import { useState } from "react";
import { Monitor, Smartphone, Tablet, MapPin, Clock, DollarSign, TrendingUp, Zap, Search, Filter } from "lucide-react";
import { mockVisitors } from "../lib/mockData";
import { Link } from "react-router";

const deviceIcons = {
  desktop: Monitor,
  mobile: Smartphone,
  tablet: Tablet,
};

export function LiveSessions() {
  const [filterDevice, setFilterDevice] = useState<string>("all");
  const [filterRisk, setFilterRisk] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  let filteredVisitors = mockVisitors;

  if (filterDevice !== "all") {
    filteredVisitors = filteredVisitors.filter(v => v.device === filterDevice);
  }

  if (filterRisk === "high") {
    filteredVisitors = filteredVisitors.filter(v => v.abandonmentProbability > 0.6);
  } else if (filterRisk === "medium") {
    filteredVisitors = filteredVisitors.filter(v => v.abandonmentProbability > 0.3 && v.abandonmentProbability <= 0.6);
  } else if (filterRisk === "low") {
    filteredVisitors = filteredVisitors.filter(v => v.abandonmentProbability <= 0.3);
  }

  if (searchQuery) {
    filteredVisitors = filteredVisitors.filter(v => 
      v.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.currentPage.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-semibold text-gray-900 mb-2">Live Sessions</h1>
        <p className="text-gray-600">Real-time monitoring of active visitors and cart abandonment risk</p>
      </div>

      {/* Stats Bar */}
      <div className="grid  md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Active Now</p>
              <p className="text-2xl font-semibold text-gray-900 mt-1">{mockVisitors.length}</p>
            </div>
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-600">High Risk</p>
          <p className="text-2xl font-semibold text-red-600 mt-1">
            {mockVisitors.filter(v => v.abandonmentProbability > 0.6).length}
          </p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-600">Interventions Active</p>
          <p className="text-2xl font-semibold text-blue-600 mt-1">
            {mockVisitors.filter(v => v.interventionState === "triggered").length}
          </p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-600">Total Cart Value</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">
            ${mockVisitors.reduce((sum, v) => sum + v.cartValue, 0).toFixed(2)}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name, email, or page..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
          </div>
          <div className="flex gap-2">
            <select
              value={filterDevice}
              onChange={(e) => setFilterDevice(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            >
              <option value="all">All Devices</option>
              <option value="desktop">Desktop</option>
              <option value="mobile">Mobile</option>
              <option value="tablet">Tablet</option>
            </select>
            <select
              value={filterRisk}
              onChange={(e) => setFilterRisk(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            >
              <option value="all">All Risk Levels</option>
              <option value="high">High Risk (&gt;60%)</option>
              <option value="medium">Medium Risk (30-60%)</option>
              <option value="low">Low Risk (&lt;30%)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Visitor List */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Visitor
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Current Page
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Cart Value
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Time on Site
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Abandonment Risk
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredVisitors.map((visitor) => {
                const DeviceIcon = deviceIcons[visitor.device];
                const riskLevel = visitor.abandonmentProbability > 0.6 ? 'high' : 
                                  visitor.abandonmentProbability > 0.3 ? 'medium' : 'low';
                const riskColors = {
                  high: 'bg-red-100 text-red-700',
                  medium: 'bg-yellow-100 text-yellow-700',
                  low: 'bg-green-100 text-green-700',
                };

                return (
                  <tr key={visitor.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <Link to={`/journey/${visitor.id}`} className="block">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-linear-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center text-white font-semibold">
                            {visitor.name.split(' ').map(n => n[0]).join('')}
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">{visitor.name}</p>
                            <div className="flex items-center gap-2 text-sm text-gray-500">
                              <DeviceIcon className="w-3 h-3" />
                              <span>{visitor.location}</span>
                            </div>
                          </div>
                        </div>
                      </Link>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-gray-900">{visitor.currentPage}</p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm font-medium text-gray-900">${visitor.cartValue.toFixed(2)}</p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-gray-900">
                        {Math.floor(visitor.timeOnSite / 60)}m {visitor.timeOnSite % 60}s
                      </p>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-200 rounded-full h-2 max-w-[100px]">
                          <div 
                            className={`h-2 rounded-full ${
                              riskLevel === 'high' ? 'bg-red-500' :
                              riskLevel === 'medium' ? 'bg-yellow-500' : 'bg-green-500'
                            }`}
                            style={{ width: `${visitor.abandonmentProbability * 100}%` }}
                          />
                        </div>
                        <span className="text-sm font-medium text-gray-900">
                          {(visitor.abandonmentProbability * 100).toFixed(0)}%
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {visitor.interventionState === "triggered" && (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                          <Zap className="w-3 h-3 mr-1" />
                          Intervention
                        </span>
                      )}
                      {visitor.interventionState === "converted" && (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700">
                          Converted
                        </span>
                      )}
                      {visitor.interventionState === "none" && (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-gray-50 text-gray-700">
                          Monitoring
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filteredVisitors.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500">No visitors match your filters</p>
          </div>
        )}
      </div>
    </div>
  );
}
