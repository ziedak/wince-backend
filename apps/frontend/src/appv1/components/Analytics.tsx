import { Calendar, Download, TrendingUp, DollarSign } from "lucide-react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell } from "recharts";
import { revenueRecoveryData, hourlyActivityData, segmentPerformanceData, interventionPerformanceData } from "../lib/mockData";

const COLORS = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444'];

export function Analytics() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-gray-900 mb-2">Analytics & Reporting</h1>
          <p className="text-gray-600">Deep insights into cart recovery performance</p>
        </div>
        <div className="flex gap-2">
          <button className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            Last 7 days
          </button>
          <button className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2">
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid  md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-gray-600">Total Revenue Recovered</p>
            <DollarSign className="w-5 h-5 text-green-600" />
          </div>
          <p className="text-2xl font-semibold text-gray-900 mb-1">$43,250</p>
          <div className="flex items-center gap-1 text-sm">
            <TrendingUp className="w-4 h-4 text-green-600" />
            <span className="text-green-600 font-medium">+18.2%</span>
            <span className="text-gray-500">vs last period</span>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-gray-600">Average Order Value</p>
            <DollarSign className="w-5 h-5 text-blue-600" />
          </div>
          <p className="text-2xl font-semibold text-gray-900 mb-1">$187.42</p>
          <div className="flex items-center gap-1 text-sm">
            <TrendingUp className="w-4 h-4 text-green-600" />
            <span className="text-green-600 font-medium">+5.3%</span>
            <span className="text-gray-500">vs last period</span>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-gray-600">Recovery Rate</p>
            <TrendingUp className="w-5 h-5 text-purple-600" />
          </div>
          <p className="text-2xl font-semibold text-gray-900 mb-1">28.4%</p>
          <div className="flex items-center gap-1 text-sm">
            <TrendingUp className="w-4 h-4 text-green-600" />
            <span className="text-green-600 font-medium">+3.1%</span>
            <span className="text-gray-500">vs last period</span>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-gray-600">Total Interventions</p>
            <TrendingUp className="w-5 h-5 text-orange-600" />
          </div>
          <p className="text-2xl font-semibold text-gray-900 mb-1">1,319</p>
          <div className="flex items-center gap-1 text-sm">
            <TrendingUp className="w-4 h-4 text-green-600" />
            <span className="text-green-600 font-medium">+12.4%</span>
            <span className="text-gray-500">vs last period</span>
          </div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid  lg:grid-cols-2 gap-6">
        {/* Revenue Recovery Trend */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Revenue Recovery Trend</h2>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={revenueRecoveryData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" stroke="#9ca3af" fontSize={12} />
              <YAxis stroke="#9ca3af" fontSize={12} />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#fff', 
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  fontSize: '12px'
                }}
                formatter={(value: number) => `$${value}`}
              />
              <Legend />
              <Line 
                type="monotone" 
                dataKey="recovered" 
                stroke="#8b5cf6" 
                strokeWidth={2}
                name="Recovered"
                dot={{ fill: '#8b5cf6', r: 4 }}
              />
              <Line 
                type="monotone" 
                dataKey="potential" 
                stroke="#cbd5e1" 
                strokeWidth={2}
                strokeDasharray="5 5"
                name="Potential"
                dot={{ fill: '#cbd5e1', r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Hourly Activity */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Hourly Activity Pattern</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={hourlyActivityData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="hour" stroke="#9ca3af" fontSize={12} />
              <YAxis stroke="#9ca3af" fontSize={12} />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#fff', 
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  fontSize: '12px'
                }}
              />
              <Legend />
              <Bar dataKey="visitors" fill="#8b5cf6" radius={[8, 8, 0, 0]} name="Visitors" />
              <Bar dataKey="conversions" fill="#10b981" radius={[8, 8, 0, 0]} name="Conversions" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Intervention Performance Distribution */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Revenue by Intervention Type</h2>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={interventionPerformanceData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                outerRadius={100}
                fill="#8884d8"
                dataKey="revenue"
              >
                {interventionPerformanceData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#fff', 
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  fontSize: '12px'
                }}
                formatter={(value: number) => `$${value.toLocaleString()}`}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Segment Performance */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Segment Performance</h2>
          <div className="space-y-4">
            {segmentPerformanceData.map((segment, index) => (
              <div key={index}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-900">{segment.segment}</span>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-gray-600">{segment.recoveryRate}%</span>
                    <span className="text-sm font-medium text-gray-900">${segment.avgRevenue}</span>
                  </div>
                </div>
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div 
                    className="h-full rounded-full"
                    style={{ 
                      width: `${segment.recoveryRate}%`,
                      backgroundColor: COLORS[index % COLORS.length]
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Attribution Table */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Revenue Attribution</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Channel
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Interventions
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Conversions
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Conversion Rate
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Revenue
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  ROI
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              <tr className="hover:bg-gray-50">
                <td className="px-6 py-4 font-medium text-gray-900">AI-Powered Discounts</td>
                <td className="px-6 py-4 text-gray-900">456</td>
                <td className="px-6 py-4 text-gray-900">142</td>
                <td className="px-6 py-4 text-gray-900">31.1%</td>
                <td className="px-6 py-4 font-medium text-gray-900">$18,450</td>
                <td className="px-6 py-4 text-green-600 font-medium">342%</td>
              </tr>
              <tr className="hover:bg-gray-50">
                <td className="px-6 py-4 font-medium text-gray-900">Urgency Messages</td>
                <td className="px-6 py-4 text-gray-900">387</td>
                <td className="px-6 py-4 text-gray-900">98</td>
                <td className="px-6 py-4 text-gray-900">25.3%</td>
                <td className="px-6 py-4 font-medium text-gray-900">$12,200</td>
                <td className="px-6 py-4 text-green-600 font-medium">289%</td>
              </tr>
              <tr className="hover:bg-gray-50">
                <td className="px-6 py-4 font-medium text-gray-900">Social Proof</td>
                <td className="px-6 py-4 text-gray-900">312</td>
                <td className="px-6 py-4 text-gray-900">87</td>
                <td className="px-6 py-4 text-gray-900">27.9%</td>
                <td className="px-6 py-4 font-medium text-gray-900">$8,650</td>
                <td className="px-6 py-4 text-green-600 font-medium">256%</td>
              </tr>
              <tr className="hover:bg-gray-50">
                <td className="px-6 py-4 font-medium text-gray-900">Exit Intent</td>
                <td className="px-6 py-4 text-gray-900">234</td>
                <td className="px-6 py-4 text-gray-900">56</td>
                <td className="px-6 py-4 text-gray-900">23.9%</td>
                <td className="px-6 py-4 font-medium text-gray-900">$5,450</td>
                <td className="px-6 py-4 text-green-600 font-medium">198%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* AI Model Performance */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-6">AI Model Performance Metrics</h2>
        <div className="grid  md:grid-cols-3 gap-6">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Prediction Accuracy</span>
              <span className="text-sm font-medium text-gray-900">87.3%</span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-green-500 rounded-full" style={{ width: '87.3%' }} />
            </div>
            <p className="text-xs text-gray-500 mt-1">Model correctly predicts outcomes 87.3% of the time</p>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Intervention Efficiency</span>
              <span className="text-sm font-medium text-gray-900">91.4%</span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-purple-500 rounded-full" style={{ width: '91.4%' }} />
            </div>
            <p className="text-xs text-gray-500 mt-1">Percentage of interventions that lead to conversions</p>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">False Positive Rate</span>
              <span className="text-sm font-medium text-gray-900">12.7%</span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-orange-500 rounded-full" style={{ width: '12.7%' }} />
            </div>
            <p className="text-xs text-gray-500 mt-1">Interventions shown to users who would have converted anyway</p>
          </div>
        </div>
      </div>
    </div>
  );
}
