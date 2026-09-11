import React, { useState, useRef, useEffect, startTransition } from 'react';
import { X, Loader2, Download, Copy, Check, Calculator, Map, Search, AlignLeft, Info, Lightbulb, ZoomIn, ZoomOut } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';


import { composeTranslation, validBox, type TextBlock, type ImageLayoutMode } from '../utils/imageLayout';

interface ExtractedData {
  amount?: number | null;
  currency?: string | null;
  location_keyword?: string | null;
  search_keyword?: string | null;
  summary?: string | null;
}

interface ImageTranslateModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetLang: string;
  file: File | null;
}

export function ImageTranslateModal({ isOpen, onClose, targetLang, file }: ImageTranslateModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [renderError, setRenderError] = useState('');
  const [layoutMode, setLayoutMode] = useState<ImageLayoutMode>('photo');
  const [zoom, setZoom] = useState(1);
  const [blocks, setBlocks] = useState<TextBlock[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<TextBlock | null>(null);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [showCalcModal, setShowCalcModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [viewMode, setViewMode] = useState<'original' | 'image' | 'text'>('image');
  const [copiedIndex, setCopiedIndex] = useState<number | 'all' | null>(null);
  
  const [renderedImage, setRenderedImage] = useState<{ url: string; file: File; sourceAspect: number } | null>(null);
  useEffect(() => {
    setRenderedImage(null);
    setRenderError('');
    if (!isOpen || loading || !imageSrc) return;
    let cancelled = false;
    let url: string | undefined;
    const original = new Image();
    original.src = imageSrc;
    original.decode().then(() => composeTranslation(imageSrc, blocks, {mode: layoutMode})).then(blob => {
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      setRenderedImage({ url, file: new File([blob], `translated_${Date.now()}.png`, { type: 'image/png' }), sourceAspect: original.naturalWidth / original.naturalHeight });
    }).catch(err => { if (!cancelled) { console.error('Image composition failed:', err); setRenderError('이미지 배치를 완료하지 못했습니다. 번역문은 문자 탭에 보관되어 있습니다.'); } });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [isOpen, loading, imageSrc, blocks, layoutMode]);
  const exportRef = useRef<HTMLDivElement>(null);

  const handleCopy = async (text: string, index: number | 'all') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  const handleSaveImage = async () => {
    if (!renderedImage) return;
    setIsSaving(true);
    setError('');
    try {
      // The file is prepared before the click, preserving Safari user activation.
      if (navigator.canShare?.({ files: [renderedImage.file] })) {
        await navigator.share({ files: [renderedImage.file] });
      } else {
        const link = document.createElement('a');
        link.download = renderedImage.file.name;
        link.href = renderedImage.url;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setError('저장이 지원되지 않으면 아래 이미지를 길게 눌러 저장해 주세요.');
      }
    } finally { setIsSaving(false); }
  };

  useEffect(() => {
    if (!isOpen) {
      // Allow exit animations to complete before thoroughly purging states
      const timer = setTimeout(() => {
        setBlocks([]);
        setCategory(null);
        setExtractedData(null);
        setImageSrc(null);
        setError('');
        setSelectedBlock(null);
        setShowSummaryModal(false);
        setShowCalcModal(false);
        setLoading(true);
      }, 400);
      return () => clearTimeout(timer);
    }
    
    if (!file) return;

    let isMounted = true;

    // 1. 초고속 이미지 선-렌더링 (Fast initial image rendering)
    // Safari html-to-image 호환성 및 메모리 문제(초고해상도 원본 렌더링 시 하얗게 나오는 현상)를 방지하기 위해,
    // 초기 원본 Data URL 렌더링을 생략하고, 워커에서 압축된 이미지만을 렌더링합니다.
    setLoading(true);
    setBlocks([]);
    setImageSrc(null);
    setViewMode('image');
    setZoom(1);
    setError('');
    setRenderError('');

    const processImage = async () => {
      // 2. 모션과 연산의 분리 (Absolute Delay)
      // 모달이 처음 뜨는 애니메이션이 완전히 끝날 때까지 600ms 동안 무거운 작업을 하지 않습니다.
      await new Promise(resolve => setTimeout(resolve, 600));
      if (!isMounted) return;

      try {
        const processAndCompressImage = async (f: File): Promise<{ mimeType: string, base64: string }> => {
          // 1. Web Worker와 OffscreenCanvas 지원 여부 확인 (최신 삼성 인터넷, 크롬 등 완벽 지원)
          if (window.Worker && window.OffscreenCanvas && window.createImageBitmap) {
            try {
              // createImageBitmap은 메인 스레드를 멈추지 않는 매우 빠른 비동기 디코딩 함수입니다.
              const imageBitmap = await createImageBitmap(f);
              
              return await new Promise((resolve, reject) => {
                // 워커 소스 코드를 문자열로 바로 정의 (프론트엔드 환경에서 별도 파일 없이 구동)
                const workerCode = `
                  self.onmessage = async function(e) {
                    try {
                      const { imageBitmap, maxSize, quality } = e.data;
                      let width = imageBitmap.width;
                      let height = imageBitmap.height;

                      if (width > height) {
                        if (width > maxSize) {
                          height = Math.round(height * (maxSize / width));
                          width = maxSize;
                        }
                      } else {
                        if (height > maxSize) {
                          width = Math.round(width * (maxSize / height));
                          height = maxSize;
                        }
                      }

                      // 화면에 보이지 않는 워커 전용 캔버스 생성
                      const canvas = new OffscreenCanvas(width, height);
                      const ctx = canvas.getContext('2d');
                      ctx.drawImage(imageBitmap, 0, 0, width, height);

                      // Web Worker 내에서 압축 처리
                      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: quality });
                      
                      const reader = new FileReader();
                      reader.onloadend = () => {
                        // 결과값을 메인 스레드로 전송
                        self.postMessage({ success: true, base64: reader.result, mimeType: 'image/jpeg' });
                      };
                      reader.onerror = () => {
                        self.postMessage({ success: false, error: 'Failed to read blob object' });
                      };
                      reader.readAsDataURL(blob);
                    } catch (err) {
                      self.postMessage({ success: false, error: err.message });
                    }
                  };
                `;
                
                const blobCode = new Blob([workerCode], { type: 'application/javascript' });
                const workerUrl = URL.createObjectURL(blobCode);
                const worker = new Worker(workerUrl);

                worker.onmessage = (e) => {
                  URL.revokeObjectURL(workerUrl);
                  worker.terminate();
                  if (e.data.success) {
                    // "data:image/jpeg;base64," 접두사 제거
                    const base64Data = e.data.base64.split(',')[1];
                    resolve({ mimeType: e.data.mimeType, base64: base64Data });
                  } else {
                    reject(new Error(e.data.error));
                  }
                };

                worker.onerror = (err) => {
                  URL.revokeObjectURL(workerUrl);
                  worker.terminate();
                  reject(err);
                };

                // 워커로 비트맵 "소유권"을 완전히 넘김 (Zero-copy 방식, 초고속)
                worker.postMessage({ imageBitmap, maxSize: 2048, quality: 0.92 }, [imageBitmap]);
              });
            } catch (err) {
              console.warn('Web Worker compression failed, falling back to main thread.', err);
              // 웹 워커 처리가 모종의 이유로 실패하면, 기존 로직(메인 스레드 방식)으로 자연스럽게 넘어갑니다.
            }
          }

          // --- [폴백(Fallback)] 웹 워커를 지원하거나 실패했을 경우 실행되는 메인 스레드 로직 ---
          return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(f);
            
            img.onload = () => {
              URL.revokeObjectURL(url);
              const MAX_SIZE = 2048;
              let width = img.width;
              let height = img.height;
              
              if (width > height) {
                if (width > MAX_SIZE) {
                  height = Math.round(height * (MAX_SIZE / width));
                  width = MAX_SIZE;
                }
              } else {
                if (height > MAX_SIZE) {
                  width = Math.round(width * (MAX_SIZE / height));
                  height = MAX_SIZE;
                }
              }
              
              const canvas = document.createElement('canvas');
              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext('2d');
              if (!ctx) {
                reject(new Error("Failed to get canvas 2d context"));
                return;
              }
              
              ctx.drawImage(img, 0, 0, width, height);
              // 압축 품질 92% 적용 (100%시 파일 크기 비대화 방지)
              const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
              const base64Data = dataUrl.split(',')[1];
              resolve({ mimeType: 'image/jpeg', base64: base64Data });
            };
            
            img.onerror = () => {
              URL.revokeObjectURL(url);
              reject(new Error("Failed to load image for compression"));
            };
            
            img.src = url;
          });
        };

        const { mimeType, base64 } = await processAndCompressImage(file);

        if (!isMounted) return;
        
        // Safari html-to-image 버그 방지 (초고해상도 원본 대신 압축된 이미지 사용)
        setImageSrc(`data:${mimeType};base64,${base64}`);

        const response = await fetch('/api/translate-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageParams: { mimeType, data: base64 },
            targetLang
          })
        });

        if (!isMounted) return;

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error || 'Failed to translate image');
        }

        const data = await response.json();
        if (!isMounted) return;
        
        // 3. 상태 동기화 단절 및 보이지 않는 렌더링
        // 박스들을 DOM에 먼저 주입하되, loading 상태는 유지합니다.
        startTransition(() => {
          setBlocks(data.blocks || []);
          setLayoutMode(data.layout_mode === 'comic' ? 'comic' : data.layout_mode === 'photo' || ['price','product','long_text','location'].includes(data.category) ? 'photo' : 'comic');
          setCategory(data.category || null);
          setExtractedData(data.extracted_data || null);
        });
        
        // 박스들이 Reflow 되면서 브라우저가 버벅거릴 수 있으므로 300ms 후에 loading을 풀어줍니다.
        await new Promise(resolve => setTimeout(resolve, 300));
        
      } catch (err: any) {
        if (!isMounted) return;
        setError('이미지를 인식하지 못했습니다. 다시 시도해주세요.');
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    processImage();

    return () => {
      isMounted = false;
    };
  }, [isOpen, file, targetLang]);

  const renderSmartChips = () => {
    if (loading || !extractedData) return null;

    const baseClass = "flex items-center gap-2 px-4 py-2.5 bg-white/95 backdrop-blur-md rounded-full shadow-[0_4px_15px_rgba(0,0,0,0.1)] border border-white/60 text-sm font-bold text-gray-800 hover:scale-105 active:scale-95 transition-all whitespace-nowrap flex-shrink-0";
    const chips = [];

    const curr = extractedData?.currency?.toUpperCase();
    if (extractedData?.amount != null && curr && curr !== 'KRW' && curr !== '원' && curr !== '₩') {
      chips.push(
        <button key="price" onClick={() => setShowCalcModal(true)} className={baseClass}>
          <Calculator size={18} className="text-blue-500" />
          <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">예상 환율</span>
        </button>
      );
    }

    if (extractedData?.location_keyword) {
      chips.push(
        <a key="map" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(extractedData.location_keyword)}`} target="_blank" rel="noreferrer" className={baseClass}>
          <Map size={18} className="text-green-500" />
          <span className="bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent">지도 검색</span>
        </a>
      );
    }

    if (extractedData?.search_keyword) {
      chips.push(
        <a key="search" href={`https://www.google.com/search?q=${encodeURIComponent(extractedData.search_keyword)}`} target="_blank" rel="noreferrer" className={baseClass}>
          <Search size={18} className="text-purple-500" />
          <span className="bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">웹 검색</span>
        </a>
      );
    }

    if (extractedData?.summary) {
      if (category === 'long_text') {
        chips.push(
          <button key="summary" onClick={() => setShowSummaryModal(true)} className={baseClass}>
            <AlignLeft size={18} className="text-orange-500" />
            <span className="bg-gradient-to-r from-orange-600 to-amber-600 bg-clip-text text-transparent">3줄 요약</span>
          </button>
        );
      } else {
        chips.push(
          <button key="summary" onClick={() => setShowSummaryModal(true)} className={baseClass}>
            <Lightbulb size={18} className="text-amber-500" />
            <span className="bg-gradient-to-r from-amber-500 to-orange-500 bg-clip-text text-transparent">이게 뭐야?</span>
          </button>
        );
      }
    }

    if (chips.length === 0) return null;

    return (
      <div className="flex flex-wrap justify-center gap-2 max-w-[90vw] md:max-w-[400px]">
        {chips}
      </div>
    );
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-2 md:p-4"
        >
          <motion.div 
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="relative w-full max-w-[95vw] lg:max-w-6xl h-full max-h-[95vh] bg-gray-50 rounded-3xl shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex flex-wrap gap-2 items-center justify-between px-4 py-3 border-b border-black/5 bg-white z-20">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-bold text-[#552c24] whitespace-nowrap">이미지 번역</h2>
                
                {!loading && blocks.length > 0 && (
                  <div className="flex bg-gray-100/80 rounded-lg p-0.5 flex-shrink-0">
                    <button 
                      onClick={() => setViewMode('original')}
                      className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${viewMode === 'original' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      원본
                    </button>
                    <button 
                      onClick={() => setViewMode('image')}
                      className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${viewMode === 'image' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      이미지
                    </button>
                    <button 
                      onClick={() => setViewMode('text')}
                      className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${viewMode === 'text' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      문자
                    </button>
                  </div>
                )}
              </div>
              
              <div className="flex items-center gap-1 ml-auto">
                {!loading && imageSrc && viewMode !== 'text' && (
                  <>
                    <button onClick={() => setZoom(z => Math.max(1, z - 1))} disabled={zoom === 1} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-black/5 text-[#552c24] disabled:opacity-30" title="이미지 축소" aria-label="이미지 축소"><ZoomOut size={18}/></button>
                    <span className="text-xs text-[#552c24] tabular-nums" aria-live="polite">{zoom}×</span>
                    <button onClick={() => setZoom(z => Math.min(4, z + 1))} disabled={zoom === 4} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-black/5 text-[#552c24] disabled:opacity-30" title="이미지 확대" aria-label="이미지 확대"><ZoomIn size={18}/></button>
                  </>
                )}
                {!loading && blocks.length > 0 && viewMode === 'image' && (
                  <button 
                    onClick={handleSaveImage}
                    disabled={isSaving || !renderedImage}
                    className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-black/5 transition-colors text-[#552c24] disabled:opacity-50"
                    title="이미지 저장"
                  >
                    {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                  </button>
                )}
                <button 
                  onClick={onClose}
                  aria-label="이미지 번역 닫기"
                  className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-black/5 transition-colors text-[#552c24]"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

        {/* Content */}
        <div className="flex-1 overflow-auto relative bg-[#e5e5e5] z-10 w-full min-h-0">
          <AnimatePresence>
            {(loading || (viewMode === 'image' && imageSrc && !renderedImage && !error && !renderError)) && (
              <motion.div 
                key="loading-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
                className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-white/90"
              >
                <Loader2 className="w-12 h-12 animate-spin text-[#ffcd4a] mb-4" />
                <p className="text-[#552c24] font-medium animate-pulse">이미지를 분석하고 번역중입니다...</p>
              </motion.div>
            )}
          </AnimatePresence>
          
          {error && (
            <div role="alert" className="m-4 bg-red-100 text-red-700 p-4 rounded-xl text-center font-medium">
              {error}
            </div>
          )}
          {renderError && viewMode === 'image' && <div role="alert" className="m-4 bg-amber-50 text-amber-900 p-3 rounded-xl text-sm">{renderError}</div>}

          {imageSrc && (viewMode === 'image' || viewMode === 'original') && (
            <div className="relative w-full p-2 md:p-6">
              <div 
                ref={exportRef}
                className="relative shadow-lg rounded-xl"
                style={{width: `${zoom * 100}%`}}
              >
                <img 
                  src={viewMode === 'image' && renderedImage ? renderedImage.url : imageSrc}
                  alt={viewMode === 'original' ? '번역 원본' : '번역 이미지'}
                  onClick={event => {
                    if (viewMode !== 'image' || !renderedImage) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    const x = (event.clientX - rect.left) / rect.width * 1000;
                    const y = (event.clientY - rect.top) / rect.width * renderedImage.sourceAspect * 1000;
                    const block = blocks.find(block => validBox(block.box) && y >= block.box[0] && y <= block.box[2] && x >= block.box[1] && x <= block.box[3]);
                    if (block) setSelectedBlock(block);
                  }}
                  className="block rounded-xl"
                  style={{ width: '100%', height: 'auto' }}
                />
                

              </div>
            </div>
          )}

          {!loading && blocks.length > 0 && viewMode === 'text' && (
            <div className="absolute inset-0 overflow-y-auto p-4 flex justify-center items-start bg-gray-50/50">
              <div className="w-full max-w-2xl bg-white rounded-xl shadow-sm border border-black/5 p-5 sm:p-8 my-2 sm:my-8 flex flex-col gap-6">
                
                {/* 번역문 그룹 */}
                <motion.div 
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="flex flex-col gap-3"
                >
                  <h3 className="text-sm font-bold text-gray-500 border-b border-gray-100 pb-2">번역문</h3>
                  <div className="flex flex-col gap-1.5">
                    {blocks.map((block, idx) => (
                      <p key={idx} className="text-[16px] font-bold text-gray-900 leading-snug break-keep">
                        {block.translation}
                      </p>
                    ))}
                  </div>
                </motion.div>

                {/* 원문 그룹 */}
                <motion.div 
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.1 }}
                  className="flex flex-col gap-3"
                >
                  <h3 className="text-sm font-bold text-gray-500 border-b border-gray-100 pb-2">원문</h3>
                  <div className="flex flex-col gap-0.5">
                    {blocks.map((block, idx) => (
                      <div key={idx} className="flex items-start gap-3 group">
                        <p className="text-[14px] text-gray-400 font-medium leading-snug break-all flex-1 py-1">
                          {block.original}
                        </p>
                        <button
                          onClick={() => handleCopy(block.original, idx)}
                          className="w-7 h-7 flex items-center justify-center flex-shrink-0 rounded-full bg-gray-50 hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition-all text-gray-400 hover:text-gray-600 mt-0.5"
                          title="원문 복사"
                        >
                          {copiedIndex === idx ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
                        </button>
                      </div>
                    ))}
                  </div>
                </motion.div>

              </div>
            </div>
          )}
        </div>
        
        {/* Smart Chip Floating Action */}
        <AnimatePresence>
          {!loading && !selectedBlock && viewMode === 'image' && category && category !== 'none' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="absolute bottom-6 left-0 right-0 flex justify-center z-30 pointer-events-none"
            >
              <div className="pointer-events-auto">
                {renderSmartChips()}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bottom Details Panel */}
        <AnimatePresence>
          {selectedBlock && viewMode === 'image' && (
            <motion.div 
              initial={{ y: "100%", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "100%", opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="absolute bottom-0 left-0 right-0 bg-white shadow-[0_-10px_40px_rgba(0,0,0,0.15)] rounded-t-3xl p-6 z-40 border-t border-black/5"
            >
              <div className="flex justify-between items-start mb-4">
                <h3 className="font-bold text-lg text-[#552c24]">번역 상세</h3>
                <button 
                  onClick={() => setSelectedBlock(null)}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-black/5 hover:bg-black/10 transition-colors text-[#552c24]"
                >
                  <X size={16} />
                </button>
              </div>
              
              <div className="space-y-4 max-h-[30vh] overflow-y-auto no-scrollbar">
                <div className="bg-[#ffcd4a]/10 p-3 rounded-xl border border-[#ffcd4a]/20">
                  <p className="text-xs font-semibold text-[#552c24]/50 mb-1">번역</p>
                  <p className="text-lg font-bold text-[#552c24] break-words leading-relaxed">{selectedBlock.translation}</p>
                </div>
                <div className="px-1">
                  <p className="text-xs font-semibold text-black/30 mb-1">원문</p>
                  <p className="text-sm text-gray-500 break-words">{selectedBlock.original}</p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Smart Chip Modals Overlay */}
        <AnimatePresence>
           {(showSummaryModal || showCalcModal) && (
             <motion.div
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               exit={{ opacity: 0 }}
               className="absolute inset-0 bg-black/40 backdrop-blur-sm z-40"
               onClick={() => { setShowSummaryModal(false); setShowCalcModal(false); }}
             />
           )}
        </AnimatePresence>

        {/* Smart Chip Modals */}
        <AnimatePresence>
          {showSummaryModal && extractedData?.summary && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="absolute inset-x-4 top-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-2xl p-6 z-50 border border-black/10"
            >
              <div className="flex justify-between items-center mb-4">
                {category === 'long_text' ? (
                  <div className="flex items-center gap-2 text-orange-600">
                    <AlignLeft size={20} />
                    <h3 className="font-bold text-lg">3줄 요약</h3>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-amber-500">
                    <Lightbulb size={20} />
                    <h3 className="font-bold text-lg">이게 뭐야? (사진 정보)</h3>
                  </div>
                )}
                <button onClick={() => setShowSummaryModal(false)} className="p-1 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500">
                  <X size={16} />
                </button>
              </div>
              <div className="space-y-3 text-gray-700 leading-relaxed text-[15px]">
                {extractedData.summary.split('\n').map((line, i) => (
                  <p key={i} className="break-keep">{line.replace(/^[-*•]\s*/, '• ')}</p>
                ))}
              </div>
            </motion.div>
          )}

          {showCalcModal && extractedData?.amount != null && extractedData?.currency && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="absolute inset-x-4 top-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-2xl p-6 z-50 border border-black/10"
            >
              <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-2 text-blue-600">
                  <Calculator size={20} />
                  <h3 className="font-bold text-lg">예상 환율</h3>
                </div>
                <button onClick={() => setShowCalcModal(false)} className="p-1 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500">
                  <X size={16} />
                </button>
              </div>
              
              <div className="flex flex-col gap-4">
                <div className="flex justify-between items-end border-b border-gray-100 pb-3">
                  <span className="text-gray-500 font-medium">현지 가격</span>
                  <span className="text-2xl font-bold text-gray-900">{extractedData.amount.toLocaleString()} <span className="text-base text-gray-500 ml-1">{extractedData.currency}</span></span>
                </div>
                <div className="flex justify-between items-end pb-2">
                  <span className="text-gray-500 font-medium">원화 예상가</span>
                  <span className="text-3xl font-black text-blue-600">
                    {(() => {
                      const amount = extractedData.amount || 0;
                      const curr = extractedData.currency?.toUpperCase();
                      let krw = 0;
                      if (curr === 'KRW' || curr === '원' || curr === '₩') krw = amount;
                      else if (curr === 'JPY' || curr === '엔' || curr === '¥') krw = amount * 9.0;
                      else if (curr === 'USD' || curr === '$') krw = amount * 1350;
                      else if (curr === 'EUR' || curr === '€') krw = amount * 1450;
                      else if (curr === 'CNY' || curr === '위안' || curr === '¥') krw = amount * 190;
                      else if (curr === 'TWD' || curr === '대만 달러') krw = amount * 42;
                      else krw = amount * 1000;
                      return Math.round(krw).toLocaleString();
                    })()}
                    <span className="text-xl text-blue-400 ml-1.5 font-bold">원</span>
                  </span>
                </div>
                <p className="text-xs text-gray-400 text-center mt-2 bg-gray-50 p-2 rounded-lg">
                  * 실시간 환율이 아닌 대략적인 참고용입니다.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  )}
</AnimatePresence>
  );
}
