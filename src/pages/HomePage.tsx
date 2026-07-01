import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { loginWithGoogle, logout } from '../lib/firebaseUtils';

export default function HomePage() {
  const { user, isAdmin, isApproved } = useAuth();
  const navigate = useNavigate();

  React.useEffect(() => {
    if (user && isApproved) {
      navigate('/app');
    }
  }, [user, isApproved, navigate]);

  const handleLogin = async () => {
    try {
      await loginWithGoogle();
      // On success, redirect to Main App or Admin is handled automatically if we have state sync, 
      // but if the user gets approved later, they could still be here.
      // AuthContext will re-evaluate on auth state change.
    } catch (e) {
      console.error(e);
    }
  };

  const handleGoToApp = () => {
     if (isApproved) {
         navigate('/app');
     }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[100dvh] bg-[#552c24] text-white">
      <div className="flex flex-col items-center justify-between w-full h-full min-h-[100dvh] max-w-md p-8 pt-24 pb-12">
        <div className="flex flex-col items-center justify-center w-full flex-1">
          <img src="/icon.png" alt="App Icon" className="w-40 h-40 mx-auto mb-10 rounded-3xl shadow-2xl border-4 border-white/10 object-cover bg-white" />
          <h1 className="text-4xl font-bold mb-4 tracking-tight">실시간 통역 앱</h1>
          <p className="text-[#ffcd4a] mb-12 font-medium text-lg text-center">구글로 로그인하여 통역기능 사용</p>
        </div>
        
        <div className="w-full mt-auto">
          {user ? (
            <div className="flex flex-col gap-4">
              <p className="font-medium text-white/90 text-center mb-2">환영합니다, {user.displayName || user.email}님</p>
              
              {!isApproved ? (
                <div className="bg-red-500/20 text-red-200 border border-red-500/30 rounded-2xl p-4 text-center mb-2">
                  <p className="font-bold mb-1">앱 접근 권한이 없습니다.</p>
                  <p className="text-sm">관리자에게 승인을 요청해주세요.</p>
                </div>
              ) : (
                <button 
                  onClick={handleGoToApp}
                  className="w-full bg-[#ffcd4a] text-[#552c24] text-lg font-bold py-4 px-6 rounded-2xl hover:bg-[#e6b840] transition-all shadow-lg active:scale-[0.98]"
                >
                  앱으로 계속하기
                </button>
              )}
              
              <button 
                onClick={logout}
                className="w-full bg-white/10 text-white text-lg font-bold py-4 px-6 rounded-2xl hover:bg-white/20 transition-all active:scale-[0.98]"
              >
                다른 계정으로 로그인
              </button>
            </div>
          ) : (
            <button 
              onClick={handleLogin}
              className="w-full flex items-center justify-center gap-3 bg-white text-gray-900 text-lg font-bold py-4 px-6 rounded-2xl hover:bg-gray-100 transition-all shadow-lg active:scale-[0.98]"
            >
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-6 h-6" />
              구글 계정 로그인
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
