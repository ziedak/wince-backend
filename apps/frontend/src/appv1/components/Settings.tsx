import { Copy, Check, Store, Bell, Users, Code } from 'lucide-react';
import { useState } from 'react';

export function Settings() {
  const [copied, setCopied] = useState(false);
  const trackingCode = `<script>
  (function() {
    var s = document.createElement('script');
    s.src = 'https://cdn.cartrevive.com/tracker.js';
    s.async = true;
    s.dataset.storeId = 'store_abc123xyz';
    document.head.appendChild(s);
  })();
</script>`;

  const handleCopy = () => {
    navigator.clipboard.writeText(trackingCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-semibold text-gray-900 mb-2">Settings</h1>
        <p className="text-gray-600">
          Configure your store integrations and preferences
        </p>
      </div>

      {/* Tracker Installation */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center">
            <Code className="w-5 h-5 text-purple-600" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">
              Tracker Installation
            </h2>
            <p className="text-sm text-gray-600">
              Add this code to your website's &lt;head&gt; section
            </p>
          </div>
        </div>
        <div className="relative">
          <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm">
            <code>{trackingCode}</code>
          </pre>
          <button
            onClick={handleCopy}
            className="absolute top-4 right-4 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors flex items-center gap-2 text-sm"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                Copy
              </>
            )}
          </button>
        </div>
        <div className="mt-4 flex items-center gap-2 text-sm">
          <div className="w-2 h-2 bg-green-500 rounded-full" />
          <span className="text-gray-700">
            Tracker is active and receiving data
          </span>
        </div>
      </div>

      {/* Store Integrations */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-start gap-3 mb-6">
          <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
            <Store className="w-5 h-5 text-blue-600" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">
              Store Integrations
            </h2>
            <p className="text-sm text-gray-600">
              Connect your e-commerce platform
            </p>
          </div>
        </div>
        <div className="grid  md:grid-cols-2 gap-4">
          <div className="border border-gray-200 rounded-lg p-4 hover:border-purple-300 transition-colors cursor-pointer">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-linear-to-br from-green-400 to-green-600 rounded-lg flex items-center justify-center text-white font-semibold">
                  S
                </div>
                <div>
                  <p className="font-medium text-gray-900">Shopify</p>
                  <p className="text-xs text-gray-500">Connected</p>
                </div>
              </div>
              <div className="w-2 h-2 bg-green-500 rounded-full" />
            </div>
            <p className="text-sm text-gray-600">mystore.myshopify.com</p>
          </div>
          <div className="border border-gray-200 rounded-lg p-4 hover:border-purple-300 transition-colors cursor-pointer">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-linear-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center text-white font-semibold">
                  W
                </div>
                <div>
                  <p className="font-medium text-gray-900">WooCommerce</p>
                  <p className="text-xs text-gray-500">Not connected</p>
                </div>
              </div>
            </div>
            <button className="text-sm text-purple-600 hover:text-purple-700 font-medium">
              Connect now →
            </button>
          </div>
          <div className="border border-gray-200 rounded-lg p-4 hover:border-purple-300 transition-colors cursor-pointer">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-linear-to-br from-orange-400 to-red-500 rounded-lg flex items-center justify-center text-white font-semibold">
                  M
                </div>
                <div>
                  <p className="font-medium text-gray-900">Magento</p>
                  <p className="text-xs text-gray-500">Not connected</p>
                </div>
              </div>
            </div>
            <button className="text-sm text-purple-600 hover:text-purple-700 font-medium">
              Connect now →
            </button>
          </div>
          <div className="border border-gray-200 rounded-lg p-4 hover:border-purple-300 transition-colors cursor-pointer">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-linear-to-br from-gray-700 to-gray-900 rounded-lg flex items-center justify-center text-white font-semibold">
                  B
                </div>
                <div>
                  <p className="font-medium text-gray-900">BigCommerce</p>
                  <p className="text-xs text-gray-500">Not connected</p>
                </div>
              </div>
            </div>
            <button className="text-sm text-purple-600 hover:text-purple-700 font-medium">
              Connect now →
            </button>
          </div>
        </div>
      </div>

      {/* Notification Settings */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-start gap-3 mb-6">
          <div className="w-10 h-10 bg-yellow-50 rounded-lg flex items-center justify-center">
            <Bell className="w-5 h-5 text-yellow-600" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">
              Notification Channels
            </h2>
            <p className="text-sm text-gray-600">
              Choose how you want to receive alerts
            </p>
          </div>
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center gap-3">
              <input type="checkbox" defaultChecked className="rounded" />
              <div>
                <p className="font-medium text-gray-900">Email Notifications</p>
                <p className="text-sm text-gray-600">john.doe@example.com</p>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center gap-3">
              <input type="checkbox" defaultChecked className="rounded" />
              <div>
                <p className="font-medium text-gray-900">Slack Integration</p>
                <p className="text-sm text-gray-600">#cart-recovery channel</p>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center gap-3">
              <input type="checkbox" className="rounded" />
              <div>
                <p className="font-medium text-gray-900">SMS Alerts</p>
                <p className="text-sm text-gray-600">
                  For critical alerts only
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center gap-3">
              <input type="checkbox" className="rounded" />
              <div>
                <p className="font-medium text-gray-900">Webhook</p>
                <p className="text-sm text-gray-600">
                  Send events to your endpoint
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Team Permissions */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-start gap-3 mb-6">
          <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center">
            <Users className="w-5 h-5 text-green-600" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">
              Team Members
            </h2>
            <p className="text-sm text-gray-600">
              Manage team access and permissions
            </p>
          </div>
          <button className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm font-medium">
            Invite Member
          </button>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-linear-to-br from-blue-500 to-purple-500 rounded-full flex items-center justify-center text-white font-semibold">
                JD
              </div>
              <div>
                <p className="font-medium text-gray-900">John Doe</p>
                <p className="text-sm text-gray-600">john.doe@example.com</p>
              </div>
            </div>
            <span className="px-3 py-1 bg-purple-50 text-purple-700 rounded-full text-sm font-medium">
              Owner
            </span>
          </div>
          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-linear-to-br from-green-500 to-teal-500 rounded-full flex items-center justify-center text-white font-semibold">
                SM
              </div>
              <div>
                <p className="font-medium text-gray-900">Sarah Miller</p>
                <p className="text-sm text-gray-600">sarah.m@example.com</p>
              </div>
            </div>
            <span className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-sm font-medium">
              Admin
            </span>
          </div>
          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-linear-to-br from-orange-500 to-red-500 rounded-full flex items-center justify-center text-white font-semibold">
                MJ
              </div>
              <div>
                <p className="font-medium text-gray-900">Mike Johnson</p>
                <p className="text-sm text-gray-600">mike.j@example.com</p>
              </div>
            </div>
            <span className="px-3 py-1 bg-gray-50 text-gray-700 rounded-full text-sm font-medium">
              Viewer
            </span>
          </div>
        </div>
      </div>

      {/* General Settings */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-6">
          General Settings
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Store Name
            </label>
            <input
              type="text"
              defaultValue="My Store"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Timezone
            </label>
            <select className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent">
              <option>Pacific Time (PT)</option>
              <option>Mountain Time (MT)</option>
              <option>Central Time (CT)</option>
              <option>Eastern Time (ET)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Currency
            </label>
            <select className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent">
              <option>USD - US Dollar</option>
              <option>EUR - Euro</option>
              <option>GBP - British Pound</option>
              <option>CAD - Canadian Dollar</option>
            </select>
          </div>
        </div>
        <div className="mt-6 pt-6 border-t border-gray-200">
          <button className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors">
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
