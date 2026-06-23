import React, { useState, useRef, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';

interface TextBlock {
  original: string;
  translation: string;
  box: [number, number, number, number]; // ymin, xmin, ymax, xmax (0-1000)
}

interface ImageTranslateModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetLang: string;
  file: File | null;
}

const FontAdjustableText = ({ text, onClick }: { text: string, onClick?: () => void }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const content = textRef.current;
    if (!container || !content) return;

    let min = 10;
    let max = 16;
    let current = max;

    const adjust = () => {
      content.style.fontSize = `${current}px`;
      if (content.scrollHeight > container.clientHeight && current > min) {
        current--;
        adjust(); // Try again until min sizes
      }
    };
    content.style.fontSize = `${max}px`;
    requestAnimationFrame(adjust);
  }, [text]);

  return (
    <div 
      className="w-full h-full bg-white/85 shadow-sm border border-black/5 backdrop-blur-sm rounded-md overflow-hidden flex cursor-pointer hover:bg-white/95"
      onClick={onClick}
    >
      <div ref={containerRef} className="w-full h-full overflow-y-auto no-scrollbar text-left p-1.5">
        <div ref={textRef} className="text-[#552c24] font-bold leading-tight break-words">
          {text}
        </div>
      </div>
    </div>
  );
};

export function ImageTranslateModal({ isOpen, onClose, targetLang, file }: ImageTranslateModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [blocks, setBlocks] = useState<TextBlock[]>([]);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<TextBlock | null>(null);
  
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || !file) {
      setBlocks([]);
      setImageSrc(null);
      setError('');
      setSelectedBlock(null);
      return;
    }

    const processImage = async () => {
      setLoading(true);
      setError('');
      try {
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64Data = reader.result as string;
          setImageSrc(base64Data);

          const base64 = base64Data.split(',')[1];
          const mimeType = file.type;

          const response = await fetch('/api/translate-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              imageParams: { mimeType, data: base64 },
              targetLang
            })
          });

          if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Failed to translate image');
          }

          const data = await response.json();
          setBlocks(data.blocks || []);
        };
        reader.readAsDataURL(file);
      } catch (err: any) {
        setError(err.message || 'Error processing image');
      } finally {
        setLoading(false);
      }
    };

    processImage();
  }, [isOpen, file, targetLang]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-4xl h-full max-h-[90vh] bg-gray-50 rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/5 bg-white z-20">
          <h2 className="text-xl font-bold text-[#552c24]">이미지 번역</h2>
          <button 
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-black/5 hover:bg-black/10 transition-colors text-[#552c24]"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden relative flex items-center justify-center bg-black/5 p-4 z-10 w-full h-full">
          {loading && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm">
              <Loader2 className="w-12 h-12 animate-spin text-[#ffcd4a] mb-4" />
              <p className="text-[#552c24] font-medium animate-pulse">이미지를 분석하고 번역중입니다...</p>
            </div>
          )}
          
          {error && (
            <div className="absolute z-30 top-4 left-4 right-4 bg-red-100 text-red-700 p-4 rounded-xl text-center font-medium shadow-md">
              {error}
            </div>
          )}

          {imageSrc && (
            <div className="relative inline-block w-full h-full flex justify-center items-center" ref={containerRef}>
              <div className="relative max-w-full max-h-full min-h-0 min-w-0" style={{ height: '100%' }}>
                <img 
                  src={imageSrc} 
                  alt="Original to translate" 
                  className="max-w-full max-h-full object-contain mx-auto rounded-lg shadow-sm"
                />
                
                {!loading && blocks.map((block, idx) => {
                  const [ymin, xmin, ymax, xmax] = block.box;
                  const top = `${ymin / 10}%`;
                  const left = `${xmin / 10}%`;
                  const height = `${(ymax - ymin) / 10}%`;
                  const width = `${(xmax - xmin) / 10}%`;

                  return (
                    <div
                      key={idx}
                      className="absolute z-20 p-0.5"
                      style={{
                        top,
                        left,
                        height,
                        width,
                      }}
                    >
                      <FontAdjustableText text={block.translation} onClick={() => setSelectedBlock(block)} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        
        {/* Bottom Details Panel */}
        {selectedBlock && (
          <div className="absolute bottom-0 left-0 right-0 bg-white shadow-[0_-10px_40px_rgba(0,0,0,0.15)] rounded-t-3xl p-6 z-40 transform transition-transform border-t border-black/5">
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
              <div>
                <p className="text-xs font-semibold text-black/40 mb-1">원문</p>
                <p className="text-sm text-gray-700 break-words">{selectedBlock.original}</p>
              </div>
              <div className="bg-[#ffcd4a]/10 p-3 rounded-lg border border-[#ffcd4a]/20">
                <p className="text-xs font-semibold text-[#552c24]/50 mb-1">번역</p>
                <p className="text-base font-bold text-[#552c24] break-words">{selectedBlock.translation}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
