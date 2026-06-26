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

const VoiceVisual = () => (
  <div className="flex flex-col h-full rounded-lg overflow-hidden border border-black/10 shadow-sm relative w-full max-w-[280px] mx-auto bg-zinc-100 text-[12px]">
    <div className="flex-1 bg-[#552c24] flex flex-col justify-end p-3 pb-6">
      <div className="absolute top-3 left-3 text-white/50 text-[12px] font-bold mb-1">외국어</div>
      <motion.div animate={{ opacity: [0, 0, 0, 1, 1, 0] }} transition={{ duration: 8, repeat: Infinity, times: [0, 0.6, 0.65, 0.95, 1, 1] }} className="bg-black/30 text-white px-3 py-2 rounded-xl self-start max-w-[80%] mb-4">こんにちは</motion.div>
    </div>
    <div className="h-1 w-full bg-[#ffcd4a] shrink-0" />
    <div className="flex-1 bg-white flex flex-col justify-start p-3 pt-6 relative">
      <div className="absolute bottom-3 right-3 text-[#552c24]/50 text-[12px] font-bold mt-1 text-right">한국어</div>
      <motion.div animate={{ opacity: [0, 0, 1, 1, 1, 0] }} transition={{ duration: 8, repeat: Infinity, times: [0, 0.25, 0.3, 0.95, 1, 1] }} className="bg-[#552c24]/10 text-[#552c24] px-3 py-2 rounded-xl self-end border border-[#552c24]/20 max-w-[80%] mt-4">안녕하세요</motion.div>
    </div>

    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 scale-[0.9]">
      <div className="flex items-center gap-2 bg-white/90 border border-black/10 backdrop-blur-md rounded-full pl-5 pr-4 py-2 shadow-sm whitespace-nowrap">
        <div className="flex items-center pr-3 mr-1 border-r border-black/10 shrink-0">
          <span className="text-[#3498db] font-bold text-[13px]">한국어</span>
          <span className="text-black/20 text-[11px] mx-1.5">▶</span>
          <span className="text-[#e74c3c] font-bold text-[13px]">외국어</span>
        </div>
        
        <div className="w-8 h-8 rounded-full bg-[#552c24] text-white flex items-center justify-center relative overflow-hidden shrink-0">
          <motion.div animate={{ opacity: [1, 0, 0, 1, 1] }} transition={{ duration: 8, repeat: Infinity, times: [0, 0.1, 0.5, 0.6, 1] }} className="absolute inset-0 flex items-center justify-center"><Mic size={14} /></motion.div>
          <motion.div animate={{ opacity: [0, 1, 1, 0, 0] }} transition={{ duration: 8, repeat: Infinity, times: [0, 0.1, 0.5, 0.6, 1] }} className="absolute inset-0 flex items-center justify-center bg-red-500"><Square size={12} fill="currentColor" /></motion.div>
        </div>
        <div className="w-8 h-8 rounded-full text-[#552c24]/50 flex items-center justify-center shrink-0"><Pencil size={14} /></div>
        <div className="w-8 h-8 rounded-full text-[#552c24]/50 flex items-center justify-center shrink-0"><Camera size={14} /></div>
      </div>
    </div>
  </div>
);

