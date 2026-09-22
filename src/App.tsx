import { lazy, Suspense } from 'react';
const ChessComparison = lazy(() => import('./pages/ChessComparison'));
// React Router setup
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ProtectedRoute, AdminRoute } from './components/ProtectedRoute';

import HomePage from './pages/HomePage';
import VoiceComparison from './pages/VoiceComparison';
import SharePage from './pages/SharePage';
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
          <Route path="/share" element={<SharePage />} />
          
          <Route element={<ProtectedRoute />}>
            <Route path="/app" element={<MainApp />} />
          </Route>
          
          <Route element={<AdminRoute />}>
            <Route path="/app/chess-compare" element={<Suspense fallback={<div>체스 시험 화면 불러오는 중...</div>}><ChessComparison /></Suspense>} />
            <Route path="/app/voice-compare" element={<VoiceComparison />} />
            <Route path="/admin" element={<AdminDashboard />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
