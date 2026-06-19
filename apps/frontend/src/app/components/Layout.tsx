import { Outlet, Link, useLocation } from "react-router";
import {
  LayoutDashboard, Activity, Brain, Zap, BarChart3, Settings, Bell,
  Menu, X, DollarSign, Users, GitBranch, FlaskConical, Plug, Cpu,
  ChevronRight, Wifi
} from "lucide-react";
import { useState } from "react";

const navSections = [
  {
    label: "MONITOR",
    items: [
      { name: "Dashboard", href: "/", icon: LayoutDashboard },
      { name: "Live Sessions", href: "/live-sessions", icon: Activity },
    ],
  },
  {
    label: "INTELLIGENCE",
    items: [
      { name: "AI Decisions", href: "/ai-decisions", icon: Brain },
      { name: "Revenue Intelligence", href: "/revenue", icon: DollarSign },
      { name: "Customer Segments", href: "/segments", icon: Users },
    ],
  },
  {
    label: "TOOLS",
    items: [
      { name: "Interventions", href: "/interventions", icon: Zap },
      { name: "Playbooks", href: "/playbooks", icon: GitBranch },
      { name: "A/B Testing", href: "/ab-testing", icon: FlaskConical },
    ],
  },
  {
    label: "ANALYTICS",
    items: [
      { name: "Analytics", href: "/analytics", icon: BarChart3 },
    ],
  },
  {
    label: "SYSTEM",
    items: [
      { name: "Integrations", href: "/integrations", icon: Plug },
      { name: "Alerts", href: "/alerts", icon: Bell },
      { name: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

function isActive(href: string, pathname: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function Layout() {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const activeAlertCount = 3;

  return (
    <div className="min-h-screen bg-background flex">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 h-full z-50 flex flex-col transition-transform duration-300 lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{
          width: "220px",
          backgroundColor: "var(--sidebar)",
          borderRight: "1px solid var(--sidebar-border)",
        }}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-4 py-4 border-b" style={{ borderColor: "var(--sidebar-border)" }}>
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, #00d4a8 0%, #6366f1 100%)" }}>
              <Zap className="w-4 h-4 text-black" />
            </div>
            <div>
              <span className="font-semibold text-sm tracking-tight" style={{ color: "var(--sidebar-accent-foreground)" }}>
                CartRevive
              </span>
              <div className="flex items-center gap-1 mt-0.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[10px] font-medium" style={{ color: "#00d4a8" }}>LIVE</span>
              </div>
            </div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1 rounded"
            style={{ color: "var(--sidebar-foreground)" }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
          {navSections.map((section) => (
            <div key={section.label}>
              <p
                className="px-2 mb-1 text-[10px] font-semibold tracking-widest uppercase"
                style={{ color: "var(--sidebar-foreground)", opacity: 0.5 }}
              >
                {section.label}
              </p>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const active = isActive(item.href, location.pathname);
                  return (
                    <Link
                      key={item.name}
                      to={item.href}
                      onClick={() => setSidebarOpen(false)}
                      className="flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-all duration-150 group relative"
                      style={{
                        backgroundColor: active ? "var(--sidebar-accent)" : "transparent",
                        color: active ? "var(--sidebar-accent-foreground)" : "var(--sidebar-foreground)",
                      }}
                      onMouseEnter={(e) => {
                        if (!active) {
                          (e.currentTarget as HTMLElement).style.backgroundColor = "var(--sidebar-accent)";
                          (e.currentTarget as HTMLElement).style.color = "var(--sidebar-accent-foreground)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!active) {
                          (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                          (e.currentTarget as HTMLElement).style.color = "var(--sidebar-foreground)";
                        }
                      }}
                    >
                      {active && (
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-full" style={{ backgroundColor: "var(--primary)" }} />
                      )}
                      <item.icon
                        className="w-4 h-4 shrink-0"
                        style={{ color: active ? "var(--primary)" : "inherit" }}
                      />
                      <span className="font-medium truncate">{item.name}</span>
                      {item.href === "/alerts" && activeAlertCount > 0 && (
                        <span
                          className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: "#ef4444", color: "#fff" }}
                        >
                          {activeAlertCount}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* System status */}
        <div className="px-4 py-3 border-t" style={{ borderColor: "var(--sidebar-border)" }}>
          <div className="flex items-center gap-2 mb-3">
            <Wifi className="w-3 h-3" style={{ color: "#00d4a8" }} />
            <span className="text-[11px]" style={{ color: "var(--sidebar-foreground)" }}>
              Tracker <span style={{ color: "#00d4a8" }}>active</span> · 247 sessions
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
              style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff" }}
            >
              JD
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate" style={{ color: "var(--sidebar-accent-foreground)" }}>John Doe</p>
              <p className="text-[11px] truncate" style={{ color: "var(--sidebar-foreground)" }}>Store Owner</p>
            </div>
            <ChevronRight className="w-3 h-3 shrink-0" style={{ color: "var(--sidebar-foreground)" }} />
          </div>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0" style={{ marginLeft: "0px" }}>
        {/* Mobile header */}
        <header
          className="lg:hidden sticky top-0 z-30 px-4 py-3 flex items-center justify-between border-b"
          style={{ backgroundColor: "var(--sidebar)", borderColor: "var(--sidebar-border)" }}
        >
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1.5 rounded-md"
            style={{ color: "var(--sidebar-foreground)" }}
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, #00d4a8, #6366f1)" }}>
              <Zap className="w-3.5 h-3.5 text-black" />
            </div>
            <span className="font-semibold text-sm" style={{ color: "var(--sidebar-accent-foreground)" }}>CartRevive</span>
          </div>
          <div className="w-8" />
        </header>

        {/* Content with sidebar offset on desktop */}
        <main className="flex-1 lg:ml-[220px] p-4 lg:p-6 min-h-screen">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
