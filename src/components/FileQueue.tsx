import React, { useState, useMemo } from 'react';
import { ProgressBar } from './ProgressBar';
import { 
  CheckCircle, 
  AlertCircle, 
  Clock, 
  XCircle, 
  RefreshCw, 
  PauseCircle, 
  PlayCircle
} from 'lucide-react';
import { getFileIconInfo } from '../lib/icons';

export interface FileQueueItem {
  id: number;
  dbId?: string;
  name: string;
  size: number;
  progress: number;
  speed: number;
  status: 'pending' | 'transferring' | 'completed' | 'error' | 'cancelled' | 'paused';
  url?: string;
  file?: File;
  type?: string;
}

interface FileQueueProps {
  files: FileQueueItem[];
  onCancel?: (id: number) => void;
  onRetry?: (id: number) => void;
  onPause?: (id: number) => void;
  onResume?: (id: number) => void;
}

function formatTime(seconds: number) {
  if (!isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return `${Math.ceil(seconds)}s left`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.ceil(seconds % 60);
  return `${mins}m ${secs}s left`;
}

function formatSpeed(bytesPerSec: number) {
  if (bytesPerSec === 0) return '0 B/s';
  const k = 1024;
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const i = Math.floor(Math.log(bytesPerSec) / Math.log(k));
  return parseFloat((bytesPerSec / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function Thumbnail({ file, url, type, name }: { file?: File, url?: string, type?: string, name: string }) {
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const isImage = type?.startsWith('image/') || name.match(/\.(jpg|jpeg|png|gif|webp)$/i);
  const isVideo = type?.startsWith('video/') || name.match(/\.(mp4|webm|ogg|mov)$/i);

  React.useEffect(() => {
    if (!isImage && !isVideo) return;

    if (url) {
      setPreviewUrl(url);
      return;
    }

    if (file) {
      const objectUrl = URL.createObjectURL(file);
      setPreviewUrl(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    }
  }, [file, url, type, name, isImage, isVideo]);

  if (!previewUrl) {
    const { icon: Icon, color, bg } = getFileIconInfo(name, type);
    
    return (
      <div className={`w-10 h-10 rounded-md flex items-center justify-center flex-shrink-0 border border-gray-200 dark:border-gray-700 ${bg}`}>
        <Icon className={`w-5 h-5 ${color}`} />
      </div>
    );
  }

  return (
    <div className="relative w-10 h-10 flex-shrink-0 group cursor-pointer" onClick={() => window.open(previewUrl, '_blank')}>
      {isImage ? (
        <img 
          src={previewUrl} 
          alt={name} 
          className="w-full h-full object-cover rounded-md border border-gray-200 dark:border-gray-700 group-hover:opacity-90 transition-opacity" 
        />
      ) : isVideo ? (
        <div className="relative w-full h-full rounded-md overflow-hidden border border-gray-200 dark:border-gray-700 bg-black group-hover:opacity-90 transition-opacity">
          <video 
            src={previewUrl} 
            className="w-full h-full object-cover"
            muted
            playsInline
            preload="metadata"
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
            <div className="w-4 h-4 bg-white/80 rounded-full flex items-center justify-center">
              <div className="w-0 h-0 border-t-[3px] border-t-transparent border-l-[5px] border-l-blue-600 border-b-[3px] border-b-transparent ml-0.5" />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type FilterType = 'All' | 'Images' | 'Videos' | 'Documents' | 'Other';

export function FileQueue({ files, onCancel, onRetry, onPause, onResume }: FileQueueProps) {
  const [filter, setFilter] = useState<FilterType>('All');

  const filteredFiles = useMemo(() => {
    return files.filter(file => {
      const isImage = file.type?.startsWith('image/') || file.name.match(/\.(jpg|jpeg|png|gif|webp)$/i);
      const isVideo = file.type?.startsWith('video/') || file.name.match(/\.(mp4|webm|ogg|mov)$/i);
      const isDocument = file.type?.startsWith('application/pdf') || file.type?.startsWith('text/') || file.name.match(/\.(pdf|doc|docx|txt|rtf|xls|xlsx|csv)$/i);

      switch (filter) {
        case 'Images': return isImage;
        case 'Videos': return isVideo;
        case 'Documents': return isDocument;
        case 'Other': return !isImage && !isVideo && !isDocument;
        case 'All':
        default:
          return true;
      }
    });
  }, [files, filter]);

  if (files.length === 0) return null;

  return (
    <div className="space-y-3 w-full mt-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-3">
        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          Transfer Queue ({files.length})
        </h3>
        
        <div className="flex flex-wrap gap-2">
          {(['All', 'Images', 'Videos', 'Documents', 'Other'] as FilterType[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                filter === f 
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' 
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {filteredFiles.length === 0 ? (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400 text-sm bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-dashed border-gray-200 dark:border-gray-700">
          No files match the selected filter.
        </div>
      ) : (
        filteredFiles.map(file => {
          const remainingBytes = file.size - (file.size * (file.progress / 100));
          const remainingSeconds = file.speed > 0 ? remainingBytes / file.speed : 0;

          return (
            <div key={file.id} className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col transition-all">
              <div className="flex justify-between items-center">
                <div className="flex items-center space-x-3 overflow-hidden flex-1">
                  {file.status === 'completed' && <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />}
                  {file.status === 'error' && <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />}
                  {file.status === 'cancelled' && <XCircle className="w-5 h-5 text-gray-400 flex-shrink-0" />}
                  {file.status === 'pending' && <Clock className="w-5 h-5 text-gray-400 flex-shrink-0" />}
                  {file.status === 'paused' && <PauseCircle className="w-5 h-5 text-yellow-500 flex-shrink-0" />}
                  {file.status === 'transferring' && <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />}
                  
                  <Thumbnail file={file.file} url={file.url} type={file.type} name={file.name} />

                  <div className="flex flex-col overflow-hidden min-w-0">
                    <span className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate" title={file.name}>
                      {file.name}
                    </span>
                    <span className="text-[10px] sm:text-xs text-gray-500 flex flex-wrap items-center gap-x-2">
                      <span className="whitespace-nowrap">{(file.size / (1024 * 1024)).toFixed(2)} MB</span>
                      {file.status === 'transferring' && (
                        <>
                          <span className="hidden sm:inline">•</span>
                          <span className="whitespace-nowrap">{formatSpeed(file.speed)}</span>
                          <span className="hidden sm:inline">•</span>
                          <span className="whitespace-nowrap">{formatTime(remainingSeconds)}</span>
                        </>
                      )}
                    </span>
                  </div>
                </div>
                
                <div className="flex items-center space-x-3 ml-4">
                  {onPause && file.status === 'transferring' && (
                    <button 
                      onClick={() => onPause(file.id)} 
                      className="p-1 text-gray-400 hover:text-yellow-500 transition-colors rounded-full hover:bg-yellow-50 dark:hover:bg-yellow-900/20"
                      title="Pause transfer"
                    >
                      <PauseCircle className="w-5 h-5" />
                    </button>
                  )}
                  {onResume && file.status === 'paused' && (
                    <button 
                      onClick={() => onResume(file.id)} 
                      className="p-1 text-gray-400 hover:text-green-500 transition-colors rounded-full hover:bg-green-50 dark:hover:bg-green-900/20"
                      title="Resume transfer"
                    >
                      <PlayCircle className="w-5 h-5" />
                    </button>
                  )}
                  {onRetry && file.status === 'error' && (
                    <button 
                      onClick={() => onRetry(file.id)} 
                      className="p-1 text-gray-400 hover:text-blue-500 transition-colors rounded-full hover:bg-blue-50 dark:hover:bg-blue-900/20"
                      title="Retry transfer"
                    >
                      <RefreshCw className="w-5 h-5" />
                    </button>
                  )}
                  {onCancel && (file.status === 'pending' || file.status === 'transferring' || file.status === 'paused') && (
                    <button 
                      onClick={() => onCancel(file.id)} 
                      className="p-1 text-gray-400 hover:text-red-500 transition-colors rounded-full hover:bg-red-50 dark:hover:bg-red-900/20"
                      title="Cancel transfer"
                    >
                      <XCircle className="w-5 h-5" />
                    </button>
                  )}
                  {file.url && (
                    <a 
                      href={file.url} 
                      download={file.name} 
                      className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 bg-blue-50 dark:bg-blue-900/30 px-3 py-1 rounded-full transition-colors"
                    >
                      Save
                    </a>
                  )}
                </div>
              </div>
              
              {(file.status === 'transferring' || file.status === 'completed' || file.status === 'paused') && (
                <ProgressBar progress={file.progress} speed={file.status === 'transferring' ? file.speed : 0} />
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
