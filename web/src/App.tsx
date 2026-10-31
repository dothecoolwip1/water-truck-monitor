import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import Login from './pages/Login';
import Dispatch from './pages/Dispatch';
import Jobs from './pages/Jobs';
import JobDetailPage from './pages/JobDetail';
import Customers from './pages/Customers';
import Fleet from './pages/Fleet';
import Reports from './pages/Reports';

export default function App() {
  const { user, loading, logout } = useAuth();
  if (loading) return <div className="center muted">Loading…</div>;
  if (!user) return <Login />;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden>
            <path d="M16 3c5 7 9 11.5 9 16.5a9 9 0 0 1-18 0C7 14.5 11 10 16 3z" fill="currentColor" />
          </svg>
          Water Delivery
        </div>
        <nav>
          <NavLink to="/" end>Dispatch</NavLink>
          <NavLink to="/jobs">Jobs</NavLink>
          <NavLink to="/customers">Customers</NavLink>
          <NavLink to="/fleet">Trucks &amp; people</NavLink>
          <NavLink to="/reports">Reports</NavLink>
        </nav>
        <div className="me">
          <span className="muted">{user.name}</span>
          <button className="link" onClick={logout}>Sign out</button>
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Dispatch />} />
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/jobs/:id" element={<JobDetailPage />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/fleet" element={<Fleet />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}
