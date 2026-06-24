import { useState, useRef, useEffect } from 'react';
import { Mic, Square, Languages, Volume2, VolumeX, Loader2, LogOut, Shield, HelpCircle, X, Pencil, Send, RotateCcw, Camera } from 'lucide-react';
import { playAudioChunk, resetAudioQueue, setHoldPlayback } from '../audio';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { logout } from '../lib/firebaseUtils';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { HelpModal } from '../components/HelpModal';
import { LOCALIZATION } from '../constants/localization';
import { ImageTranslateModal } from '../components/ImageTranslateModal';
import { renderPronunciation } from '../utils/textUtils';
import { ForeignerPanel } from '../components/chat/ForeignerPanel';
import { UserPanel } from '../components/chat/UserPanel';
import { domToJpeg } from 'modern-screenshot';

export default function App() {
  const [foreignerLang, setForeignerLang] = useLocalStorage<string>('app_foreignerLang', 'ja');
  const [ttsEnabled, setTtsEnabled] = useLocalStorage<boolean>('app_tts_enabled', true);
  const ttsEnabledRef = useRef(ttsEnabled);
  
  useEffect(() => {
    ttsEnabledRef.current = ttsEnabled;
  }, [ttsEnabled]);

  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  
  const handleLogout = async () => {
    await logout();
    navigate('/');
  };
  
  const [activeMic, setActiveMic] = useState<'foreigner' | 'user' | null>(null);
  const activeMicRef = useRef(activeMic);
  
  const [inputTypeForeigner, setInputTypeForeigner] = useState<'mic' | 'text'>('mic');
  const [inputTypeUser, setInputTypeUser] = useState<'mic' | 'text'>('mic');
  const [textInputForeigner, setTextInputForeigner] = useState('');
  const [textInputUser, setTextInputUser] = useState('');

  useEffect(() => {
    activeMicRef.current = activeMic;
  }, [activeMic]);
  
  const [foreignerText, setForeignerText] = useState('');
  const [userText, setUserText] = useState('');
  const [foreignerPronunciation, setForeignerPronunciation] = useState('');
  const [userPronunciation, setUserPronunciation] = useState('');
  
  const foreignerCompleteRef = useRef('');
  const userCompleteRef = useRef('');
  const foreignerPendingRef = useRef('');
  const userPendingRef = useRef('');

  const foreignerPronunciationCompleteRef = useRef('');
  const userPronunciationCompleteRef = useRef('');
  const foreignerPronunciationPendingRef = useRef('');
  const userPronunciationPendingRef = useRef('');

  const [localUnfinalizedForeigner, setLocalUnfinalizedForeigner] = useState('');
  const [localUnfinalizedUser, setLocalUnfinalizedUser] = useState('');

  const lastProcessedIndex = useRef(0);
  const unfinalizedBufferRef = useRef('');

  const [playingTTS, setPlayingTTS] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageTargetLang, setImageTargetLang] = useState<string>('Korean');
  const imageInputForeignerRef = useRef<HTMLInputElement>(null);
  const imageInputUserRef = useRef<HTMLInputElement>(null);
  const [processingRole, setProcessingRole] = useState<'foreigner' | 'user' | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const recognitionRef = useRef<any>(null);
  const sessionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didRestartRef = useRef<boolean>(false);
  const outCtxRef = useRef<AudioContext | null>(null);

  const appContainerRef = useRef<HTMLDivElement>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  const handleCaptureAndDownload = async () => {
    if (!appContainerRef.current) return;
    setIsCapturing(true);
    try {
      // 폰트나 레이아웃이 준비될 수 있도록 약간의 지연
      await new Promise(resolve => setTimeout(resolve, 100));
      const pixelRatio = Math.max(2, window.devicePixelRatio || 1);
      const dataUrl = await domToJpeg(appContainerRef.current, {
        scale: pixelRatio,
        quality: 0.95,
        backgroundColor: '#ffffff'
      });
      
      const link = document.createElement('a');
      link.download = `translation_capture_${Date.now()}.jpg`;
      link.href = dataUrl;
      link.click();
    } catch (error) {
      console.error('Capture failed', error);
      alert('화면 캡처에 실패했습니다.');
    } finally {
      setIsCapturing(false);
    }
  };

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

  const handleReset = () => {
    if (activeMic) stopRecording();
    setForeignerText('');
    setUserText('');
    setForeignerPronunciation('');
    setUserPronunciation('');
    setTextInputForeigner('');
    setTextInputUser('');
    setLocalUnfinalizedForeigner('');
    setLocalUnfinalizedUser('');
    foreignerCompleteRef.current = '';
    userCompleteRef.current = '';
    foreignerPendingRef.current = '';
    userPendingRef.current = '';
    foreignerPronunciationCompleteRef.current = '';
    userPronunciationCompleteRef.current = '';
    foreignerPronunciationPendingRef.current = '';
    userPronunciationPendingRef.current = '';
    lastSpeakerRef.current = null;
    activeTurnContextRef.current = '';
    lastProcessedIndex.current = 0;
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
             if (msg.outputTranscription) {
               if (currentMic === 'foreigner') userPendingRef.current = msg.outputTranscription;
               else foreignerPendingRef.current = msg.outputTranscription;
             }
             if (msg.outputPronunciation) {
               if (currentMic === 'foreigner') userPronunciationPendingRef.current = msg.outputPronunciation;
               else foreignerPronunciationPendingRef.current = msg.outputPronunciation;
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
             if (foreignerPronunciationPendingRef.current) {
                foreignerPronunciationCompleteRef.current += (foreignerPronunciationCompleteRef.current ? ' ' : '') + foreignerPronunciationPendingRef.current;
                foreignerPronunciationPendingRef.current = '';
             }
             if (userPronunciationPendingRef.current) {
                userPronunciationCompleteRef.current += (userPronunciationCompleteRef.current ? ' ' : '') + userPronunciationPendingRef.current;
                userPronunciationPendingRef.current = '';
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
          setForeignerPronunciation((foreignerPronunciationCompleteRef.current + " " + foreignerPronunciationPendingRef.current).trim());
          setUserPronunciation((userPronunciationCompleteRef.current + " " + userPronunciationPendingRef.current).trim());
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
    setForeignerPronunciation('');
    setUserPronunciation('');
    setLocalUnfinalizedForeigner('');
    setLocalUnfinalizedUser('');
    foreignerCompleteRef.current = '';
    userCompleteRef.current = '';
    foreignerPendingRef.current = '';
    userPendingRef.current = '';
    foreignerPronunciationCompleteRef.current = '';
    userPronunciationCompleteRef.current = '';
    foreignerPronunciationPendingRef.current = '';
    userPronunciationPendingRef.current = '';
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
           
           if (role === 'foreigner') {
              foreignerCompleteRef.current += (foreignerCompleteRef.current ? ' ' : '') + newFinals.trim();
              setForeignerText((foreignerCompleteRef.current + " " + foreignerPendingRef.current).trim());
           } else {
              userCompleteRef.current += (userCompleteRef.current ? ' ' : '') + newFinals.trim();
              setUserText((userCompleteRef.current + " " + userPendingRef.current).trim());
           }

           const currentComplete = role === 'foreigner' ? foreignerCompleteRef.current : userCompleteRef.current;
           const opponentComplete = activeTurnContextRef.current;
           getEnsureWs().then(ws => {
              ws.send(JSON.stringify({ 
               type: 'process_text',
               role: role,
               text: newFinals.trim(),
               previousText: currentComplete.trim(),
               opponentText: opponentComplete.trim(),
               targetLanguageCode: role === 'foreigner' ? 'Korean' : foreignerLang,
               ttsEnabled: ttsEnabledRef.current
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
    if (roleToProcess && capturedUnfinalized.trim()) {
      setProcessingRole(roleToProcess);
      
      if (roleToProcess === 'foreigner') {
         foreignerCompleteRef.current += (foreignerCompleteRef.current ? ' ' : '') + capturedUnfinalized.trim();
         setForeignerText((foreignerCompleteRef.current + " " + foreignerPendingRef.current).trim());
      } else {
         userCompleteRef.current += (userCompleteRef.current ? ' ' : '') + capturedUnfinalized.trim();
         setUserText((userCompleteRef.current + " " + userPendingRef.current).trim());
      }

      const currentComplete = roleToProcess === 'foreigner' ? foreignerCompleteRef.current : userCompleteRef.current;
      const opponentComplete = activeTurnContextRef.current;
      getEnsureWs().then(ws => {
          ws.send(JSON.stringify({ 
          type: 'process_text',
          role: roleToProcess,
          text: capturedUnfinalized,
          previousText: currentComplete.trim(),
          opponentText: opponentComplete.trim(),
          targetLanguageCode: roleToProcess === 'foreigner' ? 'Korean' : currentLang,
          ttsEnabled: ttsEnabledRef.current
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

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>, role: 'foreigner' | 'user') => {
    const file = e.target.files?.[0];
    if (file) {
      if (activeMic) stopRecording();
      setImageTargetLang(role === 'foreigner' ? foreignerLang : 'Korean');
      setImageFile(file);
      setShowImageModal(true);
    }
    // reset input
    e.target.value = '';
  };

  const handleSendText = (role: 'foreigner' | 'user') => {
    const textToSend = role === 'foreigner' ? textInputForeigner.trim() : textInputUser.trim();
    if (!textToSend) return;

    if (activeMic) stopRecording();

    setProcessingRole(role);
    lastSpeakerRef.current = role;

    if (role === 'foreigner') {
       foreignerCompleteRef.current += (foreignerCompleteRef.current ? ' ' : '') + textToSend;
       setForeignerText((foreignerCompleteRef.current + " " + foreignerPendingRef.current).trim());
       setTextInputForeigner('');
    } else {
       userCompleteRef.current += (userCompleteRef.current ? ' ' : '') + textToSend;
       setUserText((userCompleteRef.current + " " + userPendingRef.current).trim());
       setTextInputUser('');
    }

    const currentComplete = role === 'foreigner' ? foreignerCompleteRef.current : userCompleteRef.current;
    const opponentComplete = activeTurnContextRef.current;

    getEnsureWs().then(ws => {
      ws.send(JSON.stringify({ 
        type: 'process_text',
        role: role,
        text: textToSend,
        previousText: currentComplete.trim(),
        opponentText: opponentComplete.trim(),
        targetLanguageCode: role === 'foreigner' ? 'Korean' : foreignerLang,
        ttsEnabled: ttsEnabledRef.current
      }));
    }).catch(console.error);
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
    <div ref={appContainerRef} className="flex flex-col h-[100dvh] w-full max-w-md mx-auto relative shadow-2xl overflow-y-auto font-sans bg-white">
      <ForeignerPanel
        foreignLoc={foreignLoc}
        foreignerLang={foreignerLang}
        setForeignerLang={setForeignerLang}
        ttsEnabled={ttsEnabled}
        setTtsEnabled={setTtsEnabled}
        isAdmin={isAdmin}
        handleLogout={handleLogout}
        navigate={navigate}
        handleReset={handleReset}
        inputTypeForeigner={inputTypeForeigner}
        setInputTypeForeigner={setInputTypeForeigner}
        activeMic={activeMic}
        toggleForeignerMic={toggleForeignerMic}
        foreignerText={foreignerText}
        localUnfinalizedForeigner={localUnfinalizedForeigner}
        foreignerPronunciation={foreignerPronunciation}
        textInputForeigner={textInputForeigner}
        setTextInputForeigner={setTextInputForeigner}
        handleSendText={handleSendText}
        playingTTS={playingTTS}
        playTTS={playTTS}
        processingRole={processingRole}
        imageInputForeignerRef={imageInputForeignerRef}
        handleImageChange={handleImageChange}
      />

      {/* Divider */}
      <div className="h-2 w-full bg-[#ffcd4a] z-20 shrink-0 shadow-sm relative" />

      <UserPanel
        userLoc={userLoc}
        inputTypeUser={inputTypeUser}
        setInputTypeUser={setInputTypeUser}
        activeMic={activeMic}
        toggleUserMic={toggleUserMic}
        userText={userText}
        localUnfinalizedUser={localUnfinalizedUser}
        userPronunciation={userPronunciation}
        textInputUser={textInputUser}
        setTextInputUser={setTextInputUser}
        handleSendText={handleSendText}
        playingTTS={playingTTS}
        playTTS={playTTS}
        processingRole={processingRole}
        imageInputUserRef={imageInputUserRef}
        handleImageChange={handleImageChange}
        setShowHelp={setShowHelp}
        handleCaptureAndDownload={handleCaptureAndDownload}
        isCapturing={isCapturing}
      />

      {/* Help Modal */}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}

      <ImageTranslateModal 
        isOpen={showImageModal} 
        onClose={() => {
          setShowImageModal(false);
          setImageFile(null);
        }} 
        targetLang={imageTargetLang}
        file={imageFile}
      />
    </div>
  );
}

