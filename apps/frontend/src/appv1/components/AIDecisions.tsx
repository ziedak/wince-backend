import { Brain, TrendingUp, TrendingDown, CheckCircle, XCircle, Clock, ChevronDown, ChevronUp } from "lucide-react";
import { mockAIDecisions } from "../lib/mockData";
import { useState } from "react";
import { Link } from "react-router";

export function AIDecisions() {
  const [expandedDecision, setExpandedDecision] = useState<string | null>(null);

  const stats = {
    totalDecisions: mockAIDecisions.length,
    avgConfidence: (mockAIDecisions.reduce((sum, d) => sum + d.confidence, 0) / mockAIDecisions.length * 100).toFixed(1),
    converted: mockAIDecisions.filter(d => d.actualOutcome === "converted").length,
    pending: mockAIDecisions.filter(d => d.actualOutcome === "pending").length,
  };

  const getOutcomeColor = (outcome?: string) => {
    switch (outcome) {
      case "converted":
        return "bg-green-50 text-green-700 border-green-200";
      case "abandoned":
        return "bg-red-50 text-red-700 border-red-200";
      case "pending":
        return "bg-blue-50 text-blue-700 border-blue-200";
      default:
        return "bg-gray-50 text-gray-700 border-gray-200";
    }
  };

  const getOutcomeIcon = (outcome?: string) => {
    switch (outcome) {
      case "converted":
        return CheckCircle;
      case "abandoned":
        return XCircle;
      case "pending":
        return Clock;
      default:
        return Clock;
    }
  };

  const getPredictedOutcomeColor = (outcome: string) => {
    switch (outcome) {
      case "convert":
        return "text-green-600";
      case "abandon":
        return "text-red-600";
      default:
        return "text-yellow-600";
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-semibold text-gray-900 mb-2">AI Decision Center</h1>
        <p className="text-gray-600">Understand and monitor AI-driven intervention decisions</p>
      </div>

      {/* Stats */}
      <div className="grid  md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center">
              <Brain className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Total Decisions</p>
              <p className="text-2xl font-semibold text-gray-900">{stats.totalDecisions}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Avg Confidence</p>
              <p className="text-2xl font-semibold text-gray-900">{stats.avgConfidence}%</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Converted</p>
              <p className="text-2xl font-semibold text-gray-900">{stats.converted}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
              <Clock className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Pending</p>
              <p className="text-2xl font-semibold text-gray-900">{stats.pending}</p>
            </div>
          </div>
        </div>
      </div>

      {/* AI Model Performance */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Model Performance</h2>
        <div className="grid  md:grid-cols-3 gap-6">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Accuracy</span>
              <span className="text-sm font-medium text-gray-900">87.3%</span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-green-500 rounded-full" style={{ width: '87.3%' }} />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Precision</span>
              <span className="text-sm font-medium text-gray-900">82.1%</span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full" style={{ width: '82.1%' }} />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Recall</span>
              <span className="text-sm font-medium text-gray-900">91.4%</span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-purple-500 rounded-full" style={{ width: '91.4%' }} />
            </div>
          </div>
        </div>
      </div>

      {/* Decision List */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Recent Decisions</h2>
        </div>
        <div className="divide-y divide-gray-200">
          {mockAIDecisions.map((decision) => {
            const isExpanded = expandedDecision === decision.id;
            const OutcomeIcon = getOutcomeIcon(decision.actualOutcome);

            return (
              <div key={decision.id} className="p-6">
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-start gap-3 mb-3">
                      <div className="w-10 h-10 bg-linear-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center text-white font-semibold text-sm">
                        {decision.visitorName.split(' ').map(n => n[0]).join('')}
                      </div>
                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <Link 
                            to={`/journey/${decision.visitorId}`}
                            className="font-medium text-gray-900 hover:text-purple-600 transition-colors"
                          >
                            {decision.visitorName}
                          </Link>
                          <span className="text-sm text-gray-500">
                            {new Intl.DateTimeFormat('en-US', {
                              month: 'short',
                              day: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                            }).format(decision.timestamp)}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-purple-50 text-purple-700">
                            {decision.intervention}
                          </span>
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${getOutcomeColor(decision.actualOutcome)}`}>
                            <OutcomeIcon className="w-3 h-3 mr-1" />
                            {decision.actualOutcome || "Processing"}
                          </span>
                          {decision.revenue && (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700">
                              ${decision.revenue.toFixed(2)} revenue
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-sm text-gray-600 mb-1">Confidence</p>
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-purple-500 rounded-full"
                            style={{ width: `${decision.confidence * 100}%` }}
                          />
                        </div>
                        <span className="text-sm font-semibold text-gray-900">
                          {(decision.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-gray-600 mb-1">Predicted</p>
                      <p className={`text-sm font-semibold capitalize ${getPredictedOutcomeColor(decision.predictedOutcome)}`}>
                        {decision.predictedOutcome}
                      </p>
                    </div>
                    <button
                      onClick={() => setExpandedDecision(isExpanded ? null : decision.id)}
                      className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      {isExpanded ? (
                        <ChevronUp className="w-5 h-5 text-gray-600" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-gray-600" />
                      )}
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-4 pl-13 lg:pl-13">
                    <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                      <h4 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
                        <Brain className="w-4 h-4 text-purple-600" />
                        AI Reasoning
                      </h4>
                      <p className="text-sm text-gray-700 leading-relaxed">{decision.reasoning}</p>
                    </div>
                    <div className="mt-4 flex gap-2">
                      <Link
                        to={`/journey/${decision.visitorId}`}
                        className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm font-medium"
                      >
                        View Customer Journey
                      </Link>
                      <button className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium">
                        Manual Override
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
