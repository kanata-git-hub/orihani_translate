import React, { useState, useEffect } from 'react';
import { Share, PlusSquare, ArrowUp, X, Download } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function PWAInstallPrompt() {
  const [isInstallable, setIsInstallable] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSModal, setShowIOSModal] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // 1. Check if already installed
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;
    if (isStandalone) {
      return; // Already installed
    }

    // 2. Check if user dismissed previously
    const isDismissed = localStorage.getItem('installPromptDismissed');
    if (isDismissed === 'true') {
      return; // User doesn't want to see this
    }

    // 3. Detect iOS Safari (including iPadOS)
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice = 
      /iphone|ipad|ipod/.test(userAgent) || 
      (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
    setIsIOS(isIOSDevice);

    if (isIOSDevice) {
      // iOS doesn't fire beforeinstallprompt, so we just show the prompt
      setIsInstallable(true);
      setIsVisible(true);
    } else {
      // 4. Android / Chrome - wait for beforeinstallprompt
      const handleBeforeInstallPrompt = (e: any) => {
        // Prevent Chrome 67 and earlier from automatically showing the prompt
        e.preventDefault();
        // Stash the event so it can be triggered later.
        setDeferredPrompt(e);
        // Update UI to notify the user they can add to home screen
        setIsInstallable(true);
        setIsVisible(true);
      };

      window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

      return () => {
        window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      };
    }
  }, []);

  const handleInstallClick = async () => {
    if (isIOS) {
      setShowIOSModal(true);
    } else if (deferredPrompt) {
      // Show the install prompt
      deferredPrompt.prompt();
      // Wait for the user to respond to the prompt
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        console.log('User accepted the install prompt');
        setIsVisible(false);
      } else {
        console.log('User dismissed the install prompt');
      }
      // We've used the prompt, and can't use it again, throw it away
      setDeferredPrompt(null);
    }
  };

  const handleDismiss = () => {
    localStorage.setItem('installPromptDismissed', 'true');
    setIsVisible(false);
    setShowIOSModal(false);
  };

  if (!isVisible) return null;

  return (
    <>
      {/* Install Banner / Button */}
      {!showIOSModal && (
        <motion.div 
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="fixed bottom-4 left-4 right-4 z-40 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl rounded-2xl p-4 flex items-center justify-between"
        >
          <div className="flex items-center space-x-3">
            <div className="bg-indigo-100 dark:bg-indigo-900/50 p-2 rounded-xl">
              <Download className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h4 className="font-semibold text-zinc-900 dark:text-white text-sm">앱 설치하기</h4>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">홈 화면에 추가하고 빠르게 접속하세요</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button 
              onClick={handleInstallClick}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
            >
              설치
            </button>
            <button 
              onClick={handleDismiss}
              className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </motion.div>
      )}

      {/* iOS Install Guide Modal */}
      <AnimatePresence>
        {showIOSModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden"
            >
              <div className="p-6 relative">
                <button 
                  onClick={handleDismiss}
                  className="absolute top-4 right-4 p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 rounded-full transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
                
                <h3 className="text-xl font-bold text-center mb-6 mt-2 text-zinc-900 dark:text-white">
                  아이폰 홈 화면에 추가
                </h3>

                <div className="space-y-6">
                  {/* Step 1 */}
                  <div className="flex items-start space-x-4">
                    <div className="flex-shrink-0 w-10 h-10 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl flex items-center justify-center font-bold">
                      1
                    </div>
                    <div>
                      <p className="text-sm text-zinc-600 dark:text-zinc-300 font-medium leading-relaxed">
                        화면을 살짝 위로 올리거나 주소창을 터치해 <span className="font-bold text-zinc-900 dark:text-white">하단 메뉴바</span>를 띄워주세요.
                      </p>
                      <div className="mt-2 text-indigo-500 animate-bounce">
                        <ArrowUp className="w-5 h-5" />
                      </div>
                    </div>
                  </div>

                  {/* Step 2 */}
                  <div className="flex items-start space-x-4">
                    <div className="flex-shrink-0 w-10 h-10 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl flex items-center justify-center font-bold">
                      2
                    </div>
                    <div>
                      <p className="text-sm text-zinc-600 dark:text-zinc-300 font-medium leading-relaxed">
                        하단 메뉴 정중앙의 <span className="font-bold text-zinc-900 dark:text-white">[공유 버튼]</span>을 눌러주세요.
                      </p>
                      <div className="mt-3 flex items-center justify-center w-12 h-12 bg-zinc-100 dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700">
                        <Share className="w-6 h-6 text-blue-500" />
                      </div>
                    </div>
                  </div>

                  {/* Step 3 */}
                  <div className="flex items-start space-x-4">
                    <div className="flex-shrink-0 w-10 h-10 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl flex items-center justify-center font-bold">
                      3
                    </div>
                    <div>
                      <p className="text-sm text-zinc-600 dark:text-zinc-300 font-medium leading-relaxed">
                        메뉴를 위로 올려 <span className="font-bold text-zinc-900 dark:text-white">[홈 화면에 추가]</span>를 선택해 주세요.
                      </p>
                      <div className="mt-3 flex items-center justify-center w-12 h-12 bg-zinc-100 dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700">
                        <PlusSquare className="w-6 h-6 text-zinc-600 dark:text-zinc-400" />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-8 pt-6 border-t border-zinc-100 dark:border-zinc-800">
                  <button 
                    onClick={handleDismiss}
                    className="w-full py-3 text-sm font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
                  >
                    다시 보지 않기
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