const TextVisual = () => (
  <div className="flex flex-col h-full rounded-lg overflow-hidden border border-black/10 shadow-sm relative w-full max-w-[280px] mx-auto bg-zinc-100 text-[12px]">
    <div className="flex-1 bg-[#552c24] flex flex-col justify-end p-3 pb-6 relative">
       <div className="absolute top-3 left-3 text-white/50 text-[12px] font-bold mb-1">외국어</div>
       <motion.div animate={{ opacity: [0, 0, 1, 1, 0, 0] }} transition={{ duration: 20, repeat: Infinity, times: [0, 0.8, 0.82, 0.95, 0.97, 1] }} className="bg-black/30 text-white px-3 py-2 rounded-xl self-start max-w-[80%] mb-4">こんにちは</motion.div>
    </div>
    <div className="h-1 w-full bg-[#ffcd4a] shrink-0" />
    <div className="flex-1 bg-white flex flex-col justify-start p-3 pt-6 relative">
       <div className="absolute bottom-3 right-3 text-[#552c24]/50 text-[12px] font-bold mt-1 text-right">한국어</div>
       <motion.div animate={{ opacity: [0, 0, 1, 1, 0, 0] }} transition={{ duration: 20, repeat: Infinity, times: [0, 0.75, 0.77, 0.95, 0.97, 1] }} className="bg-[#552c24]/10 text-[#552c24] px-3 py-2 rounded-xl self-end border border-[#552c24]/20 max-w-[80%] mt-4">안녕하세요</motion.div>
    </div>
    
    {/* Default Panel (disappears when pencil pressed) */}
    <motion.div animate={{ opacity: [1, 1, 0, 0, 1, 1] }} transition={{ duration: 20, repeat: Infinity, times: [0, 0.35, 0.37, 0.97, 0.99, 1] }} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 scale-[0.9]">
      <div className="flex items-center gap-2 bg-white/90 border border-black/10 backdrop-blur-md rounded-full pl-5 pr-4 py-2 shadow-sm whitespace-nowrap">
        <div className="flex items-center pr-3 mr-1 border-r border-black/10 shrink-0">
          <span className="text-[#3498db] font-bold text-[13px]">한국어</span>
          <span className="text-black/20 text-[11px] mx-1.5">▶</span>
          <span className="text-[#e74c3c] font-bold text-[13px]">외국어</span>
        </div>
        <div className="w-8 h-8 rounded-full text-[#552c24]/50 flex items-center justify-center shrink-0"><Mic size={14} /></div>
        <motion.div animate={{ scale: [1, 1, 0.8, 0.8, 1, 1], backgroundColor: ["#552c24", "#552c24", "#ffcd4a", "#ffcd4a", "#552c24", "#552c24"], color: ["#ffffff", "#ffffff", "#552c24", "#552c24", "#ffffff", "#ffffff"] }} transition={{ duration: 20, repeat: Infinity, times: [0, 0.15, 0.17, 0.35, 0.37, 1] }} className="w-8 h-8 rounded-full bg-[#552c24] text-white flex items-center justify-center shrink-0"><Pencil size={14} /></motion.div>
        <div className="w-8 h-8 rounded-full text-[#552c24]/50 flex items-center justify-center shrink-0"><Camera size={14} /></div>
      </div>
    </motion.div>

    {/* Text Input Panel (appears after pencil pressed) */}
    <motion.div animate={{ opacity: [0, 0, 1, 1, 0, 0] }} transition={{ duration: 20, repeat: Infinity, times: [0, 0.35, 0.37, 0.75, 0.77, 1] }} className="absolute bottom-3 left-3 right-3 bg-zinc-50 rounded-full flex items-center p-1 border border-zinc-200 shadow-sm z-20">
      <div className="flex-1 px-3 h-full relative flex items-center text-[12px]">
        <motion.span animate={{ opacity: [1, 1, 0, 0, 1, 1] }} transition={{ duration: 20, repeat: Infinity, times: [0, 0.37, 0.38, 0.77, 0.79, 1] }} className="absolute text-zinc-400">입력하세요...</motion.span>
        <motion.span animate={{ width: ["0%", "0%", "100%", "100%", "0%", "0%"] }} transition={{ duration: 20, repeat: Infinity, times: [0, 0.38, 0.48, 0.75, 0.77, 1] }} className="absolute text-zinc-800 font-medium overflow-hidden whitespace-nowrap left-3">안녕하세요</motion.span>
      </div>
      <motion.div animate={{ scale: [1, 1, 0.8, 0.8, 1, 1], backgroundColor: ["#552c24", "#552c24", "#ffcd4a", "#ffcd4a", "#552c24", "#552c24"], color: ["#ffffff", "#ffffff", "#552c24", "#552c24", "#ffffff", "#ffffff"] }} transition={{ duration: 20, repeat: Infinity, times: [0, 0.5, 0.52, 0.67, 0.69, 1] }} className="w-8 h-8 rounded-full bg-[#552c24] text-white flex items-center justify-center shrink-0">
        <Send size={14} />
      </motion.div>
    </motion.div>
  </div>
);

