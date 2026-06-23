import { Zap, X, Wifi } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { UserTicket } from '../custom/userTicket';

const Logo = ({
  setSidebarOpen,
}: {
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) => {
  return (
    <div
      className="flex items-center justify-between px-4 py-4 border-b"
      style={{ borderColor: 'var(--sidebar-border)' }}
    >
      <div className="flex items-center gap-2.5">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{
            background: 'linear-gradient(135deg, #00d4a8 0%, #6366f1 100%)',
          }}
        >
          <Zap className="w-4 h-4 text-black" />
        </div>
        <div>
          <span
            className="font-semibold text-sm tracking-tight"
            style={{ color: 'var(--sidebar-accent-foreground)' }}
          >
            CartRevive
          </span>
          <div className="flex items-center gap-1 mt-0.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span
              className="text-[10px] font-medium"
              style={{ color: '#00d4a8' }}
            >
              LIVE
            </span>
          </div>
        </div>
      </div>
      <button
        onClick={() => setSidebarOpen(false)}
        className="lg:hidden p-1 rounded"
        style={{ color: 'var(--sidebar-foreground)' }}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
function isActive(href: string, pathname: string) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}
export type NavItem = {
  name: string;
  href: string;
  icon: React.FC<{ className?: string; style?: React.CSSProperties }>;
  count?: number;
};
export type NavSection = {
  label: string;
  items: NavItem[];
}[];
const NavSections: React.FC<{ menuList: NavSection }> = ({ menuList }) => {
  const location = useLocation();
  return (
    <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
      {menuList.map((section) => (
        <div key={section.label}>
          <p
            className="px-2 mb-1 text-[10px] font-semibold tracking-widest uppercase"
            style={{ color: 'var(--sidebar-foreground)', opacity: 0.5 }}
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
                  //onClick={() => setSidebarOpen(false)}
                  className="flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-all duration-150 group relative"
                  style={{
                    backgroundColor: active
                      ? 'var(--sidebar-accent)'
                      : 'transparent',
                    color: active
                      ? 'var(--sidebar-accent-foreground)'
                      : 'var(--sidebar-foreground)',
                  }}
                  onMouseEnter={(e) => {
                    if (!active) {
                      (e.currentTarget as HTMLElement).style.backgroundColor =
                        'var(--sidebar-accent)';
                      (e.currentTarget as HTMLElement).style.color =
                        'var(--sidebar-accent-foreground)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active) {
                      (e.currentTarget as HTMLElement).style.backgroundColor =
                        'transparent';
                      (e.currentTarget as HTMLElement).style.color =
                        'var(--sidebar-foreground)';
                    }
                  }}
                >
                  {active && (
                    <div
                      className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-full"
                      style={{ backgroundColor: 'var(--primary)' }}
                    />
                  )}
                  <item.icon
                    className="w-4 h-4 shrink-0"
                    style={{ color: active ? 'var(--primary)' : 'inherit' }}
                  />
                  <span className="font-medium truncate">{item.name}</span>
                  {item.count && item.count > 0 && (
                    <span
                      className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                      style={{ backgroundColor: '#ef4444', color: '#fff' }}
                    >
                      {item.count}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
};

export const SideBar: React.FC<{
  menuList: NavSection;
}> = ({ menuList }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  return (
    <aside
      className={`fixed top-0 left-0 h-full z-50 flex flex-col transition-transform duration-300 lg:translate-x-0 ${
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      }`}
      style={{
        width: '220px',
        backgroundColor: 'var(--sidebar)',
        borderRight: '1px solid var(--sidebar-border)',
      }}
    >
      {/* Logo */}
      <Logo setSidebarOpen={setSidebarOpen} />
      {/* Nav */}
      <NavSections menuList={menuList} />

      {/* System status */}
      <div
        className="px-4 py-3 border-t"
        style={{ borderColor: 'var(--sidebar-border)' }}
      >
        <div className="flex items-center gap-2 mb-3">
          <Wifi className="w-3 h-3" style={{ color: '#00d4a8' }} />
          <span
            className="text-[11px]"
            style={{ color: 'var(--sidebar-foreground)' }}
          >
            Tracker <span style={{ color: '#00d4a8' }}>active</span>
          </span>
        </div>
        <UserTicket
          name="John Doe"
          shortMsg="Store Owner"
          avatarUrl={undefined}
        />
      </div>
    </aside>
  );
};
