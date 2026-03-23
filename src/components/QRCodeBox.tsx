import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Copy } from 'lucide-react';
import { toast } from 'react-hot-toast';

interface QRCodeBoxProps {
  url: string;
}

export function QRCodeBox({ url }: QRCodeBoxProps) {
  const handleCopy = () => {
    navigator.clipboard.writeText(url).then(() => {
      toast.success('Link copied to clipboard!');
    }).catch(() => {
      toast.error('Failed to copy link.');
    });
  };

  return (
    <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 inline-block">
      <QRCodeSVG value={url} size={200} level="H" includeMargin={true} />
      <div 
        onClick={handleCopy}
        className="mt-3 flex items-center justify-center space-x-2 cursor-pointer hover:bg-gray-50 p-2 rounded-lg transition-colors group"
      >
        <p className="text-center text-sm text-gray-500 font-mono truncate max-w-[160px]">
          {url}
        </p>
        <Copy className="w-4 h-4 text-gray-400 group-hover:text-blue-500 transition-colors" />
      </div>
    </div>
  );
}
