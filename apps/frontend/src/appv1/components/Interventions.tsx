import {
  Plus,
  Pause,
  Play,
  Edit,
  BarChart3,
  Eye,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { mockInterventions } from '../lib/mockData';
import { useState } from 'react';

const interventionTypeColors = {
  discount: 'bg-green-50 text-green-700 border-green-200',
  urgency: 'bg-red-50 text-red-700 border-red-200',
  social_proof: 'bg-blue-50 text-blue-700 border-blue-200',
  reminder: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  recommendation: 'bg-purple-50 text-purple-700 border-purple-200',
};

export function Interventions() {
  const [showBuilder, setShowBuilder] = useState(false);

  const totalConversions = mockInterventions.reduce(
    (sum, i) => sum + i.conversions,
    0,
  );
  const totalRevenue = mockInterventions.reduce((sum, i) => sum + i.revenue, 0);
  const activeInterventions = mockInterventions.filter(
    (i) => i.status === 'active',
  ).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-gray-900 mb-2">
            Interventions
          </h1>
          <p className="text-gray-600">
            Create and manage cart recovery interventions
          </p>
        </div>
        <button
          onClick={() => setShowBuilder(true)}
          className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Create Intervention
        </button>
      </div>

      {/* Stats */}
      <div className="grid  md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Total Conversions</p>
              <p className="text-2xl font-semibold text-gray-900">
                {totalConversions}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Total Revenue</p>
              <p className="text-2xl font-semibold text-gray-900">
                ${totalRevenue.toLocaleString()}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
              <Zap className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Active Interventions</p>
              <p className="text-2xl font-semibold text-gray-900">
                {activeInterventions}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Intervention Builder Modal */}
      {showBuilder && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900">
                Create New Intervention
              </h2>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Intervention Name
                </label>
                <input
                  type="text"
                  placeholder="e.g., Summer Sale 20% Off"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Intervention Type
                </label>
                <select className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent">
                  <option value="discount">Discount</option>
                  <option value="urgency">Urgency Message</option>
                  <option value="social_proof">Social Proof</option>
                  <option value="reminder">Reminder</option>
                  <option value="recommendation">Product Recommendation</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Trigger Conditions
                </label>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="cart-value"
                      className="rounded"
                    />
                    <label
                      htmlFor="cart-value"
                      className="text-sm text-gray-700"
                    >
                      Cart value greater than $50
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="abandonment"
                      className="rounded"
                    />
                    <label
                      htmlFor="abandonment"
                      className="text-sm text-gray-700"
                    >
                      Abandonment probability &gt; 60%
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="time-on-site"
                      className="rounded"
                    />
                    <label
                      htmlFor="time-on-site"
                      className="text-sm text-gray-700"
                    >
                      Time on site &gt; 5 minutes
                    </label>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Message Template
                </label>
                <textarea
                  rows={4}
                  placeholder="Enter your intervention message..."
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Display Style
                </label>
                <select className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent">
                  <option value="popup">Popup Modal</option>
                  <option value="banner">Top Banner</option>
                  <option value="slide-in">Slide-in Panel</option>
                  <option value="inline">Inline Message</option>
                </select>
              </div>
            </div>
            <div className="p-6 border-t border-gray-200 flex gap-3 justify-end">
              <button
                onClick={() => setShowBuilder(false)}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => setShowBuilder(false)}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
              >
                Create Intervention
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Intervention List */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Intervention
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Performance
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Revenue
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {mockInterventions.map((intervention) => {
                const conversionRate = (
                  (intervention.conversions / intervention.views) *
                  100
                ).toFixed(1);

                return (
                  <tr
                    key={intervention.id}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-medium text-gray-900">
                          {intervention.name}
                        </p>
                        <p className="text-sm text-gray-500">
                          Last modified{' '}
                          {new Intl.DateTimeFormat('en-US', {
                            month: 'short',
                            day: 'numeric',
                          }).format(intervention.lastModified)}
                        </p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border capitalize ${interventionTypeColors[intervention.type]}`}
                      >
                        {intervention.type.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {intervention.status === 'active' ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700">
                          <div className="w-1.5 h-1.5 bg-green-500 rounded-full mr-1.5" />
                          Active
                        </span>
                      ) : intervention.status === 'paused' ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-gray-50 text-gray-700">
                          Paused
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                          Draft
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <Eye className="w-4 h-4 text-gray-400" />
                          <span className="text-sm text-gray-900">
                            {intervention.views} views
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <TrendingUp className="w-4 h-4 text-gray-400" />
                          <span className="text-sm text-gray-900">
                            {intervention.conversions} conversions (
                            {conversionRate}%)
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm font-medium text-gray-900">
                        ${intervention.revenue.toLocaleString()}
                      </p>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        {intervention.status === 'active' ? (
                          <button
                            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                            title="Pause"
                          >
                            <Pause className="w-4 h-4 text-gray-600" />
                          </button>
                        ) : (
                          <button
                            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                            title="Activate"
                          >
                            <Play className="w-4 h-4 text-gray-600" />
                          </button>
                        )}
                        <button
                          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                          title="Edit"
                        >
                          <Edit className="w-4 h-4 text-gray-600" />
                        </button>
                        <button
                          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                          title="Analytics"
                        >
                          <BarChart3 className="w-4 h-4 text-gray-600" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* A/B Testing Section */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          A/B Testing
        </h2>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center shrink-0">
              <BarChart3 className="w-4 h-4 text-blue-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-blue-900 mb-1">
                Running Test: Discount vs Urgency
              </p>
              <p className="text-sm text-blue-700 mb-3">
                Testing 15% discount intervention against limited stock urgency
                message for high-value carts
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white rounded-lg p-3 border border-blue-200">
                  <p className="text-xs text-gray-600 mb-1">
                    Variant A (Discount)
                  </p>
                  <p className="text-lg font-semibold text-gray-900">32.4%</p>
                  <p className="text-xs text-gray-500">Conversion rate</p>
                </div>
                <div className="bg-white rounded-lg p-3 border border-blue-200">
                  <p className="text-xs text-gray-600 mb-1">
                    Variant B (Urgency)
                  </p>
                  <p className="text-lg font-semibold text-gray-900">28.7%</p>
                  <p className="text-xs text-gray-500">Conversion rate</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
