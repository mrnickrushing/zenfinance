import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { AdminPage } from './pages/Admin';
import { LandingPage } from './pages/Landing';
import { InsightsPage } from './pages/Insights';
import { PrivacyPage } from './pages/Privacy';
import { SupportPage } from './pages/Support';
import { TermsPage } from './pages/Terms';

// Marketing (zenfinance.rushingtechnologies.com) and admin
// (admin.zenfinance.rushingtechnologies.com) ship as separate Cloudflare
// Worker builds — VITE_APP_TARGET picks which route tree this bundle mounts.
const isAdminBuild = import.meta.env.VITE_APP_TARGET === 'admin';

export default function App() {
  if (isAdminBuild) {
    return (
      <Routes>
        <Route path="*" element={<AdminPage />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<LandingPage />} />
        <Route path="insights" element={<InsightsPage />} />
        <Route path="support" element={<SupportPage />} />
        <Route path="privacy" element={<PrivacyPage />} />
        <Route path="terms" element={<TermsPage />} />
      </Route>
    </Routes>
  );
}
