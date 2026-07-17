import React, { useState, useEffect, useRef } from 'react';
import { X, Loader2, Download, AlertCircle, StopCircle, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { db } from '../lib/db';
import jsPDF from 'jspdf';
import { domToJpeg } from 'modern-screenshot';

interface TextBlock {
  original: string;
  translation: string;
  box: [number, number, number, number];
}

interface PageData {
  id: string;
  file: File;
  status: 'pending' | 'processing' | 'completed' | 'error';
  originalBase64?: string;
  blocks?: TextBlock[];
}

interface DocumentTranslateModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetLang: string;
  files: File[];
}

const FontAdjustableText = ({ text, box }: { text: string, box: number[] }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const textNode = textRef.current;
    if (!container || !textNode) return;

    let min = 2;
    let max = 400;
    let best = 2;
    const maxHeight = container.clientHeight;
    const maxWidth = container.clientWidth;

    for (let i = 0; i < 15; i++) {
      const mid = (min + max) / 2;
      textNode.style.fontSize = `${mid}px`;
      if (textNode.scrollHeight > maxHeight || textNode.scrollWidth > maxWidth) {
        max = mid;
      } else {
        best = mid;
        min = mid;
      }
    }
    textNode.style.fontSize = `${Math.max(2, best * 0.95)}px`;
    textNode.style.opacity = '1';
  }, [text, box]);

  return (
    <div 
      ref={containerRef}
      className="w-full h-full flex flex-col items-center justify-center relative rounded-sm overflow-hidden bg-white p-0.5 sm:p-1"
    >
      <div 
        ref={textRef}
        className="font-bold w-full h-auto text-center"
        style={{ 
          color: '#111827',
          lineHeight: 1.15,
          wordBreak: 'keep-all',
          overflowWrap: 'break-word',
          letterSpacing: '-0.02em',
          whiteSpace: 'pre-wrap',
          opacity: 0,
        }}
      >
        {text}
      </div>
    </div>
  );
};

