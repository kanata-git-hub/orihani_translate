import { useState, useRef, useEffect } from 'react';
import { Mic, Square, Languages, Volume2, Loader2, LogOut, Shield, HelpCircle, X, Camera } from 'lucide-react';
import { pcmToBase64, playAudioChunk, resetAudioQueue, setHoldPlayback } from '../audio';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { logout } from '../lib/firebaseUtils';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { HelpModal } from '../components/HelpModal';
import { LOCALIZATION } from '../constants/localization';

export default function App() {
  const [foreignerLang, setForeignerLang] = useLocalStorage<string>('app_foreignerLang', 'ja');
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  
  const handleLogout = async () => {
    await logout();
    navigate('/');
  };
  
  const [activeMic, setActiveMic] = useState<'foreigner' | 'user' | null>(null);
  const activeMicRef = useRef(activeMic);
  
  useEffect(() => {
    activeMicRef.current = activeMic;
  }, [activeMic]);
  
  const [foreignerText, setForeignerText] = useState('');
  const [userText, setUserText] = useState('');
  
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  
  interface TextRegion {
    ymin: number;
    xmin: number;
    ymax: number;
    xmax: number;
    translatedText: string;
    bgColor: string;
    textColor: string;
  }
  
  const [imageTranslateModal, setImageTranslateModal] = useState<{imageUrl: string, regions: TextRegion[] | null, error?: string} | null>(null);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (e.target) {
      e.target.value = ''; // Reset input
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64Url = event.target?.result as string;
      const base64Data = base64Url.split(',')[1];
      
      setImageTranslateModal({ imageUrl: base64Url, regions: null });
      setIsUploadingImage(true);

      try {
        const res = await fetch("/api/translate-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            image: base64Data, 
            mimeType: file.type,
            targetLang: "ko"
          })
        });

        const data = await res.json();
        
        if (res.ok) {
          setImageTranslateModal(prev => prev ? { ...prev, regions: data.regions } : null);
        } else {
          setImageTranslateModal(prev => prev ? { ...prev, error: "번역 오류: " + data.error } : null);
        }
      } catch (err) {
        setImageTranslateModal(prev => prev ? { ...prev, error: "네트워크 오류가 발생했습니다." } : null);
      } finally {
        setIsUploadingImage(false);
      }
    };
    reader.readAsDataURL(file);
  };
  
  const foreignerCompleteRef = useRef('');
  const userCompleteRef = useRef('');
  const foreignerPendingRef = useRef('');
  const userPendingRef = useRef('');

  const [localUnfinalizedForeigner, setLocalUnfinalizedForeigner] = useState('');
  const [localUnfinalizedUser, setLocalUnfinalizedUser] = useState('');

  const lastProcessedIndex = useRef(0);
  const unfinalizedBufferRef = useRef('');
  const lastFinalizedTimeRef = useRef<number>(0);

  const [playingTTS, setPlayingTTS] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [processingRole, setProcessingRole] = useState<'foreigner' | 'user' | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const recognitionRef = useRef<any>(null);
  const sessionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didRestartRef = useRef<boolean>(false);
  const outCtxRef = useRef<AudioContext | null>(null);

  const resetSilenceTimer = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
    }
    silenceTimerRef.current = setTimeout(() => {
      stopRecording();
    }, 10000);
  };

  const getEnsureWs = () => {
    return new Promise<WebSocket>((resolve, reject) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        resolve(wsRef.current);
        return;
      }
      
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/live`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => resolve(ws);
      ws.onerror = (e) => {
        console.error("WS error", e);
        reject(e);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.error) {
            console.error("Live API Error:", msg.error);
            stopRecording();
            return;
          }
          if (msg.audio) {
            if (!outCtxRef.current) {
              const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
              outCtxRef.current = new AudioContextClass({ sampleRate: 24000 });
            }
            if (outCtxRef.current.state === 'suspended') {
              outCtxRef.current.resume();
            }
            playAudioChunk(outCtxRef.current, msg.audio);
          }
          if (msg.interrupted) {
            resetAudioQueue();
          }
          
          const currentMic = msg.role || activeMicRef.current;
          
          if (msg.partial) {
             if (msg.inputTranscription) {
               if (currentMic === 'foreigner') foreignerPendingRef.current = msg.inputTranscription;
               else userPendingRef.current = msg.inputTranscription;
             }
             if (msg.outputTranscription) {
               if (currentMic === 'foreigner') userPendingRef.current = msg.outputTranscription;
               else foreignerPendingRef.current = msg.outputTranscription;
             }
          } else if (msg.turnComplete) {
             // turn is done, move pending to complete
             if (foreignerPendingRef.current) {
                foreignerCompleteRef.current += (foreignerCompleteRef.current ? ' ' : '') + foreignerPendingRef.current;
                foreignerPendingRef.current = '';
             }
             if (userPendingRef.current) {
                userCompleteRef.current += (userCompleteRef.current ? ' ' : '') + userPendingRef.current;
                userPendingRef.current = '';
             }
             setProcessingRole(null);
          } else if (msg.correctedTranscription) {
             const targetRef = currentMic === 'foreigner' ? foreignerCompleteRef : userCompleteRef;
             const lastIdx = targetRef.current.lastIndexOf(msg.originalTranscription);
             if (lastIdx !== -1) {
                targetRef.current = 
                   targetRef.current.substring(0, lastIdx) + 
                   msg.correctedTranscription + 
                   targetRef.current.substring(lastIdx + msg.originalTranscription.length);
             }
          } else {
             // legacy single-shot WS event
             if (msg.inputTranscription) {
               if (currentMic === 'foreigner') {
                 foreignerCompleteRef.current += (foreignerCompleteRef.current ? ' ' : '') + msg.inputTranscription;
               } else if (currentMic === 'user') {
                 userCompleteRef.current += (userCompleteRef.current ? ' ' : '') + msg.inputTranscription;
               }
             }
             if (msg.outputTranscription) {
                if (currentMic === 'foreigner') {
                  userCompleteRef.current += (userCompleteRef.current ? ' ' : '') + msg.outputTranscription;
                } else if (currentMic === 'user') {
                  foreignerCompleteRef.current += (foreignerCompleteRef.current ? ' ' : '') + msg.outputTranscription;
                }
             }
          }
          
          setForeignerText((foreignerCompleteRef.current + " " + foreignerPendingRef.current).trim());
          setUserText((userCompleteRef.current + " " + userPendingRef.current).trim());
        } catch (e) {
          console.error("Error parsing WS message", e);
        }
      };
      
      ws.onclose = () => {
        if (wsRef.current === ws) {
          wsRef.current = null;
        }
      };
    });
  };

  useEffect(() => {
    getEnsureWs().catch(console.error);
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  const initOutCtx = () => {
    if (!outCtxRef.current) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      outCtxRef.current = new AudioContextClass({ sampleRate: 24000 });
    }
    if (outCtxRef.current.state === 'suspended') {
      outCtxRef.current.resume();
    }
  };

  const startRecording = async (role: 'foreigner' | 'user') => {
    setActiveMic(role);
    setForeignerText('');
    setUserText('');
    setLocalUnfinalizedForeigner('');
    setLocalUnfinalizedUser('');
    foreignerCompleteRef.current = '';
    userCompleteRef.current = '';
    foreignerPendingRef.current = '';
    userPendingRef.current = '';
    lastProcessedIndex.current = 0;
    didRestartRef.current = false;
    unfinalizedBufferRef.current = '';
    
    resetAudioQueue();
    initOutCtx();
    if (outCtxRef.current) {
       setHoldPlayback(true, outCtxRef.current);
    }

    if (sessionTimeoutRef.current) {
      clearTimeout(sessionTimeoutRef.current);
    }
    // 5분 자동 종료 타임아웃
    sessionTimeoutRef.current = setTimeout(() => {
      stopRecording();
    }, 5 * 60 * 1000);
    
    resetSilenceTimer();
    
    try {
      await getEnsureWs();

      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) {
        alert("현재 브라우저에서 음성 인식 API를 지원하지 않습니다.");
        setActiveMic(null);
        return;
      }

      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      
      // Map standard ISO code to BCP-47 for foreignerLang
      let recLang = 'ko-KR';
      if (role === 'foreigner') {
        const langMap: Record<string, string> = { "ja": "ja-JP", "en": "en-US", "es": "es-ES", "zh": "zh-CN" };
        recLang = langMap[foreignerLang] || foreignerLang;
      }
      recognition.lang = recLang;

      recognition.onresult = (event: any) => {
        resetSilenceTimer();
        
        if (didRestartRef.current) {
          if (event.results.length === 1 || event.results.length < lastProcessedIndex.current) {
               // Browser clearly cleared the results list (Desktop Chrome behavior)
               lastProcessedIndex.current = 0;
          }
          // The flag is now consumed
          didRestartRef.current = false;
        }
        
        let newFinals = '';
        let unfinalized = '';
        
        for (let i = lastProcessedIndex.current; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            newFinals += event.results[i][0].transcript + ' ';
            lastProcessedIndex.current = i + 1;
            lastFinalizedTimeRef.current = performance.now();
          } else {
            unfinalized += event.results[i][0].transcript;
          }
        }
        
        unfinalizedBufferRef.current = unfinalized;

        if (role === 'foreigner') {
          setLocalUnfinalizedForeigner(unfinalized);
        } else {
          setLocalUnfinalizedUser(unfinalized);
        }

        if (newFinals.trim()) {
           setProcessingRole(role);
           getEnsureWs().then(ws => {
              ws.send(JSON.stringify({ 
               type: 'process_text',
               role: role,
               text: newFinals.trim(),
               targetLanguageCode: role === 'foreigner' ? 'Korean' : foreignerLang
             }));
           }).catch(console.error);
        }
      };

      recognition.onerror = (event: any) => {
        console.error("Speech recognition error", event.error);
        if (event.error === 'not-allowed') {
           alert('마이크 접근이 거부되었습니다. 브라우저의 마이크 권한을 허용해주세요.');
           setActiveMic(null);
        }
      };

      recognition.onend = () => {
        if (activeMicRef.current === role) {
          try {
            didRestartRef.current = true;
            recognition.start();
          } catch (e) {}
        }
      };

      recognition.start();
      recognitionRef.current = recognition;
    } catch (err) {
        console.error('Failed to access microphone', err);
        setActiveMic(null);
    }
  };

  const stopRecording = () => {
    if (sessionTimeoutRef.current) {
      clearTimeout(sessionTimeoutRef.current);
      sessionTimeoutRef.current = null;
    }
    
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    
    const capturedUnfinalized = unfinalizedBufferRef.current.trim();
    const roleToProcess = activeMicRef.current;
    const currentLang = foreignerLang;

    if (recognitionRef.current) {
      // Detach immediately to prevent double processing if the browser fires a final onresult during stop()
      recognitionRef.current.onresult = null;
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    
    // Immediately process any pending text
    if (roleToProcess && capturedUnfinalized) {
      setProcessingRole(roleToProcess);
      getEnsureWs().then(ws => {
          ws.send(JSON.stringify({ 
          type: 'process_text',
          role: roleToProcess,
          text: capturedUnfinalized,
          targetLanguageCode: roleToProcess === 'foreigner' ? 'Korean' : currentLang
        }));
      }).catch(console.error);
    }
    
    // Release playback hold
    if (outCtxRef.current) {
       setHoldPlayback(false, outCtxRef.current);
    }
    
    setActiveMic(null);
    setLocalUnfinalizedForeigner('');
    setLocalUnfinalizedUser('');
    unfinalizedBufferRef.current = '';
  };

  const toggleForeignerMic = () => {
    if (activeMic === 'foreigner') stopRecording();
    else {
      if (activeMic === 'user') stopRecording();
      startRecording('foreigner');
    }
  };

  const toggleUserMic = () => {
    if (activeMic === 'user') stopRecording();
    else {
      if (activeMic === 'foreigner') stopRecording();
      startRecording('user');
    }
  };

  const playTTS = async (text: string) => {
    if (!text) return;
    setPlayingTTS(true);
    resetAudioQueue();
    initOutCtx();
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      const data = await res.json();
      if (data.audio) {
        if (!outCtxRef.current) {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          outCtxRef.current = new AudioContextClass({ sampleRate: 24000 });
        }
        if (outCtxRef.current.state === 'suspended') {
          outCtxRef.current.resume();
        }
        playAudioChunk(outCtxRef.current, data.audio);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setPlayingTTS(false);
    }
  };

  const foreignLoc = LOCALIZATION[foreignerLang] || LOCALIZATION.en;
  const userLoc = LOCALIZATION.ko;

  return (
    <div className="flex flex-col h-[100dvh] w-full max-w-md mx-auto relative shadow-2xl overflow-y-auto font-sans bg-white">
      {/* Top Half: Foreigner View */}
      <div className="flex-1 shrink-0 relative bg-[#552c24] text-white flex flex-col p-8 pb-24">
        <div className="flex justify-between items-start mb-6">
          <div className="flex flex-col gap-3 z-10">
            <span className="font-bold text-[13px] tracking-wide text-[#ffcd4a]/90 flex items-center">{foreignLoc.title}</span>
            <div className="flex items-center gap-2 bg-black/20 hover:bg-black/30 transition-colors px-3 py-1.5 rounded-full text-sm font-medium w-fit">
              <Languages size={16} className="text-[#ffcd4a]" />
              <select
                value={foreignerLang}
                onChange={(e) => setForeignerLang(e.target.value)}
                className="bg-transparent text-white outline-none cursor-pointer appearance-none pr-4"
                style={{ backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23FFFFFF%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right center', backgroundSize: '0.65em auto' }}
              >
                <option value="en" className="text-black">영어</option>
                <option value="ja" className="text-black">일본어</option>
                <option value="es" className="text-black">스페인어</option>
                <option value="zh" className="text-black">중국어</option>
              </select>
            </div>
          </div>
          
          <div className="flex items-center gap-2 z-10 pt-1">
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
        
        <div className="flex-1 overflow-visible w-full">
          <div className="flex flex-col justify-center min-h-full py-4">
            {foreignerText || localUnfinalizedForeigner ? (
              <div className="group relative pr-12">
                <p className="text-2xl sm:text-3xl leading-tight font-medium break-words text-white">
                  {foreignerText} {localUnfinalizedForeigner && <span className="opacity-70">{localUnfinalizedForeigner}</span>}
                </p>
                <button 
                  onClick={() => playTTS(foreignerText)} 
                  className="absolute right-0 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full transition-colors"
                  disabled={playingTTS}
                >
                  {playingTTS ? <Loader2 size={20} className="animate-spin text-[#ffcd4a]" /> : <Volume2 size={20} className="text-[#ffcd4a]" />}
                </button>
              </div>
            ) : (
              <p className="text-2xl sm:text-3xl leading-tight text-white/50 font-normal">
                {activeMic === 'foreigner' ? foreignLoc.listening : processingRole === 'foreigner' ? foreignLoc.translating : foreignLoc.idle}
              </p>
            )}
          </div>
        </div>

        <div className="sticky bottom-8 left-0 right-0 flex justify-center z-10 h-0 overflow-visible pointer-events-none">
          <button
            onClick={toggleForeignerMic}
            className={`w-16 h-16 pointer-events-auto rounded-full flex items-center justify-center transition-all shadow-xl ${
              activeMic === 'foreigner' 
                ? 'bg-red-500 animate-pulse text-white scale-110' 
                : 'bg-[#ffcd4a] text-[#552c24] hover:scale-105'
            }`}
          >
            {activeMic === 'foreigner' ? <Square fill="currentColor" size={24} /> : <Mic size={28} />}
          </button>
        </div>
      </div>

      {/* Divider */}
      <div className="h-2 w-full bg-[#ffcd4a] z-20 shrink-0 shadow-sm relative" />

      {/* Bottom Half: User (Korean) View */}
      <div className="flex-1 shrink-0 relative bg-white text-[#552c24] flex flex-col p-8 pt-24">
        
        <div className="absolute top-6 left-8 z-10">
          <span className="font-bold text-[13px] opacity-50 tracking-wide flex items-center gap-1.5">
            {userLoc.title}
          </span>
        </div>

        <div className="sticky top-8 left-0 right-0 flex justify-center z-10 h-0 overflow-visible pointer-events-none">
          <button
            onClick={toggleUserMic}
            className={`w-16 h-16 pointer-events-auto rounded-full flex items-center justify-center transition-all shadow-xl -translate-y-full ${
              activeMic === 'user' 
                ? 'bg-red-500 animate-pulse text-white scale-110' 
                : 'bg-[#552c24] text-white hover:scale-105'
            }`}
          >
            {activeMic === 'user' ? <Square fill="currentColor" size={24} /> : <Mic size={28} />}
          </button>
        </div>

        <div className="flex-1 overflow-visible w-full">
          <div className="flex flex-col justify-center min-h-full py-4">
            {userText || localUnfinalizedUser ? (
              <div className="group relative pr-12">
                <p className="text-2xl sm:text-3xl leading-tight font-medium break-words text-[#552c24]">
                  {userText} {localUnfinalizedUser && <span className="opacity-70">{localUnfinalizedUser}</span>}
                </p>
                <button 
                  onClick={() => playTTS(userText)} 
                  className="absolute right-0 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center bg-black/5 hover:bg-black/10 rounded-full transition-colors"
                  disabled={playingTTS}
                >
                  {playingTTS ? <Loader2 size={20} className="animate-spin text-[#ffcd4a]" /> : <Volume2 size={20} className="text-[#552c24]" />}
                </button>
              </div>
            ) : (
              <p className="text-2xl sm:text-3xl leading-tight text-[#552c24]/50 font-normal">
                {activeMic === 'user' ? userLoc.listening : processingRole === 'user' ? userLoc.translating : userLoc.idle}
              </p>
            )}
          </div>
        </div>
        
        <div className="absolute bottom-6 right-6 z-10 flex items-center gap-2">
          <label className="flex items-center gap-1.5 bg-black/5 hover:bg-black/10 transition-colors px-3 py-1.5 rounded-full text-xs font-bold text-[#552c24] cursor-pointer">
            {isUploadingImage ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />}
            이미지 번역
            <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
          </label>
          <button 
            onClick={() => setShowHelp(true)}
            className="flex items-center gap-1.5 bg-black/5 hover:bg-black/10 transition-colors px-3 py-1.5 rounded-full text-xs font-bold text-[#552c24]"
          >
            <HelpCircle size={15} />
            사용법
          </button>
        </div>
      </div>

      {/* Image Translate Modal */}
      {imageTranslateModal && (
        <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#111] w-full h-[95%] sm:h-[90%] sm:max-w-md sm:rounded-t-3xl overflow-hidden flex flex-col slide-in-from-bottom-8 mt-auto sm:mt-0 shadow-2xl relative">
            <div className="flex justify-between items-center p-4 bg-black border-b border-white/10 text-white shrink-0">
              <div className="flex items-center gap-2 font-bold text-[#ffcd4a]">
                <Camera size={18} />
                이미지 번역
              </div>
              <button 
                onClick={() => setImageTranslateModal(null)}
                className="p-1 hover:bg-white/10 rounded-full transition-colors text-white/70"
              >
                <X size={24} />
              </button>
            </div>
            
            <div className="relative flex-1 bg-black/5 overflow-hidden flex flex-col items-center justify-center p-4">
              {imageTranslateModal.error ? (
                <div className="bg-white p-6 rounded-2xl text-red-500 shadow-xl font-medium max-w-[80%] text-center">
                  {imageTranslateModal.error}
                </div>
              ) : (
                <div className="relative inline-flex max-w-full max-h-full items-center justify-center rounded-lg overflow-hidden shrink-0 shadow-2xl">
                  <img 
                    src={imageTranslateModal.imageUrl} 
                    alt="Uploaded source" 
                    className="block shadow-xl max-w-full max-h-full shrink-0"
                  />
                  
                  {imageTranslateModal.regions ? (
                    <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
                      {imageTranslateModal.regions.map((r, i) => {
                        const top = r.ymin / 10;
                        const left = r.xmin / 10;
                        const width = (r.xmax - r.xmin) / 10;
                        const height = (r.ymax - r.ymin) / 10;
                        
                        return (
                          <div key={i} style={{
                            position: 'absolute',
                            top: `${top}%`,
                            left: `${left}%`,
                            width: `${width}%`,
                            height: `${height}%`,
                            backgroundColor: r.bgColor || '#ffffff',
                            color: r.textColor || '#000000',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            overflow: 'hidden',
                            padding: '1%',
                            fontWeight: 'bold',
                            textAlign: 'center',
                            fontSize: 'max(10px, min(1.8cqw, 20px))',
                            containerType: 'size',
                            whiteSpace: 'pre-wrap',
                            lineHeight: '1.2',
                            borderRadius: '2px',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                            zIndex: 10
                          }}>
                            {r.translatedText}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center flex-col gap-3 text-white backdrop-blur-[1px] z-20">
                      <Loader2 size={32} className="animate-spin text-[#ffcd4a]" />
                      <p className="font-bold drop-shadow-md">이미지 분석 및 번역 중...</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Help Modal */}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  );
}

