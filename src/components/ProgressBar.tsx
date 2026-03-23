import React from 'react';

interface ProgressBarProps {
  progress: number;
  speed?: number; // bytes per second
}

export function ProgressBar({ progress, speed }: ProgressBarProps) {
  const formatSpeed = (bytesPerSec: number) => {
    if (bytesPerSec === 0) return '0 B/s';
    const k = 1024;
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.floor(Math.log(bytesPerSec) / Math.log(k));
    return parseFloat((bytesPerSec / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="w-full mt-2">
      {speed !== undefined && speed > 0 && (
        <div className="flex justify-end mb-1">
          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
            {formatSpeed(speed)}
          </span>
        </div>
      )}
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
        <div
          className="bg-blue-600 h-2 rounded-full transition-all duration-300 ease-out"
          style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
        ></div>
      </div>
    </div>
  );
}
