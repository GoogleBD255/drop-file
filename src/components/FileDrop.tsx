import React, { useCallback, useState } from 'react';
import { UploadCloud } from 'lucide-react';

interface FileDropProps {
  onFilesSelect: (files: File[]) => void;
  disabled?: boolean;
}

export function FileDrop({ onFilesSelect, disabled }: FileDropProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setIsDragging(true);
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFilesSelect(Array.from(e.dataTransfer.files));
    }
  }, [onFilesSelect, disabled]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFilesSelect(Array.from(e.target.files));
    }
    e.target.value = ''; // Reset input to allow selecting the same file again
  }, [onFilesSelect]);

  return (
    <div
      className={`border-2 border-dashed rounded-2xl p-6 sm:p-12 text-center transition-colors
        ${disabled ? 'opacity-50 cursor-not-allowed bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-800' : 'cursor-pointer'}
        ${isDragging && !disabled ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : ''}
        ${!disabled && !isDragging ? 'border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800/50' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => !disabled && document.getElementById('file-upload')?.click()}
    >
      <input
        type="file"
        id="file-upload"
        className="hidden"
        multiple
        onChange={handleFileInput}
        disabled={disabled}
      />
      <UploadCloud className="mx-auto h-12 w-12 text-gray-400 mb-4" />
      <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
        {disabled ? 'Waiting for connection...' : 'Drag & drop files here'}
      </h3>
      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
        {disabled ? 'Connect a device first to select files' : 'or click to browse from your computer'}
      </p>
    </div>
  );
}
