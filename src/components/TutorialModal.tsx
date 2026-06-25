import React, { useState, useEffect } from 'react';
import { Mic, Square, Pencil, Send, Camera, Download, Languages, RotateCcw, Volume2, HelpCircle, ChevronLeft, ChevronRight, X, Image as ImageIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface TutorialModalProps {
  onClose: () => void;
  isFirstVisit?: boolean;
}

const IconBadge = ({ icon: Icon, isForeigner, isStop, isSend, isNeutral }: any) => {
  let bgClass = isForeigner ? 'bg-[#ffcd4a]' : 'bg-[#552c24]';
  let textClass = isForeigner ? 'text-[#552c24]' : 'text-white';
  let borderClass = '';
  
  if (isStop) {
    bgClass = 'bg-rose-500';
    textClass = 'text-white';
  } else if (isNeutral) {
    bgClass = 'bg-white';
    textClass = 'text-[#552c24]';
    borderClass = 'border border-black/10';
  }

  return (
    <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full align-middle mx-1 shadow-sm ${bgClass} ${textClass} ${borderClass}`}>
      <Icon size={10} className={isSend ? 'ml-0.5' : ''} fill={isStop ? 'currentColor' : 'none'} />
    </span>
  );
};

export function TutorialModal({ onClose, isFirstVisit = false }: TutorialModalProps) {
  const [currentSlide, setCurrentSlide] = useState(0);

  const handleNeverShowAgain = () => {
    localStorage.setItem('tutorialDismissed', 'true');
    onClose();
  };

  const panels = [
    {
      tabName: "음성",
      title: "🗣️ 음성 번역",
      visual: (
        <div className="flex flex-col h-full rounded-lg overflow-hidden border border-black/10 shadow-sm relative w-full max-w-[220px] mx-auto text-[10px]">
          {/* Top (Foreigner) */}
          <div className="flex-1 bg-[#552c24] flex flex-col relative justify-end pb-3">
             <div className="absolute top-2 left-2 text-white/50 text-[9px] font-bold">상대방 (외국어)</div>
             <div className="absolute bottom-1 left-0 right-0 flex justify-center z-10 scale-[0.85] origin-bottom">
               <div className="flex items-center gap-1 bg-black/30 border border-white/10 backdrop-blur-md rounded-full pl-2 pr-1.5 py-1.5">
                 <div className="flex items-center pr-1.5 mr-0.5 border-r border-white/10">
                   <span className="text-[#e74c3c] font-bold text-[8px]">외국어</span>
                   <span className="text-white/30 text-[6px] mx-0.5">▶</span>
                   <span className="text-[#3498db] font-bold text-[8px]">한국어</span>
                 </div>
                 <div className="w-6 h-6 rounded-full bg-[#ffcd4a] text-[#552c24] flex items-center justify-center relative overflow-hidden group">
                   <div className="absolute inset-0 flex items-center justify-center animate-[swapMicStop_4s_infinite]">
                     <Mic size={12} className="absolute transition-opacity" />
                     <Square size={10} fill="currentColor" className="absolute opacity-0 transition-opacity" style={{ animation: 'showStop 4s infinite' }} />
                   </div>
                 </div>
                 <div className="w-6 h-6 rounded-full text-white/50 flex items-center justify-center"><Pencil size={12} /></div>
                 <div className="w-6 h-6 rounded-full text-white/50 flex items-center justify-center"><Camera size={12} /></div>
               </div>
             </div>
          </div>
          
          <div className="h-1 w-full bg-[#ffcd4a] z-20 shrink-0" />
          
          {/* Bottom (User) */}
          <div className="flex-1 bg-white flex flex-col relative pt-3">
             <div className="absolute bottom-2 left-2 text-[#552c24]/50 text-[9px] font-bold">나 (한국어)</div>
             <div className="absolute top-1 left-0 right-0 flex justify-center z-10 scale-[0.85] origin-top">
               <div className="flex items-center gap-1 bg-white/90 border border-black/10 backdrop-blur-md rounded-full pl-2 pr-1.5 py-1.5 shadow-sm">
                 <div className="flex items-center pr-1.5 mr-0.5 border-r border-black/10">
                   <span className="text-[#3498db] font-bold text-[8px]">한국어</span>
                   <span className="text-black/20 text-[6px] mx-0.5">▶</span>
                   <span className="text-[#e74c3c] font-bold text-[8px]">외국어</span>
                 </div>
                 <div className="w-6 h-6 rounded-full bg-[#552c24] text-white flex items-center justify-center relative overflow-hidden">
                   <div className="absolute inset-0 flex items-center justify-center animate-[swapMicStop_4s_infinite_2s]">
                     <Mic size={12} className="absolute transition-opacity" />
                     <Square size={10} fill="currentColor" className="absolute opacity-0 transition-opacity" style={{ animation: 'showStop 4s infinite 2s' }} />
                   </div>
                 </div>
                 <div className="w-6 h-6 rounded-full text-[#552c24]/50 flex items-center justify-center"><Pencil size={12} /></div>
                 <div className="w-6 h-6 rounded-full text-[#552c24]/50 flex items-center justify-center"><Camera size={12} /></div>
               </div>
             </div>
          </div>

          <style dangerouslySetInnerHTML={{__html: `
            @keyframes swapMicStop {
              0%, 45% { transform: scale(1); background-color: inherit; color: inherit; }
              50%, 95% { transform: scale(1.05); background-color: #ef4444; color: white; }
              100% { transform: scale(1); background-color: inherit; color: inherit; }
            }
            @keyframes showStop {
              0%, 45% { opacity: 0; }
              50%, 95% { opacity: 1; }
              100% { opacity: 0; }
            }
          `}} />
        </div>
      ),
      content: (
        <ul className="text-[16px] space-y-4 mt-2 text-zinc-700 list-disc pl-5">
          <li><strong>마이크</strong><IconBadge icon={Mic} isNeutral /> 터치</li>
          <li>말이 끝나면 <strong>정지</strong><IconBadge icon={Square} isStop /> 터치</li>
          <li>즉시 <strong>번역</strong>하고 자동으로 <strong>읽어줍니다</strong></li>
        </ul>
      )
    },
    {
      tabName: "문자",
      title: "✍️ 문자 번역",
      visual: (
        <div className="flex flex-col h-full rounded-lg overflow-hidden border border-black/10 shadow-sm relative w-full max-w-[220px] mx-auto text-[10px]">
          {/* Top (Foreigner) */}
          <div className="flex-1 bg-[#552c24] flex flex-col p-2 relative justify-center">
            <div className="absolute top-1 left-0 right-0 flex justify-center z-10 scale-[0.85] origin-top">
               <div className="flex items-center gap-1 bg-black/30 border border-white/10 backdrop-blur-md rounded-full pl-2 pr-1.5 py-1.5">
                 <div className="flex items-center pr-1.5 mr-0.5 border-r border-white/10">
                   <span className="text-[#e74c3c] font-bold text-[8px]">외국어</span>
                   <span className="text-white/30 text-[6px] mx-0.5">▶</span>
                   <span className="text-[#3498db] font-bold text-[8px]">한국어</span>
                 </div>
                 <div className="w-6 h-6 rounded-full text-white/50 flex items-center justify-center"><Mic size={12} /></div>
                 <div className="w-6 h-6 rounded-full bg-[#ffcd4a] text-[#552c24] flex items-center justify-center"><Pencil size={12} /></div>
                 <div className="w-6 h-6 rounded-full text-white/50 flex items-center justify-center"><Camera size={12} /></div>
               </div>
            </div>
            <div className="relative w-full h-10 mt-6">
               <div className="w-full h-full bg-black/20 rounded-xl p-2 pr-8 text-white/50 text-[9px] flex items-center">
                 외국어 입력...
               </div>
               <div className="absolute right-1 bottom-1 top-1 w-8 bg-[#ffcd4a] text-[#552c24] rounded-lg flex items-center justify-center">
                 <Send size={10} className="ml-0.5" />
               </div>
            </div>
          </div>
          <div className="h-1 w-full bg-[#ffcd4a] shrink-0" />
          {/* Bottom (User) */}
          <div className="flex-1 bg-white flex flex-col p-2 relative justify-center">
            <div className="absolute bottom-1 left-0 right-0 flex justify-center z-10 scale-[0.85] origin-bottom">
               <div className="flex items-center gap-1 bg-white/90 border border-black/10 backdrop-blur-md rounded-full pl-2 pr-1.5 py-1.5 shadow-sm">
                 <div className="flex items-center pr-1.5 mr-0.5 border-r border-black/10">
                   <span className="text-[#3498db] font-bold text-[8px]">한국어</span>
                   <span className="text-black/20 text-[6px] mx-0.5">▶</span>
                   <span className="text-[#e74c3c] font-bold text-[8px]">외국어</span>
                 </div>
                 <div className="w-6 h-6 rounded-full text-[#552c24]/50 flex items-center justify-center"><Mic size={12} /></div>
                 <div className="w-6 h-6 rounded-full bg-[#552c24] text-white flex items-center justify-center"><Pencil size={12} /></div>
                 <div className="w-6 h-6 rounded-full text-[#552c24]/50 flex items-center justify-center"><Camera size={12} /></div>
               </div>
            </div>
            <div className="relative w-full h-10 mb-6">
               <div className="w-full h-full bg-black/5 rounded-xl p-2 pr-8 text-[#552c24]/50 text-[9px] flex items-center">
                 여기에 입력하세요...
               </div>
               <div className="absolute right-1 bottom-1 top-1 w-8 bg-[#552c24] text-white rounded-lg flex items-center justify-center">
                 <Send size={10} className="ml-0.5" />
               </div>
            </div>
          </div>
        </div>
      ),
      content: (
        <ul className="text-[16px] space-y-4 mt-2 text-zinc-700 list-disc pl-5">
          <li><strong>연필</strong><IconBadge icon={Pencil} isNeutral /> 터치</li>
          <li>문자를 입력하고 <strong>전송</strong><IconBadge icon={Send} isSend isNeutral /> 터치</li>
          <li>즉시 <strong>번역</strong>하고 자동으로 <strong>읽어줍니다</strong></li>
        </ul>
      )
    },
    {
      tabName: "이미지",
      title: "📸 이미지 번역",
      visual: (
        <div className="flex flex-col h-full rounded-lg overflow-hidden border border-black/10 shadow-sm relative w-full max-w-[220px] mx-auto bg-black/30 items-center justify-center p-2 text-[10px]">
          <div className="absolute inset-0 flex flex-col opacity-50 z-0">
             <div className="flex-1 bg-[#552c24] relative pb-2 flex items-end justify-center">
               <div className="flex items-center gap-1 bg-black/30 border border-white/10 backdrop-blur-md rounded-full pl-2 pr-1.5 py-1.5 mb-2 scale-[0.85] origin-bottom">
                 <div className="flex items-center pr-1.5 mr-0.5 border-r border-white/10">
                   <span className="text-[#e74c3c] font-bold text-[8px]">외국어</span>
                   <span className="text-white/30 text-[6px] mx-0.5">▶</span>
                   <span className="text-[#3498db] font-bold text-[8px]">한국어</span>
                 </div>
                 <div className="w-6 h-6 rounded-full text-white/50 flex items-center justify-center"><Mic size={12} /></div>
                 <div className="w-6 h-6 rounded-full text-white/50 flex items-center justify-center"><Pencil size={12} /></div>
                 <div className="w-6 h-6 rounded-full bg-[#ffcd4a] text-[#552c24] flex items-center justify-center"><Camera size={12} /></div>
               </div>
             </div>
             <div className="h-1 w-full bg-[#ffcd4a] shrink-0" />
             <div className="flex-1 bg-white relative pt-2 flex items-start justify-center">
               <div className="flex items-center gap-1 bg-white/90 border border-black/10 backdrop-blur-md rounded-full pl-2 pr-1.5 py-1.5 mt-2 shadow-sm scale-[0.85] origin-top">
                 <div className="flex items-center pr-1.5 mr-0.5 border-r border-black/10">
                   <span className="text-[#3498db] font-bold text-[8px]">한국어</span>
                   <span className="text-black/20 text-[6px] mx-0.5">▶</span>
                   <span className="text-[#e74c3c] font-bold text-[8px]">외국어</span>
                 </div>
                 <div className="w-6 h-6 rounded-full text-[#552c24]/50 flex items-center justify-center"><Mic size={12} /></div>
                 <div className="w-6 h-6 rounded-full text-[#552c24]/50 flex items-center justify-center"><Pencil size={12} /></div>
                 <div className="w-6 h-6 rounded-full bg-[#552c24] text-white flex items-center justify-center"><Camera size={12} /></div>
               </div>
             </div>
          </div>
          
          {/* Popup representation */}
          <div className="z-10 bg-gray-50 rounded-xl shadow-2xl flex flex-col w-[90%] h-[90%] animate-in zoom-in duration-300 overflow-hidden">
            <div className="flex items-center justify-between px-2 py-1.5 border-b border-black/5 bg-white">
              <h2 className="text-[10px] font-bold text-[#552c24]">이미지 번역</h2>
              <div className="flex items-center gap-1">
                <div className="w-5 h-5 flex items-center justify-center rounded-full text-[#552c24]">
                  <Download size={12} />
                </div>
                <div className="w-5 h-5 flex items-center justify-center rounded-full text-[#552c24]">
                  <X size={12} />
                </div>
              </div>
            </div>
            <div className="flex-1 bg-[#e5e5e5] p-2 flex items-center justify-center">
               <div className="w-full h-full bg-white/50 rounded shadow-sm flex items-center justify-center text-zinc-400">
                 <ImageIcon size={16} />
               </div>
            </div>
          </div>
        </div>
      ),
      content: (
        <ul className="text-[16px] space-y-4 mt-2 text-zinc-700 list-disc pl-5">
          <li><strong>카메라</strong><IconBadge icon={Camera} isNeutral /> 터치</li>
          <li>카메라 촬영 혹은 사진 선택</li>
          <li>즉시 번역하고 <strong>저장</strong><IconBadge icon={Download} isNeutral />도 가능</li>
        </ul>
      )
    },
    {
      tabName: "부가기능",
      title: "🛠️ 부가 기능 모음",
      visual: (
        <div className="flex flex-col h-full rounded-lg overflow-hidden border border-black/10 shadow-sm relative w-full max-w-[220px] mx-auto text-[10px]">
          {/* Top Bar (Foreigner) */}
          <div className="bg-[#552c24] p-3 flex justify-between items-start h-1/2 relative">
             <div className="flex flex-col gap-2">
               <div className="flex items-center gap-1 bg-black/20 px-2 py-1 rounded-full text-[#ffcd4a] w-fit">
                 <Languages size={10} />
                 <span className="text-[8px] text-white">영어 English</span>
               </div>
               <div className="flex items-center gap-1 bg-black/20 px-2 py-1 rounded-full text-white/90 w-fit">
                 <RotateCcw size={10} />
                 <span className="text-[8px] font-bold">초기화</span>
               </div>
             </div>
             <div className="w-6 h-6 rounded-full bg-[#ffcd4a] text-[#552c24] flex items-center justify-center">
               <Volume2 size={12} />
             </div>
          </div>
          <div className="h-1 w-full bg-[#ffcd4a] shrink-0" />
          {/* Bottom Bar (User) */}
          <div className="bg-white p-3 h-1/2 relative">
             <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-black/5 px-2 py-1.5 rounded-full text-[#552c24]">
               <Download size={12} />
               <span className="text-[9px] font-bold">화면 캡처</span>
             </div>
             <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-black/5 px-2 py-1.5 rounded-full text-[#552c24]">
               <HelpCircle size={12} />
               <span className="text-[9px] font-bold">사용법</span>
             </div>
          </div>
        </div>
      ),
      content: (
        <div className="text-[16px] mt-1 px-2">
          <ul className="space-y-4 text-zinc-700">
            <li className="flex items-center"><IconBadge icon={Languages} isNeutral /> <span><strong>언어선택:</strong> 번역할 외국어 선택</span></li>
            <li className="flex items-center"><IconBadge icon={RotateCcw} isNeutral /> <span><strong>초기화:</strong> 대화 내용 모두 지우기</span></li>
            <li className="flex items-center"><IconBadge icon={Volume2} isNeutral /> <span><strong>사운드:</strong> 소리를 들을지 켬/끔</span></li>
            <li className="flex items-center"><IconBadge icon={Download} isNeutral /> <span><strong>화면 캡처:</strong> 현재 화면을 이미지로 저장</span></li>
            <li className="flex items-center"><IconBadge icon={HelpCircle} isNeutral /> <span><strong>사용법:</strong> 설명서를 다시 확인</span></li>
          </ul>
        </div>
      )
    }
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-[2px]">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="bg-[#552c24] text-[#ffcd4a] p-4 flex justify-between items-center">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <HelpCircle size={20} />
            {isFirstVisit ? "앱 사용 안내" : "사용 방법"}
          </h2>
          {!isFirstVisit && (
            <button 
              onClick={onClose}
              className="p-1 hover:bg-white/10 rounded-full transition-colors"
            >
              <X size={20} />
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-zinc-100 p-1 mx-4 mt-4 rounded-xl shrink-0">
           {panels.map((panel, idx) => (
              <button
                 key={idx}
                 onClick={() => setCurrentSlide(idx)}
                 className={`flex-1 py-2 text-[15px] font-bold rounded-lg transition-colors ${
                    currentSlide === idx ? 'bg-white text-[#552c24] shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
                 }`}
              >
                 {panel.tabName}
              </button>
           ))}
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto px-5 pb-5 pt-3 relative">
           <AnimatePresence mode="wait">
             <motion.div
               key={currentSlide}
               initial={{ opacity: 0, x: 10 }}
               animate={{ opacity: 1, x: 0 }}
               exit={{ opacity: 0, x: -10 }}
               transition={{ duration: 0.2 }}
               className="flex flex-col gap-4 h-full"
             >
               {/* Visual Container */}
               <div className="h-[170px] bg-zinc-50 rounded-xl border border-zinc-100 flex items-center justify-center p-2 shadow-inner">
                 {panels[currentSlide].visual}
               </div>

               {/* Description */}
               <div className="flex-1">
                 {panels[currentSlide].content}
               </div>
             </motion.div>
           </AnimatePresence>
        </div>

        {/* Navigation & Controls */}
        <div className="border-t border-zinc-100 bg-zinc-50 p-4 flex flex-col gap-4">
           {/* Actions */}
           <div className="flex gap-2">
             <button 
               onClick={handleNeverShowAgain}
               className="flex-1 py-3 bg-zinc-200 hover:bg-zinc-300 text-zinc-700 font-bold rounded-xl transition-colors text-[14px]"
             >
               다시 보지 않기
             </button>
             <button 
               onClick={onClose}
               className="flex-1 py-3 bg-[#552c24] hover:bg-[#3a1d17] text-[#ffcd4a] font-bold rounded-xl shadow-md transition-colors text-[14px]"
             >
               닫기
             </button>
           </div>
        </div>
      </motion.div>
    </div>
  );
}
