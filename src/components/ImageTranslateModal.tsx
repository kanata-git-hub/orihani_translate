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

export function ImageTranslateModal({ isOpen, onClose, targetLang, file }: ImageTranslateModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [blocks, setBlocks] = useState<TextBlock[]>([]);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || !file) {
      setBlocks([]);
      setImageSrc(null);
      setError('');
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
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-white rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/5 bg-gray-50/50">
          <h2 className="text-xl font-bold text-[#552c24]">이미지 번역</h2>
          <button 
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-black/5 hover:bg-black/10 transition-colors text-[#552c24]"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden relative flex items-center justify-center bg-black/5 p-4">
          {loading && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm">
              <Loader2 className="w-12 h-12 animate-spin text-[#ffcd4a] mb-4" />
              <p className="text-[#552c24] font-medium animate-pulse">이미지를 분석하고 번역중입니다...</p>
            </div>
          )}
          
          {error && (
            <div className="absolute z-20 top-4 left-4 right-4 bg-red-100 text-red-700 p-4 rounded-xl text-center font-medium shadow-md">
              {error}
            </div>
          )}

          {imageSrc && (
            <div className="relative max-w-full max-h-full inline-block" ref={containerRef}>
              <img 
                src={imageSrc} 
                alt="Original to translate" 
                className="max-w-full max-h-[70vh] object-contain rounded-lg shadow-sm"
              />
              
              {!loading && blocks.map((block, idx) => {
                const [ymin, xmin, ymax, xmax] = block.box;
                const top = `${ymin / 10}%`;
                const left = `${xmin / 10}%`;
                const height = `${(ymax - ymin) / 10}%`;

                return (
                  <div
                    key={idx}
                    className="absolute z-10 flex items-center justify-center pointer-events-none"
                    style={{
                      top,
                      left,
                      height, // By defining height, width is intrinsic or we can let width be fluid
                      minWidth: `${(xmax - xmin) / 10}%`,
                    }}
                  >
                    <div className="px-2 py-1 rounded-md bg-white/85 shadow-sm border border-black/5 backdrop-blur-sm mx-auto text-center w-full h-full flex items-center justify-center">
                      <span className="text-[#552c24] font-bold text-sm sm:text-base leading-snug truncate whitespace-normal break-words max-w-full max-h-full overflow-hidden">
                        {block.translation}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
