import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { AdminPage } from './pages/Admin';
import { LandingPage } from './pages/Landing';
import { PrivacyPage } from './pages/Privacy';
import { SupportPage } from './pages/Support';
import { TermsPage } from './pages/Terms';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<LandingPage />} />
        <Route path="support" element={<SupportPage />} />
        <Route path="privacy" element={<PrivacyPage />} />
        <Route path="terms" element={<TermsPage />} />
      </Route>
      <Route path="admin" element={<AdminPage />} />
    </Routes>
  );
}
