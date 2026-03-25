import { 
  FileText, 
  File as FileIcon, 
  FileArchive,
  FileCode,
  FileSpreadsheet,
  FileAudio,
  FileVideo,
  FileImage
} from 'lucide-react';

export function getFileIconInfo(name: string, type?: string) {
  const lowerName = name.toLowerCase();
  
  if (type?.startsWith('image/') || lowerName.match(/\.(jpg|jpeg|png|gif|webp|svg|bmp)$/)) {
    return { icon: FileImage, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-900/20' };
  }
  if (type?.startsWith('video/') || lowerName.match(/\.(mp4|webm|ogg|mov|avi|mkv)$/)) {
    return { icon: FileVideo, color: 'text-purple-500', bg: 'bg-purple-50 dark:bg-purple-900/20' };
  }
  if (type?.startsWith('audio/') || lowerName.match(/\.(mp3|wav|ogg|m4a|flac)$/)) {
    return { icon: FileAudio, color: 'text-pink-500', bg: 'bg-pink-50 dark:bg-pink-900/20' };
  }
  if (type === 'application/pdf' || lowerName.endsWith('.pdf')) {
    return { icon: FileText, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-900/20' };
  }
  if (lowerName.match(/\.(zip|rar|7z|tar|gz|bz2)$/)) {
    return { icon: FileArchive, color: 'text-yellow-600 dark:text-yellow-500', bg: 'bg-yellow-50 dark:bg-yellow-900/20' };
  }
  if (lowerName.match(/\.(js|ts|jsx|tsx|html|css|json|py|java|c|cpp|go|rs|php)$/)) {
    return { icon: FileCode, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/20' };
  }
  if (lowerName.match(/\.(xls|xlsx|csv)$/)) {
    return { icon: FileSpreadsheet, color: 'text-green-600 dark:text-green-500', bg: 'bg-green-50 dark:bg-green-900/20' };
  }
  if (lowerName.match(/\.(doc|docx|txt|rtf|md)$/)) {
    return { icon: FileText, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20' };
  }
  
  return { icon: FileIcon, color: 'text-gray-500', bg: 'bg-gray-100 dark:bg-gray-800' };
}
