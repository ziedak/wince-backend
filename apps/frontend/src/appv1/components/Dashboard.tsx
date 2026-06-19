import { TrendingUp, TrendingDown, DollarSign, ShoppingCart, Users, Zap, AlertCircle } from "lucide-react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { revenueRecoveryData, interventionPerformanceData, mockVisitors } from "../lib/mockData";
import { Link } from "react-router";

interface KPICardProps {
  title: string;
  value: string;
  change: number;
  icon: React.ElementType;
  subtitle?: string;
}

function KPICard({ title, value, change, icon: Icon, subtitle }: KPICardProps) {
  const isPositive = change >= 0;
  
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm text-gray-600 mb-1">{title}</p>
          <p className="text-3xl font-semibold text-gray-900 mb-1">{value}</p>
          {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
        </div>
        <div className="w-12 h-12 bg-purple-50 rounded-lg flex items-center justify-center">
          <Icon className="w-6 h-6 text-purple-600" />
        </div>
      </div>
      <div className="flex items-center gap-1 mt-4">
        {isPositive ? (
          <TrendingUp className="w-4 h-4 text-green-600" />
        ) : (
          <TrendingDown className="w-4 h-4 text-red-600" />
        )}
        <span className={`text-sm font-medium ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
          {isPositive ? '+' : ''}{change}%
        </span>
        <span className="text-sm text-gray-500 ml-1">vs last week</span>
      </div>
    </div>
  );
}

export function Dashboard() {
  const activeVisitors = mockVisitors.length;
  const revenueRecovered = 43250;
  const recoveryRate = 28.4;
  const aiLift = 42.3;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-semibold text-gray-900 mb-2">Dashboard</h1>
        <p className="text-gray-600">Real-time overview of your cart recovery performance</p>
      </div>

      {/* KPI Cards */}
      <div className="grid  md:grid-cols-2 lg:grid-cols-4 gap-6">
        <KPICard
          title="Revenue Recovered"
          value={`$${revenueRecovered.toLocaleString()}`}
          change={18.2}
          icon={DollarSign}
          subtitle="This month"
        />
        <KPICard
          title="Cart Recovery Rate"
          value={`${recoveryRate}%`}
          change={5.4}
          icon={ShoppingCart}
        />
        <KPICard
          title="Active Visitors"
          value={activeVisitors.toString()}
          change={-12.3}
          icon={Users}
          subtitle="Right now"
        />
        <KPICard
          title="AI Lift"
          value={`${aiLift}%`}
          change={8.7}
          icon={Zap}
          subtitle="Above baseline"
        />
      </div>

      {/* Charts Row */}
      <div className="grid  lg:grid-cols-2 gap-6">
        {/* Revenue Recovery Trend */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Revenue Recovery Trend</h2>
            <p className="text-sm text-gray-600">Recovered vs potential revenue</p>
          </div>
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

        {/* Intervention Performance */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Intervention Performance</h2>
            <p className="text-sm text-gray-600">Conversions by intervention type</p>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={interventionPerformanceData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" stroke="#9ca3af" fontSize={12} />
              <YAxis stroke="#9ca3af" fontSize={12} />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#fff', 
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  fontSize: '12px'
                }}
              />
              <Bar dataKey="conversions" fill="#8b5cf6" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Active Sessions Preview */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">High-Risk Sessions</h2>
              <p className="text-sm text-gray-600">Visitors with high abandonment probability</p>
            </div>
            <Link 
              to="/live-sessions"
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm font-medium"
            >
              View All
            </Link>
          </div>
        </div>
        <div className="divide-y divide-gray-200">
          {mockVisitors.filter(v => v.abandonmentProbability > 0.5).slice(0, 3).map((visitor) => (
            <Link 
              key={visitor.id}
              to={`/journey/${visitor.id}`}
              className="block p-6 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <p className="font-medium text-gray-900">{visitor.name}</p>
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700">
                      {(visitor.abandonmentProbability * 100).toFixed(0)}% risk
                    </span>
                    {visitor.interventionState === "triggered" && (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                        <Zap className="w-3 h-3 mr-1" />
                        Intervention active
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-sm text-gray-600">
                    <span>{visitor.currentPage}</span>
                    <span>•</span>
                    <span>${visitor.cartValue.toFixed(2)} in cart</span>
                    <span>•</span>
                    <span>{Math.floor(visitor.timeOnSite / 60)}m {visitor.timeOnSite % 60}s on site</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {visitor.frustrationScore > 0.5 && (
                    <div className="flex items-center gap-1 px-2 py-1 rounded bg-orange-50">
                      <AlertCircle className="w-4 h-4 text-orange-600" />
                      <span className="text-xs font-medium text-orange-700">Frustrated</span>
                    </div>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
