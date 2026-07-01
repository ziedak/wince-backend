import {
  Copy,
  Check,
  Store,
  Bell,
  Users,
  Code,
  Key,
  Globe,
  Shield,
  ChevronRight,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { useState } from 'react';

const TEAL = '#00d4a8';

const trackingCode = `<script>
  (function() {
    var s = document.createElement('script');
    s.src = 'https://cdn.cartrevive.com/tracker.js';
    s.async = true;
    s.dataset.storeId = 'store_abc123xyz';
    document.head.appendChild(s);
  })();
</script>`;

const settingsSections = [
  { id: 'tracker', icon: Code, label: 'Tracker & SDK' },
  { id: 'integrations', icon: Store, label: 'Store Integrations' },
  { id: 'notifications', icon: Bell, label: 'Notifications' },
  { id: 'team', icon: Users, label: 'Team & Permissions' },
  { id: 'general', icon: Globe, label: 'General' },
  { id: 'security', icon: Shield, label: 'Security & API' },
  { id: 'theme', icon: Key, label: 'Theme' },
];

export function Settings() {
  const [copied, setCopied] = useState(false);
  const [activeSection, setActiveSection] = useState('tracker');

  const handleCopy = () => {
    navigator.clipboard.writeText(trackingCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const { theme, setTheme, resolvedTheme } = useTheme();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Configure your store integrations, team, and preferences
        </p>
      </div>
      <div className="grid  lg:grid-cols-4 gap-4">
        {/* Sidebar nav */}
        <div className="bg-card border border-border rounded-lg p-2 h-fit">
          {settingsSections.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-xs font-medium transition-colors"
              style={{
                backgroundColor:
                  activeSection === s.id ? 'var(--accent)' : 'transparent',
                color:
                  activeSection === s.id
                    ? 'var(--accent-foreground)'
                    : 'var(--muted-foreground)',
              }}
            >
              <s.icon
                className="w-3.5 h-3.5 shrink-0"
                style={{ color: activeSection === s.id ? TEAL : 'inherit' }}
              />
              {s.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="lg:col-span-3 space-y-4">
          {activeSection === 'tracker' && (
            <div className="bg-card border border-border rounded-lg p-5">
              <h2 className="text-sm font-semibold text-foreground mb-1">
                Tracker Installation
              </h2>
              <p className="text-xs text-muted-foreground mb-4">
                Add this code to your website's &lt;head&gt; section to enable
                behavior tracking
              </p>
              <div className="relative">
                <pre
                  className="p-4 rounded-lg overflow-x-auto text-xs font-mono leading-relaxed"
                  style={{
                    backgroundColor: '#030710',
                    color: '#94a3b8',
                    border: '1px solid rgba(148,163,184,0.1)',
                  }}
                >
                  <code className="text-emerald-400">{trackingCode}</code>
                </pre>
                <button
                  onClick={handleCopy}
                  className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors"
                  style={{
                    backgroundColor: 'rgba(148,163,184,0.1)',
                    color: '#94a3b8',
                  }}
                >
                  {copied ? (
                    <>
                      <Check className="w-3 h-3" style={{ color: TEAL }} />{' '}
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" /> Copy
                    </>
                  )}
                </button>
              </div>
              <div className="flex items-center gap-2 mt-3 text-xs">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-foreground">
                  Tracker is <span style={{ color: TEAL }}>active</span> and
                  receiving data
                </span>
                <span className="text-muted-foreground font-mono">
                  · 4,821 events today
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3 mt-5">
                {[
                  { label: 'Store ID', value: 'store_abc123xyz' },
                  { label: 'Tracker Version', value: 'v3.4.2' },
                  { label: 'Data Region', value: 'US-West' },
                ].map((i) => (
                  <div
                    key={i.label}
                    className="p-3 rounded-lg border border-border bg-muted/40"
                  >
                    <p className="text-[11px] text-muted-foreground mb-1">
                      {i.label}
                    </p>
                    <p className="text-xs font-mono font-semibold text-foreground">
                      {i.value}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeSection === 'integrations' && (
            <div className="bg-card border border-border rounded-lg p-5">
              <h2 className="text-sm font-semibold text-foreground mb-1">
                Store Integrations
              </h2>
              <p className="text-xs text-muted-foreground mb-4">
                Connect your e-commerce platform to sync orders and customer
                data
              </p>
              <div className="grid  md:grid-cols-2 gap-3">
                {[
                  {
                    name: 'Shopify',
                    sub: 'mystore.myshopify.com',
                    connected: true,
                    color: '#96bf48',
                  },
                  {
                    name: 'WooCommerce',
                    sub: 'WordPress plugin',
                    connected: false,
                    color: '#7f54b3',
                  },
                  {
                    name: 'Magento',
                    sub: 'Adobe Commerce',
                    connected: false,
                    color: '#f26322',
                  },
                  {
                    name: 'BigCommerce',
                    sub: 'Cloud e-commerce',
                    connected: false,
                    color: '#34313f',
                  },
                ].map((i) => (
                  <div
                    key={i.name}
                    className="flex items-center justify-between p-4 border border-border rounded-lg hover:border-primary/30 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white shrink-0"
                        style={{ backgroundColor: i.color }}
                      >
                        {i.name[0]}
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-foreground">
                          {i.name}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {i.sub}
                        </p>
                      </div>
                    </div>
                    {i.connected ? (
                      <div className="flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        <span
                          className="text-[11px] font-medium"
                          style={{ color: TEAL }}
                        >
                          Connected
                        </span>
                      </div>
                    ) : (
                      <button
                        className="text-[11px] font-medium hover:underline"
                        style={{ color: TEAL }}
                      >
                        Connect →
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeSection === 'notifications' && (
            <div className="bg-card border border-border rounded-lg p-5">
              <h2 className="text-sm font-semibold text-foreground mb-1">
                Notification Channels
              </h2>
              <p className="text-xs text-muted-foreground mb-4">
                Choose how you want to receive alerts and reports
              </p>
              <div className="space-y-2">
                {[
                  {
                    label: 'Email Notifications',
                    sub: 'john.doe@example.com',
                    enabled: true,
                  },
                  {
                    label: 'Slack Integration',
                    sub: '#cart-recovery channel',
                    enabled: true,
                  },
                  {
                    label: 'SMS Alerts',
                    sub: 'For critical alerts only',
                    enabled: false,
                  },
                  {
                    label: 'Webhook',
                    sub: 'Send events to your endpoint',
                    enabled: false,
                  },
                  {
                    label: 'PagerDuty',
                    sub: 'On-call escalation',
                    enabled: false,
                  },
                ].map((n) => (
                  <div
                    key={n.label}
                    className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-accent/30 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <input
                          type="checkbox"
                          defaultChecked={n.enabled}
                          className="sr-only"
                          id={n.label}
                        />
                        <div
                          className="w-8 h-4.5 rounded-full cursor-pointer transition-colors flex items-center"
                          style={{
                            backgroundColor: n.enabled
                              ? TEAL
                              : 'rgba(148,163,184,0.15)',
                          }}
                        >
                          <div
                            className="w-3.5 h-3.5 rounded-full bg-white shadow mx-0.5 transition-transform"
                            style={{
                              transform: n.enabled
                                ? 'translateX(14px)'
                                : 'translateX(0)',
                            }}
                          />
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-foreground">
                          {n.label}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {n.sub}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeSection === 'team' && (
            <div className="bg-card border border-border rounded-lg p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    Team Members
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Manage team access and permissions
                  </p>
                </div>
                <button
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                  style={{ backgroundColor: TEAL, color: '#070d1b' }}
                >
                  Invite Member
                </button>
              </div>
              <div className="space-y-2">
                {[
                  {
                    name: 'John Doe',
                    email: 'john.doe@example.com',
                    role: 'Owner',
                    initials: 'JD',
                    gradient: 'from-indigo-500 to-purple-500',
                  },
                  {
                    name: 'Sarah Miller',
                    email: 'sarah.m@example.com',
                    role: 'Admin',
                    initials: 'SM',
                    gradient: 'from-emerald-500 to-teal-500',
                  },
                  {
                    name: 'Mike Johnson',
                    email: 'mike.j@example.com',
                    role: 'Viewer',
                    initials: 'MJ',
                    gradient: 'from-amber-500 to-orange-500',
                  },
                ].map((m) => (
                  <div
                    key={m.email}
                    className="flex items-center justify-between p-3 border border-border rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold text-white bg-linear-to-br ${m.gradient}`}
                      >
                        {m.initials}
                      </div>
                      <div>
                        <p className="text-xs font-medium text-foreground">
                          {m.name}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {m.email}
                        </p>
                      </div>
                    </div>
                    <span
                      className="px-2 py-0.5 rounded-full text-[11px] font-medium"
                      style={{
                        backgroundColor:
                          m.role === 'Owner'
                            ? `${TEAL}15`
                            : m.role === 'Admin'
                              ? 'rgba(99,102,241,0.15)'
                              : 'rgba(148,163,184,0.1)',
                        color:
                          m.role === 'Owner'
                            ? TEAL
                            : m.role === 'Admin'
                              ? '#6366f1'
                              : '#94a3b8',
                      }}
                    >
                      {m.role}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeSection === 'general' && (
            <div className="bg-card border border-border rounded-lg p-5">
              <h2 className="text-sm font-semibold text-foreground mb-4">
                General Settings
              </h2>
              <div className="space-y-4">
                {[
                  {
                    label: 'Store Name',
                    type: 'input',
                    value: 'My Awesome Store',
                  },
                  {
                    label: 'Timezone',
                    type: 'select',
                    options: [
                      'Pacific Time (PT)',
                      'Mountain Time (MT)',
                      'Central Time (CT)',
                      'Eastern Time (ET)',
                    ],
                  },
                  {
                    label: 'Currency',
                    type: 'select',
                    options: [
                      'USD - US Dollar',
                      'EUR - Euro',
                      'GBP - British Pound',
                      'CAD - Canadian Dollar',
                    ],
                  },
                ].map((f) => (
                  <div key={f.label}>
                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                      {f.label}
                    </label>
                    {f.type === 'input' ? (
                      <input
                        type="text"
                        defaultValue={f.value}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-muted text-foreground focus:outline-none focus:border-primary/50"
                      />
                    ) : (
                      <select className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-muted text-foreground focus:outline-none focus:border-primary/50">
                        {f.options?.map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </select>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-5 pt-4 border-t border-border">
                <button
                  className="px-4 py-2 rounded-lg text-xs font-semibold"
                  style={{ backgroundColor: TEAL, color: '#070d1b' }}
                >
                  Save Changes
                </button>
              </div>
            </div>
          )}

          {activeSection === 'security' && (
            <div className="bg-card border border-border rounded-lg p-5">
              <h2 className="text-sm font-semibold text-foreground mb-1">
                Security & API Keys
              </h2>
              <p className="text-xs text-muted-foreground mb-4">
                Manage API keys and security settings
              </p>
              <div className="space-y-3">
                {[
                  {
                    label: 'Live API Key',
                    value: 'cr_live_••••••••••••••••xYz9',
                    created: 'Jun 1, 2026',
                  },
                  {
                    label: 'Test API Key',
                    value: 'cr_test_••••••••••••••••aB12',
                    created: 'May 15, 2026',
                  },
                ].map((k) => (
                  <div
                    key={k.label}
                    className="p-3 border border-border rounded-lg"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-foreground">
                        {k.label}
                      </span>
                      <span className="text-[11px] text-muted-foreground font-mono">
                        Created {k.created}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-[11px] font-mono text-muted-foreground bg-muted/40 px-2 py-1 rounded">
                        {k.value}
                      </code>
                      <button className="p-1.5 rounded-lg hover:bg-accent transition-colors">
                        <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                      </button>
                      <button className="p-1.5 rounded-lg hover:bg-accent transition-colors">
                        <Key className="w-3.5 h-3.5 text-muted-foreground" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {activeSection === 'theme' && (
            <div className="bg-card border border-border rounded-lg p-5">
              <h2 className="text-sm font-semibold text-foreground mb-1">
                Theme Settings
              </h2>
              <p className="text-xs text-muted-foreground mb-4">
                Customize the appearance of your dashboard
              </p>
              <div className="space-y-3">
                {[
                  {
                    label: 'Color Scheme',
                    type: 'select',
                    options: ['System Default', 'Light', 'Dark'],
                    onchange: (value: string) => {
                      setTheme(
                        value === 'System Default'
                          ? 'system'
                          : value.toLowerCase(),
                      );
                    },
                  },
                  { label: 'Accent Color', type: 'input', value: '#00d4a8' },
                  {
                    label: 'Font Size',
                    type: 'select',
                    options: ['Small', 'Medium', 'Large'],
                  },
                ].map((s) => (
                  <div key={s.label}>
                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                      {s.label}
                    </label>
                    {s.type === 'input' ? (
                      <input
                        type="text"
                        defaultValue={s.value}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-muted text-foreground focus:outline-none focus:border-primary/50"
                      />
                    ) : (
                      <select onChange={(e) => s.onchange?.(e.target.value)} className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-muted text-foreground focus:outline-none focus:border-primary/50">
                        {s.options?.map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </select>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-5 pt-4 border-t border-border">
                <button
                  className="px-4 py-2 rounded-lg text-xs font-semibold"
                  style={{ backgroundColor: TEAL, color: '#070d1b' }}
                >
                  Save Theme
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
