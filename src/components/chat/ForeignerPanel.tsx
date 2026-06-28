import React, { useState } from 'react';
import { Mic, Square, Languages, Volume2, Loader2, LogOut, Shield, Pencil, Send, RotateCcw, Camera, VolumeX, Copy, Check } from 'lucide-react';
import { renderPronunciation } from '../../utils/textUtils';
import { AudioVisualizer } from './AudioVisualizer';

interface ForeignerPanelProps {
  foreignLoc: any;
  foreignerLang: string;
  setForeignerLang: (lang: string) => void;
  ttsEnabled: boolean;
  setTtsEnabled: (enabled: boolean) => void;
  isAdmin: boolean;
  handleLogout: () => void;
  navigate: (path: string) => void;
  handleReset: () => void;
  inputTypeForeigner: 'mic' | 'text';
  setInputTypeForeigner: (type: 'mic' | 'text') => void;
  activeMic: 'foreigner' | 'user' | null;
  toggleForeignerMic: () => void;
  foreignerText: string;
  localUnfinalizedForeigner: string;
  foreignerPronunciation: string;
  textInputForeigner: string;
  setTextInputForeigner: (text: string) => void;
  handleSendText: (role: 'foreigner') => void;
  playingTTS: boolean;
  playTTS: (text: string) => void;
  processingRole: 'foreigner' | 'user' | null;
  imageInputForeignerRef: React.RefObject<HTMLInputElement>;
  handleImageChange: (e: React.ChangeEvent<HTMLInputElement>, role: 'foreigner') => void;
  audioLevels?: number[];
}