const ImageVisual = () => (
  <div className="flex flex-col h-full rounded-lg overflow-hidden border border-black/10 shadow-sm relative w-full max-w-[280px] mx-auto bg-zinc-100 text-[12px]">
    <div className="absolute inset-0 flex flex-col opacity-50 z-0">
      <div className="flex-1 bg-[#552c24]" />
      <div className="h-1 w-full bg-[#ffcd4a] shrink-0" />
      <div className="flex-1 bg-white" />
    </div>

    {/* Base Panel */}
    <motion.div animate={{ opacity: [1, 1, 0, 0, 1, 1] }} transition={{ duration: 20, repeat: Infinity, times: [0, 0.25, 0.27, 0.85, 0.87, 1] }} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 scale-[0.9] w-max">
      <div className="flex items-center gap-2 bg-white/90 border border-black/10 backdrop-blur-md rounded-full pl-5 pr-4 py-2 shadow-sm whitespace-nowrap">
        <div className="flex items-center pr-3 mr-1 border-r border-black/10 shrink-0">
          <span className="text-[#e74c3c] font-bold text-[13px]">외국어</span>
          <span className="text-black/20 text-[11px] mx-1.5">▶</span>
          <span className="text-[#3498db] font-bold text-[13px]">한국어</span>
        </div>
        <div className="w-8 h-8 rounded-full text-[#552c24]/50 flex items-center justify-center shrink-0"><Mic size={14} /></div>
        <div className="w-8 h-8 rounded-full text-[#552c24]/50 flex items-center justify-center shrink-0"><Pencil size={14} /></div>
        <motion.div animate={{ scale: [1, 1, 0.8, 0.8, 1, 1], backgroundColor: ["#552c24", "#552c24", "#ffcd4a", "#ffcd4a", "#552c24", "#552c24"], color: ["#ffffff", "#ffffff", "#552c24", "#552c24", "#ffffff", "#ffffff"] }} transition={{ duration: 20, repeat: Infinity, times: [0, 0.07, 0.09, 0.25, 0.27, 1] }} className="w-8 h-8 rounded-full bg-[#552c24] text-white flex items-center justify-center shrink-0"><Camera size={14} /></motion.div>
      </div>
    </motion.div>

    {/* Image Translation Popup */}
    <motion.div animate={{ y: ['100%', '100%', '0%', '0%', '100%', '100%'], opacity: [0, 0, 1, 1, 0, 0] }} transition={{ duration: 20, repeat: Infinity, times: [0, 0.25, 0.27, 0.85, 0.87, 1] }} className="absolute inset-0 m-2 bg-white rounded-xl shadow-2xl z-20 flex flex-col border border-black/10 overflow-hidden">
      <div className="flex justify-between items-center px-3 py-2 border-b border-black/5 bg-zinc-50">
        <div className="w-[14px]"></div>
        <div className="text-[#552c24] font-bold text-[12px]">이미지 번역</div>
        <motion.div animate={{ scale: [1, 1, 1.2, 1, 1], color: ['#a1a1aa', '#a1a1aa', '#552c24', '#a1a1aa', '#a1a1aa'] }} transition={{ duration: 20, repeat: Infinity, times: [0, 0.75, 0.78, 0.8, 1] }}>
          <Download size={16} />
        </motion.div>
      </div>
      <div className="flex-1 p-2 relative flex items-center justify-center bg-zinc-200">
         <div className="w-full h-full bg-zinc-300 rounded-lg flex flex-col items-center justify-center relative overflow-hidden shadow-inner p-2">
           {/* Original image elements */}
           <div className="absolute inset-0 bg-gradient-to-b from-blue-200 to-green-200 opacity-50" />
           <ImageIcon size={32} className="text-zinc-500 mb-2 z-10" />
           <div className="bg-white/80 px-3 py-1 rounded shadow-sm z-10 text-center flex flex-col items-center justify-center">
             <span className="text-zinc-800 font-bold text-[16px]">WELCOME</span>
             <span className="text-zinc-600 text-[10px] mt-0.5 leading-tight">National Park</span>
           </div>
           
           {/* Overlay overlay translated image elements */}
           <motion.div animate={{ opacity: [0, 0, 1, 1, 0, 0] }} transition={{ duration: 20, repeat: Infinity, times: [0, 0.65, 0.67, 0.85, 0.87, 1] }} className="absolute inset-2 bg-white/95 rounded-md shadow-xl flex flex-col items-center justify-center border border-black/10 py-3 backdrop-blur-sm z-20">
             <div className="font-bold text-[16px] text-zinc-800 mb-1">환영합니다</div>
             <div className="text-[11px] text-zinc-600 text-center px-4 leading-tight">국립공원</div>
           </motion.div>
         </div>
      </div>
    </motion.div>
  </div>
);

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
      visual: <VoiceVisual />,
      content: (
        <ul className="text-[16px] space-y-2 mt-2 text-zinc-700 list-disc pl-5">
          <li><strong>마이크</strong><IconBadge icon={Mic} isNeutral /> 터치</li>
          <li>말이 끝나면 <strong>정지</strong><IconBadge icon={Square} isStop /> 터치</li>
          <li>즉시 <strong>번역</strong>하고 자동으로 <strong>읽어줍니다</strong></li>
        </ul>
      )
    },
    {
      tabName: "문자",
      title: "✍️ 문자 번역",
      visual: <TextVisual />,
      content: (
        <ul className="text-[16px] space-y-2 mt-2 text-zinc-700 list-disc pl-5">
          <li><strong>연필</strong><IconBadge icon={Pencil} isNeutral /> 터치</li>
          <li>문자를 입력하고 <strong>전송</strong><IconBadge icon={Send} isSend isNeutral /> 터치</li>
          <li>즉시 <strong>번역</strong>하고 자동으로 <strong>읽어줍니다</strong></li>
        </ul>
      )
    },
    {
      tabName: "이미지",
      title: "📸 이미지 번역",
      visual: <ImageVisual />,
      content: (
        <ul className="text-[16px] space-y-2 mt-2 text-zinc-700 list-disc pl-5">
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
        <div className="flex flex-col h-full rounded-lg overflow-hidden border border-black/10 shadow-sm relative w-full max-w-[280px] mx-auto text-[12px] bg-zinc-100">
          {/* Top Bar (Foreigner) */}
          <div className="bg-[#552c24] p-3 flex justify-between items-start h-1/2 relative">
             <div className="flex flex-col gap-2">
               <div className="flex items-center gap-1.5 bg-black/20 px-3 py-1.5 rounded-full text-[#ffcd4a] w-fit shadow-sm">
                 <Languages size={14} />
                 <span className="text-[10px] text-white font-medium">영어 English</span>
               </div>
               <div className="flex items-center gap-1.5 bg-black/20 px-3 py-1.5 rounded-full text-white/90 w-fit shadow-sm">
                 <RotateCcw size={14} />
                 <span className="text-[10px] font-bold">초기화</span>
               </div>
             </div>
             <div className="w-8 h-8 rounded-full bg-[#ffcd4a] text-[#552c24] flex items-center justify-center shadow-sm">
               <Volume2 size={16} />
             </div>
          </div>
          <div className="h-1 w-full bg-[#ffcd4a] shrink-0" />
          {/* Bottom Bar (User) */}
          <div className="bg-white p-3 h-1/2 relative">
             <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-black/5 px-3 py-2 rounded-full text-[#552c24] shadow-sm">
               <Download size={14} />
               <span className="text-[11px] font-bold">화면 캡처</span>
             </div>
             <div className="absolute bottom-3 right-3 flex items-center gap-1.5 bg-black/5 px-3 py-2 rounded-full text-[#552c24] shadow-sm">
               <HelpCircle size={14} />
               <span className="text-[11px] font-bold">사용법</span>
             </div>
          </div>
        </div>
      ),
      content: (
        <div className="text-[16px] mt-1 px-2">
          <ul className="space-y-2 text-zinc-700">
            <li className="flex items-center"><IconBadge icon={Languages} isNeutral /> <span><strong>언어선택:</strong> 번역할 외국어 선택</span></li>
            <li className="flex items-center"><IconBadge icon={RotateCcw} isNeutral /> <span><strong>초기화:</strong> 대화 내용 모두 지우기</span></li>
            <li className="flex items-center"><IconBadge icon={Volume2} isNeutral /> <span><strong>사운드:</strong> 소리를 들을지 켬/끔</span></li>
            <li className="flex items-center"><IconBadge icon={Download} isNeutral /> <span><strong>화면 캡처:</strong> 현재 화면을 이미지로 저장</span></li>
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
               <div className="h-[260px] bg-zinc-50 rounded-xl border border-zinc-100 flex items-center justify-center p-2 shadow-inner">
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
