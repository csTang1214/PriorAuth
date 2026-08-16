import { NavLink, Route, Routes } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import NewCase from "./pages/NewCase";
import DraftReview from "./pages/DraftReview";
import CaseTracking from "./pages/CaseTracking";
import PolicyLibrary from "./pages/PolicyLibrary";
import Settings from "./pages/Settings";
import "./App.css";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/tracking", label: "Case Tracking" },
  { to: "/policy-library", label: "Policy Library" },
  { to: "/settings", label: "Settings" },
];

export default function App() {
  return (
    <div className="app-shell">
      <nav className="sidebar">
        <div className="sidebar-title">Prior Auth Assistant</div>
        <ul>
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink to={item.to} end={item.end} className={({ isActive }) => (isActive ? "active" : "")}>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="sidebar-footer">Prototype build — no data leaves this machine</div>
      </nav>
      <main className="content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/new-case" element={<NewCase />} />
          <Route path="/cases/:id/review" element={<DraftReview />} />
          <Route path="/tracking" element={<CaseTracking />} />
          <Route path="/policy-library" element={<PolicyLibrary />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
