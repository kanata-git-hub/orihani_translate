import React from 'react';

interface AudioVisualizerProps {
  levels: number[];
  color: string;
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ levels, color }) => {
  return (
    <div className="flex items-end justify-center gap-1.5 h-16 w-full max-w-[240px] px-4 py-2">
      {levels.map((level, index) => {
        // level value is expected to be between 0 and 100 representing scale percentage
        const height = Math.max(8, Math.min(100, level));
        return (
          <div
            key={index}
            className="w-2 rounded-full transition-all duration-75 ease-out"
            style={{
              height: `${height}%`,
              backgroundColor: color,
              opacity: 0.4 + (height / 100) * 0.6
            }}
          />
        );
      })}
    </div>
  );
};
