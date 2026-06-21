import { useState, useRef, useEffect } from 'react';
import { Mic, Square, Languages, Volume2, Loader2, LogOut, Shield, HelpCircle, X } from 'lucide-react';
import { playAudioChunk, resetAudioQueue, setHoldPlayback } from '../audio';
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
  
  const foreignerCompleteRef = useRef('');
  const userCompleteRef = useRef('');
  const foreignerPendingRef = useRef('');
  const userPendingRef = useRef('');

  const [localUnfinalizedForeigner, setLocalUnfinalizedForeigner] = useState('');
  const [localUnfinalizedUser, setLocalUnfinalizedUser] = useState('');

  const lastProcessedIndex = useRef(0);
  const unfinalizedBufferRef = useRef('');

  const [playingTTS, setPlayingTTS] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [processingRole, setProcessingRole] = useState<'foreigner' | 'user' | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const recognitionRef = useRef<any>(null);
  const sessionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didRestartRef = useRef<boolean>(false);
  const outCtxRef = useRef<AudioContext | null>(null);

  const lastUserOriginalSpeechRef = useRef<{text: string, time: number}>({text: '', time: 0});
  const lastForeignerOriginalSpeechRef = useRef<{text: string, time: number}>({text: '', time: 0});
  const lastSpeakerRef = useRef<string | null>(null);
  const lastStopTimeRef = useRef<number>(0);
  const activeTurnContextRef = useRef<string>('');

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
    if (lastSpeakerRef.current === 'user' && userCompleteRef.current.trim()) {
       lastUserOriginalSpeechRef.current = { text: userCompleteRef.current, time: lastStopTimeRef.current };
    } else if (lastSpeakerRef.current === 'foreigner' && foreignerCompleteRef.current.trim()) {
       lastForeignerOriginalSpeechRef.current = { text: foreignerCompleteRef.current, time: lastStopTimeRef.current };
    }
    lastSpeakerRef.current = role;

    const opponentSpeechObj = role === 'foreigner' ? lastUserOriginalSpeechRef.current : lastForeignerOriginalSpeechRef.current;
    if (Date.now() - opponentSpeechObj.time < 2 * 60 * 1000) {
       activeTurnContextRef.current = opponentSpeechObj.text;
    } else {
       activeTurnContextRef.current = '';
    }

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
           const currentComplete = role === 'foreigner' ? foreignerCompleteRef.current : userCompleteRef.current;
           const opponentComplete = activeTurnContextRef.current;
           getEnsureWs().then(ws => {
              ws.send(JSON.stringify({ 
               type: 'process_text',
               role: role,
               text: newFinals.trim(),
               previousText: currentComplete.trim(),
               opponentText: opponentComplete.trim(),
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
    lastStopTimeRef.current = Date.now();
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
      const currentComplete = roleToProcess === 'foreigner' ? foreignerCompleteRef.current : userCompleteRef.current;
      const opponentComplete = activeTurnContextRef.current;
      getEnsureWs().then(ws => {
          ws.send(JSON.stringify({ 
          type: 'process_text',
          role: roleToProcess,
          text: capturedUnfinalized,
          previousText: currentComplete.trim(),
          opponentText: opponentComplete.trim(),
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
        
        <div className="absolute bottom-6 right-6 z-10">
          <button 
            onClick={() => setShowHelp(true)}
            className="flex items-center gap-1.5 bg-black/5 hover:bg-black/10 transition-colors px-3 py-1.5 rounded-full text-xs font-bold text-[#552c24]"
          >
            <HelpCircle size={15} />
            사용법
          </button>
        </div>
      </div>

      {/* Help Modal */}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  );
}