export function DocumentTranslateModal({ isOpen, onClose, targetLang, files }: DocumentTranslateModalProps) {
  const [pages, setPages] = useState<PageData[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [stopRequested, setStopRequested] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [showViewer, setShowViewer] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showConfirmClose, setShowConfirmClose] = useState(false);

  // compress image logic
  const compressImage = async (f: File): Promise<{ mimeType: string, base64: string }> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(f);
      
      const timeoutId = setTimeout(() => {
        reject(new Error("Image compression timed out"));
      }, 10000);

      img.onload = () => {
        clearTimeout(timeoutId);
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
        ctx?.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
        resolve({ mimeType: 'image/jpeg', base64: dataUrl.split(',')[1] });
      };
      img.onerror = () => {
        clearTimeout(timeoutId);
        reject(new Error("Failed to load image"));
      };
      img.src = url;
    });
  };

  useEffect(() => {
    if (!isOpen || files.length === 0) return;

    const init = async () => {
      processingRef.current = false;
      setPages(files.map((f, i) => ({ id: `${i}`, file: f, status: 'pending' })));
      setIsProcessing(true);
      setStopRequested(false);
      setShowViewer(false);

      const session = await db.createSession(`번역본 (${files.length}장) - ${new Date().toLocaleString()}`, files.length);
      setSessionId(session.id);
    };

    init();
  }, [isOpen, files]);

  const processingRef = useRef(false);
  const stopRequestedRef = useRef(stopRequested);
  
  useEffect(() => {
    stopRequestedRef.current = stopRequested;
  }, [stopRequested]);

  useEffect(() => {
    if (!isOpen || !isProcessing || !sessionId) return;
    if (processingRef.current) return;
    if (stopRequestedRef.current) {
      setIsProcessing(false);
      return;
    }

    let isMounted = true;
    processingRef.current = true;

    const processAll = async () => {
      for (let nextIdx = 0; nextIdx < files.length; nextIdx++) {
        if (!isMounted || stopRequestedRef.current) break;

        setPages(prev => prev.map((p, i) => i === nextIdx ? { ...p, status: 'processing' } : p));

        const file = files[nextIdx];
        let retryCount = 0;
        let success = false;
        let resultData: any = null;
        let compressed: { mimeType: string, base64: string } | null = null;

        while (retryCount < 2 && !success && isMounted && !stopRequestedRef.current) {
          try {
            if (!compressed) {
              compressed = await compressImage(file);
            }

            const response = await fetch('/api/translate-image', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                imageParams: { mimeType: compressed.mimeType, data: compressed.base64 },
                targetLang
              })
            });

            if (!response.ok) {
              if (response.status === 429) {
                await new Promise(r => setTimeout(r, 3000));
                retryCount++;
                continue;
              }
              throw new Error('API Error ' + response.status);
            }

            resultData = await response.json();
            success = true;
          } catch (err) {
            console.error("Error in loop:", err);
            await new Promise(r => setTimeout(r, 2000));
            retryCount++;
          }
        }

        if (!isMounted) break;

        if (success && compressed && resultData) {
          setPages(prev => prev.map((p, i) => i === nextIdx ? { 
            ...p, 
            status: 'completed',
            originalBase64: `data:${compressed!.mimeType};base64,${compressed!.base64}`,
            blocks: resultData.blocks 
          } : p));

          await db.savePage({
            id: `${sessionId}_${nextIdx}`,
            sessionId,
            pageIndex: nextIdx,
            originalImageBase64: `data:${compressed!.mimeType};base64,${compressed!.base64}`,
            translatedImageBase64: '', 
            blocks: resultData.blocks
          });
        } else {
          // If stopped or errored, mark as error so we can retry or at least show it
          setPages(prev => prev.map((p, i) => i === nextIdx ? { ...p, status: 'error' } : p));
        }
        
        // Always show viewer after a page is processed
        setShowViewer(true);
      }
      
      if (isMounted) {
        setIsProcessing(false);
        processingRef.current = false;
      }
    };

    processAll();

    return () => { 
      isMounted = false; 
      processingRef.current = false;
    };
  }, [sessionId, isOpen, isProcessing, files, targetLang]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isProcessing && !stopRequested) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isProcessing, stopRequested]);

  const handleExportPDF = async () => {
    if (!sessionId) return;
    setIsExporting(true);
    try {
      const pdf = new jsPDF({ unit: 'px', format: 'a4', compress: true });
      let isFirstPage = true;

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        if (page.status !== 'completed') continue;
        
        const element = document.getElementById(`page-render-${i}`);
        if (!element) continue;

        const imgData = await domToJpeg(element, { 
          scale: 2, 
          backgroundColor: '#ffffff',
          quality: 0.95
        });
        
        const img = new Image();
        img.src = imgData;
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
        });

        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();
        const imgRatio = img.width / img.height;
        const pdfRatio = pdfWidth / pdfHeight;

        let renderWidth = pdfWidth;
        let renderHeight = pdfHeight;
        
        if (imgRatio > pdfRatio) {
          renderHeight = pdfWidth / imgRatio;
        } else {
          renderWidth = pdfHeight * imgRatio;
        }

        if (!isFirstPage) pdf.addPage();
        isFirstPage = false;
        
        const xOffset = (pdfWidth - renderWidth) / 2;
        const yOffset = (pdfHeight - renderHeight) / 2;

        pdf.addImage(imgData, 'JPEG', xOffset, yOffset, renderWidth, renderHeight);
      }

      pdf.save(`translation_${Date.now()}.pdf`);
    } catch (e) {
      console.error(e);
      alert('PDF 생성에 실패했습니다.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleCloseClick = () => {
    if (isProcessing && !stopRequested) {
      setShowConfirmClose(true);
    } else {
      onClose();
    }
  };

  const confirmClose = () => {
    setStopRequested(true);
    setShowConfirmClose(false);
    onClose();
  };

  const completedCount = pages.filter(p => p.status === 'completed').length;
  const totalCount = pages.length;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div 
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] bg-black/95 flex flex-col items-center justify-center overflow-hidden"
        >
          {/* Header */}
          <div className="absolute top-0 left-0 right-0 h-16 bg-white/10 backdrop-blur-md flex justify-between items-center px-4 md:px-6 z-50">
            <div className="flex flex-col flex-1 max-w-[200px]">
               <span className="text-white font-bold text-sm sm:text-lg">문서 번역 ({completedCount}/{totalCount})</span>
               <div className="w-full bg-white/20 h-1.5 rounded-full mt-1 overflow-hidden">
                 <div className="bg-[#ffcd4a] h-full transition-all duration-300" style={{ width: `${(completedCount / totalCount) * 100}%` }} />
               </div>
            </div>
            
            <div className="flex items-center gap-2 md:gap-4 ml-4">
              {isProcessing && !stopRequested && (
                <button onClick={() => setStopRequested(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors">
                  <StopCircle size={18} />
                  <span className="text-sm font-bold hidden sm:block">중단</span>
                </button>
              )}
              {completedCount > 0 && (
                <button onClick={handleExportPDF} disabled={isExporting} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors disabled:opacity-50">
                  {isExporting ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                  <span className="text-sm font-bold hidden sm:block">PDF</span>
                </button>
              )}
              <button onClick={handleCloseClick} className="p-2 rounded-full hover:bg-white/10 text-white transition-colors">
                <X size={24} />
              </button>
            </div>
          </div>

          {/* Close Confirm Modal */}
          {showConfirmClose && (
            <div className="absolute inset-0 z-[200] bg-black/60 flex items-center justify-center p-4">
              <div className="bg-gray-900 border border-white/10 rounded-xl p-6 max-w-sm w-full shadow-2xl">
                <h3 className="text-xl font-bold text-white mb-2">번역 중단</h3>
                <p className="text-white/70 mb-6">번역이 진행 중입니다. 정말 닫으시겠습니까?</p>
                <div className="flex justify-end gap-3">
                  <button 
                    onClick={() => setShowConfirmClose(false)}
                    className="px-4 py-2 rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors"
                  >
                    취소
                  </button>
                  <button 
                    onClick={confirmClose}
                    className="px-4 py-2 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors font-bold"
                  >
                    닫기 및 중단
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Content Viewer */}
          {!showViewer ? (
            <div className="flex flex-col items-center justify-center text-white h-full w-full">
              <Loader2 className="w-12 h-12 text-[#ffcd4a] animate-spin mb-4" />
              <p className="text-xl font-bold">1페이지를 번역 중입니다...</p>
              <p className="text-white/60 mt-2">잠시만 기다려주세요 (약 15-20초 소요)</p>
            </div>
          ) : (
            <div className="w-full h-full pt-20 pb-6 px-4 md:px-10 overflow-y-auto flex flex-col gap-10 scroll-smooth items-center">
              {pages.map((page, idx) => (
                <div key={idx} className="relative w-full max-w-4xl bg-white/5 rounded-2xl min-h-[50vh] flex items-center justify-center flex-col shrink-0 shadow-2xl overflow-hidden p-4">
                  {page.status === 'pending' || page.status === 'processing' ? (
                    <div className="flex flex-col items-center justify-center py-32">
                      <Loader2 className={`w-10 h-10 ${page.status === 'processing' ? 'text-[#ffcd4a] animate-spin' : 'text-white/20'} mb-4`} />
                      <p className="text-white/60 font-medium">
                        {page.status === 'processing' ? `${idx + 1}페이지 번역 중...` : `${idx + 1}페이지 대기 중`}
                      </p>
                    </div>
                  ) : page.status === 'error' ? (
                    <div className="flex flex-col items-center justify-center py-32 text-red-400">
                      <AlertCircle className="w-10 h-10 mb-4" />
                      <p className="font-bold">{idx + 1}페이지 번역 실패</p>
                    </div>
                  ) : (
                    <div className="rounded-lg shadow-xl overflow-hidden max-w-full">
                      <div id={`page-render-${idx}`} className="relative inline-block max-w-full">
                        <img 
                          src={page.originalBase64} 
                          alt={`Page ${idx + 1}`} 
                          className="block max-w-full"
                          style={{ maxHeight: '80vh' }}
                        />
                        {page.blocks && (
                          <div className="absolute inset-0">
                           {page.blocks.map((block, bIdx) => {
                             const [ymin, xmin, ymax, xmax] = block.box;
                             const top = `${ymin / 10}%`;
                             const left = `${xmin / 10}%`;
                             const height = `${(ymax - ymin) / 10}%`;
                             const width = `${(xmax - xmin) / 10}%`;
                             return (
                               <motion.div
                                 key={bIdx}
                                 className="absolute z-20"
                                 initial={{ opacity: 0 }}
                                 animate={{ opacity: 1 }}
                                 transition={{ duration: 0.4, delay: 0.1 + (bIdx * 0.03), ease: "easeOut" }}
                                 style={{ top, left, width, height }}
                               >
                                 <FontAdjustableText text={block.translation} box={block.box} />
                               </motion.div>
                             );
                           })}
                        </div>
                      )}
                    </div>
                  </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