export const ForeignerPanel: React.FC<ForeignerPanelProps> = ({
  foreignLoc, foreignerLang, setForeignerLang, ttsEnabled, setTtsEnabled,
  isAdmin, handleLogout, navigate, handleReset,
  inputTypeForeigner, setInputTypeForeigner,
  activeMic, toggleForeignerMic,
  foreignerText, localUnfinalizedForeigner, foreignerPronunciation,
  textInputForeigner, setTextInputForeigner, handleSendText,
  playingTTS, playTTS, processingRole,
  imageInputForeignerRef, handleImageChange, audioLevels
}) => {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = () => {
    if (!foreignerText) return;
    navigator.clipboard.writeText(foreignerText);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div className="flex-1 shrink-0 relative bg-[#552c24] text-white flex flex-col p-8 pb-24">
      <div className="flex justify-between items-start mb-6">
        <div className="flex flex-col gap-3 z-10">
          <span className="font-bold text-[13px] tracking-wide text-[#ffcd4a]/90 flex items-center">{foreignLoc.title}</span>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 bg-black/20 hover:bg-black/30 transition-colors px-3 py-1.5 rounded-full text-sm font-medium w-fit">
              <Languages size={16} className="text-[#ffcd4a]" />
              <select
                value={foreignerLang}
                onChange={(e) => setForeignerLang(e.target.value)}
                className="bg-transparent text-white outline-none cursor-pointer appearance-none pr-4"
                style={{ backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23FFFFFF%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right center', backgroundSize: '0.65em auto' }}
              >
                <option value="en" className="text-black">영어 English</option>
                <option value="ja" className="text-black">일본어 日本語</option>
                <option value="es" className="text-black">스페인어 Español</option>
                <option value="zh" className="text-black">중국어 中文</option>
              </select>
            </div>
            <button 
              onClick={handleReset}
              className="flex items-center gap-1.5 bg-black/20 hover:bg-black/30 transition-colors px-3 py-1.5 rounded-full text-xs font-bold text-white/90"
              title="대화 초기화"
            >
              <RotateCcw size={14} />
              초기화
            </button>
          </div>
        </div>
        
        <div className="flex items-center gap-2 z-10 pt-1">
          <button
            onClick={() => setTtsEnabled(!ttsEnabled)}
            className={`flex items-center justify-center w-8 h-8 rounded-full transition-colors ${
              ttsEnabled ? 'bg-[#ffcd4a] text-[#552c24] hover:bg-[#ffe18a]' : 'bg-black/20 text-white hover:bg-black/30'
            }`}
            title={ttsEnabled ? '자동 음성 재생 켜짐' : '자동 음성 재생 꺼짐'}
          >
            {ttsEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
          {isAdmin && (
            <button 
              onClick={() => navigate('/admin')}
              className="flex items-center gap-2 bg-black/20 hover:bg-black/30 transition-colors px-3 py-1.5 rounded-full text-sm font-medium"
            >
              <Shield size={16} className="text-white/80" />
              Admin
            </button>
          )}
          <button 
            onClick={handleLogout}
            className="flex items-center gap-2 bg-black/20 hover:bg-black/30 transition-colors px-3 py-1.5 rounded-full text-sm font-medium"
          >
            <LogOut size={16} className="text-white/80" />
            Sign Out
          </button>
        </div>
      </div>
      
      <div className="flex-1 overflow-visible w-full flex flex-col">
        <div className="flex flex-col flex-1 justify-center py-4">
          {inputTypeForeigner === 'text' ? (
            <div className="flex flex-col gap-4 w-full h-full justify-center">
              {foreignerText && (
                <p className="text-xl opacity-50 mb-2 break-words shrink-0">{foreignerText}</p>
              )}
              <div className="relative w-full z-20 flex-1 flex">
                <textarea
                  value={textInputForeigner}
                  onChange={(e) => setTextInputForeigner(e.target.value)}
                  className="w-full flex-1 bg-black/20 rounded-2xl p-4 pr-16 resize-none outline-none text-2xl font-medium focus:bg-black/30 transition-colors text-white"
                  placeholder={foreignLoc.typeHere || "Type here..."}
                />
                <button 
                  className="absolute right-3 bottom-4 w-10 h-10 bg-[#ffcd4a] text-[#552c24] rounded-full flex items-center justify-center disabled:opacity-50"
                  disabled={!textInputForeigner.trim()}
                  onClick={() => handleSendText('foreigner')}
                >
                  <Send size={18} className="ml-0.5" />
                </button>
              </div>
            </div>
          ) : activeMic === 'foreigner' ? (
            <div className="flex flex-col items-center justify-center py-4 w-full">
              <AudioVisualizer levels={audioLevels || []} color="#ffcd4a" />
              <p className="text-xl text-white/80 mt-4 animate-pulse font-medium">{foreignLoc.listening}</p>
            </div>
          ) : foreignerText || localUnfinalizedForeigner ? (
            <div className="group relative pr-12">
              <p className="text-2xl sm:text-3xl leading-tight font-medium break-words text-white">
                {foreignerText} {localUnfinalizedForeigner && <span className="opacity-70">{localUnfinalizedForeigner}</span>}
              </p>
              {foreignerPronunciation && (
                <p className="text-lg sm:text-xl font-normal text-[#ffcd4a]/80 mt-2 break-words">
                  {renderPronunciation(foreignerPronunciation)}
                </p>
              )}
              <div className="absolute right-0 top-1/2 -translate-y-1/2 flex flex-col gap-2">
                <button 
                  onClick={() => playTTS(foreignerText)} 
                  className="w-10 h-10 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full transition-colors"
                  disabled={playingTTS}
                >
                  {playingTTS ? <Loader2 size={20} className="animate-spin text-[#ffcd4a]" /> : <Volume2 size={20} className="text-[#ffcd4a]" />}
                </button>
                <button 
                  onClick={handleCopy} 
                  className="w-10 h-10 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full transition-colors"
                  title="복사하기"
                >
                  {isCopied ? <Check size={18} className="text-green-400" /> : <Copy size={18} className="text-[#ffcd4a]" />}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col justify-center">
              {processingRole === 'foreigner' ? (
                <div className="flex items-center gap-3 text-2xl sm:text-3xl text-white/70 font-medium">
                  <Loader2 size={24} className="animate-spin text-[#ffcd4a]" />
                  <span>{foreignLoc.translating}</span>
                </div>
              ) : (
                <p className="text-2xl sm:text-3xl leading-tight text-white/50 font-normal whitespace-pre-line">
                  {foreignLoc.idle}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="sticky bottom-8 left-0 right-0 flex justify-center z-10 h-0 overflow-visible pointer-events-none">
        <div className="flex items-center gap-1 bg-black/30 border border-white/10 backdrop-blur-md rounded-[60px] pl-4 pr-2 py-6 shadow-2xl pointer-events-auto">
          <div className="flex items-center pr-3 mr-1 border-r border-white/10">
            <span className="text-[#e74c3c] font-bold text-[16px]">외국어</span>
            <span className="text-white/30 text-[10px] mx-1.5">▶</span>
            <span className="text-[#3498db] font-bold text-[16px]">한국어</span>
          </div>
          <button
            onClick={() => {
              if (inputTypeForeigner === 'mic') toggleForeignerMic();
              else setInputTypeForeigner('mic');
            }}
            className={`flex items-center justify-center w-10 h-10 rounded-full transition-all duration-300 ${
              inputTypeForeigner === 'mic' 
                ? activeMic === 'foreigner'
                  ? 'bg-red-500 animate-pulse text-white' 
                  : 'bg-[#ffcd4a] text-[#552c24] shadow-md'
                : 'text-white/50 hover:bg-white/10 hover:text-white'
            }`}
            title={inputTypeForeigner === 'mic' ? '말하기' : '음성 입력으로 전환'}
          >
            {inputTypeForeigner === 'mic' && activeMic === 'foreigner' ? <Square fill="currentColor" size={16} /> : <Mic size={18} />}
          </button>
          <button
            onClick={() => setInputTypeForeigner('text')}
            className={`flex items-center justify-center w-10 h-10 rounded-full transition-all duration-300 ${
              inputTypeForeigner === 'text'
                ? 'bg-[#ffcd4a] text-[#552c24] shadow-md'
                : 'text-white/50 hover:bg-white/10 hover:text-white'
            }`}
            title="텍스트 모드로 전환"
          >
            <Pencil size={18} />
          </button>
          <button
            onClick={() => imageInputForeignerRef.current?.click()}
            className="flex items-center justify-center w-10 h-10 rounded-full transition-all duration-300 text-white/50 hover:bg-white/10 hover:text-white"
            title="이미지 번역"
          >
            <Camera size={18} />
            <input 
              type="file" 
              accept="image/*" 
              className="hidden" 
              ref={imageInputForeignerRef}
              onChange={(e) => handleImageChange(e, 'foreigner')} 
            />
          </button>
        </div>
      </div>
    </div>
  );
};
