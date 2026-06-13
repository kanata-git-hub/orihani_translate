import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { loginWithGoogle } from '../lib/firebaseUtils';

export default function HomePage() {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();

  const handleLogin = async () => {
    try {
      await loginWithGoogle();
      // On success, redirect to Main App or Admin
      if (isAdmin) {
         navigate('/admin');
      } else {
         navigate('/app');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleGoToApp = () => {
     if (isAdmin) {
         navigate('/admin');
     } else {
         navigate('/app');
     }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[100dvh] bg-[#552c24] text-white">
      <div className="flex flex-col items-center justify-between w-full h-full min-h-[100dvh] max-w-md p-8 pt-24 pb-12">
        <div className="flex flex-col items-center justify-center w-full flex-1">
          <img src="/src/persona.png" alt="App Icon" className="w-40 h-40 mx-auto mb-10 rounded-3xl shadow-2xl border-4 border-white/10 object-cover bg-white" />
          <h1 className="text-4xl font-bold mb-4 tracking-tight">실시간 통역 앱</h1>
          <p className="text-[#ffcd4a] mb-12 font-medium text-lg text-center">구글로 로그인하여 통역기능 사용</p>
        </div>
        
        <div className="w-full mt-auto">
          {user ? (
            <div className="flex flex-col gap-4">
              <p className="font-medium text-white/90 text-center mb-2">환영합니다, {user.displayName}님</p>
              <button 
                onClick={handleGoToApp}
                className="w-full bg-[#ffcd4a] text-[#552c24] text-lg font-bold py-4 px-6 rounded-2xl hover:bg-[#e6b840] transition-all shadow-lg active:scale-[0.98]"
              >
                앱으로 계속하기
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
