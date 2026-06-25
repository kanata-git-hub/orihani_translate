// React Router setup
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ProtectedRoute, AdminRoute } from './components/ProtectedRoute';

import HomePage from './pages/HomePage';
import MainApp from './pages/MainApp';
import AdminDashboard from './pages/AdminDashboard'; // To be created
import PWAInstallPrompt from './components/PWAInstallPrompt';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <PWAInstallPrompt />
        <Routes>
          <Route path="/" element={<HomePage />} />
          
          <Route element={<ProtectedRoute />}>
            <Route path="/app" element={<MainApp />} />
          </Route>
          
          <Route element={<AdminRoute />}>
            <Route path="/admin" element={<AdminDashboard />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
