// frontend/src/components/Layout/VisitorLayout.jsx
import { useState, useEffect } from "react";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  PlusCircle,
  History,
  User,
  LogOut,
  Sun,
  Moon,
  Menu,
  X,
  ShieldCheck,
  Building2,
} from "lucide-react";
import BrandLogo from "../BrandLogo";
import useTheme from "../../context/ThemeContext";
import toast from "react-hot-toast";

function TricolorBar() {
  return (
    <div aria-hidden="true" className="w-full flex h-1">
      <span className="flex-1 bg-[#FF9933]" />
      <span className="flex-1 bg-white" />
      <span className="flex-1 bg-[#138808]" />
    </div>
  );
}

export default function VisitorLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [visitor, setVisitor] = useState(() => {
    try {
      const stored = localStorage.getItem("vms_visitor_data");
      if (stored) return JSON.parse(stored);
      const token =
        sessionStorage.getItem("vms_visitor_token") ||
        localStorage.getItem("vms_visitor_token");
      if (token) {
        const payload = JSON.parse(atob(token.split(".")[1]));
        return {
          full_name: payload.visitor_name || "Visitor",
          phone: payload.visitor_phone || "",
          email: payload.visitor_email || "",
          company_name: payload.company_name || "",
        };
      }
    } catch {
      // Fallback
    }
    return { full_name: "Visitor" };
  });

  // Listen for storage updates (e.g. after profile save)
  useEffect(() => {
    const handleStorage = () => {
      try {
        const stored = localStorage.getItem("vms_visitor_data");
        if (stored) setVisitor(JSON.parse(stored));
      } catch {}
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const handleLogout = () => {
    sessionStorage.removeItem("vms_visitor_token");
    localStorage.removeItem("vms_visitor_token");
    localStorage.removeItem("vms_visitor_data");
    toast.success("Logged out successfully.");
    navigate("/public-request", { replace: true });
  };

  const navLinks = [
    { to: "/visitor/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/visitor/new-request", label: "Book Visit", icon: PlusCircle },
    { to: "/visitor/history", label: "My Visits & Passes", icon: History },
    { to: "/visitor/profile", label: "My Profile", icon: User },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-bg-primary text-text">
      {/* ── Top Header ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-bg-secondary border-b border-border shadow-xs">
        <TricolorBar />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Left: Brand & Title */}
          <div className="flex items-center gap-3.5">
            <NavLink to="/visitor/dashboard" className="flex items-center gap-2">
              <BrandLogo height={32} />
            </NavLink>
            <div className="h-6 w-px bg-border hidden sm:block" />
            <div className="hidden sm:block">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-loud tracking-tight">
                  Visitor Portal
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-mixed-bg text-accent flex items-center gap-1">
                  <ShieldCheck size={11} /> Verified
                </span>
              </div>
              <p className="text-[11px] text-faint">
                Odisha Hydro Power Corporation Ltd.
              </p>
            </div>
          </div>

          {/* Center: Desktop Navigation Links */}
          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold tracking-wide transition-all ${
                    isActive
                      ? "bg-accent/10 text-accent font-bold"
                      : "text-muted hover:text-loud hover:bg-surface-hover"
                  }`
                }
              >
                <Icon size={15} />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>

          {/* Right: Controls + Profile + Logout */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted hover:text-loud hover:bg-surface-hover transition-colors"
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            {/* Visitor Chip */}
            <div className="hidden lg:flex items-center gap-2.5 pl-2 border-l border-border">
              <div className="w-8 h-8 rounded-full bg-accent/10 border border-accent/25 flex items-center justify-center text-accent font-bold text-xs">
                {visitor.full_name ? visitor.full_name.charAt(0).toUpperCase() : "V"}
              </div>
              <div className="text-left leading-tight">
                <p className="text-xs font-bold text-loud max-w-[120px] truncate">
                  {visitor.full_name || "Visitor"}
                </p>
                <p className="text-[10px] text-faint">
                  {visitor.company_name || visitor.phone || "Public Visitor"}
                </p>
              </div>
            </div>

            {/* Logout Button */}
            <button
              onClick={handleLogout}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted hover:text-error hover:bg-danger-bg transition-colors border border-border"
              title="Log out of visitor portal"
            >
              <LogOut size={14} />
              <span>Logout</span>
            </button>

            {/* Mobile Hamburger */}
            <button
              onClick={() => setMobileMenuOpen((o) => !o)}
              className="md:hidden p-2 rounded-lg text-muted hover:text-loud hover:bg-surface-hover transition-colors"
              aria-label="Toggle Navigation"
            >
              {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {/* ── Mobile Dropdown Menu ─────────────────────────────────────────── */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-border bg-bg-secondary px-4 pt-2 pb-4 space-y-1 animate-fade-in shadow-lg">
            <div className="flex items-center gap-3 px-3 py-2.5 mb-2 bg-mixed-bg/50 rounded-lg">
              <div className="w-8 h-8 rounded-full bg-accent text-white flex items-center justify-center text-xs font-bold">
                {visitor.full_name ? visitor.full_name.charAt(0).toUpperCase() : "V"}
              </div>
              <div>
                <p className="text-xs font-bold text-loud">{visitor.full_name}</p>
                <p className="text-[10px] text-faint">{visitor.phone || visitor.email}</p>
              </div>
            </div>
            {navLinks.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-accent text-white font-semibold"
                      : "text-muted hover:text-loud hover:bg-surface-hover"
                  }`
                }
              >
                <Icon size={16} />
                <span>{label}</span>
              </NavLink>
            ))}
            <div className="pt-2 border-t border-border mt-2">
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-error hover:bg-danger-bg transition-colors"
              >
                <LogOut size={16} />
                <span>Logout</span>
              </button>
            </div>
          </div>
        )}
      </header>

      {/* ── Main Content Area ──────────────────────────────────────────────── */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <Outlet context={{ visitor, setVisitor }} />
      </main>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer className="border-t border-border bg-bg-secondary py-5 text-center text-xs text-faint">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <p>© {new Date().getFullYear()} Odisha Hydro Power Corporation Ltd. All Rights Reserved.</p>
          <div className="flex items-center gap-3 text-[11px]">
            <span className="flex items-center gap-1">
              <Building2 size={12} className="text-accent" /> Security Protocol 2.0
            </span>
            <span>•</span>
            <span>256-bit Encrypted Session</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

