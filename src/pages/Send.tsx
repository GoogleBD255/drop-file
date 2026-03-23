import React, { useEffect, useState, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { QRCodeBox } from '../components/QRCodeBox';
import { FileDrop } from '../components/FileDrop';
import { FileQueue, FileQueueItem } from '../components/FileQueue';
import { PeerConnection } from '../webrtc/peer';
import { FileSender } from '../webrtc/fileSender';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { toast } from 'react-hot-toast';

export function Send() {
  const [roomId, setRoomId] = useState<string>('');
  const [peerConnected, setPeerConnected] = useState(false);
  const [files, setFiles] = useState<FileQueueItem[]>([]);
  const [status, setStatus] = useState<'waiting' | 'connected' | 'error'>('waiting');
  
  const peerRef = useRef<PeerConnection | null>(null);
  const sendersRef = useRef<Map<number, FileSender>>(new Map());
  const nextFileId = useRef(1);

  useEffect(() => {
    const newRoomId = uuidv4().slice(0, 8);
    setRoomId(newRoomId);

    const peer = new PeerConnection(newRoomId, true);
    peerRef.current = peer;

    peer.onConnectionStateChange = (state) => {
      if (state === 'connected') {
        setPeerConnected(true);
        setStatus('connected');
        toast.success('Receiver connected!');
        
        // Setup message listener for the data channel
        if (peer.dataChannel) {
          peer.dataChannel.onmessage = (event) => {
            if (typeof event.data === 'string') {
              try {
                const data = JSON.parse(event.data);
                if (data.type === 'cancel') {
                  const sender = sendersRef.current.get(data.fileId);
                  if (sender) {
                    sender.cancel();
                    sendersRef.current.delete(data.fileId);
                  }
                  setFiles(prev => prev.map(f => f.id === data.fileId ? { ...f, status: 'cancelled' } : f));
                } else if (data.type === 'pause') {
                  const sender = sendersRef.current.get(data.fileId);
                  if (sender) {
                    sender.pause();
                    setFiles(prev => prev.map(f => f.id === data.fileId ? { ...f, status: 'paused', speed: 0 } : f));
                  }
                } else if (data.type === 'resume') {
                  const sender = sendersRef.current.get(data.fileId);
                  if (sender) {
                    sender.resume();
                    setFiles(prev => prev.map(f => f.id === data.fileId ? { ...f, status: 'transferring' } : f));
                  }
                }
              } catch (e) {
                console.error("Error parsing message", e);
              }
            }
          };
        }
      } else if (state === 'disconnected' || state === 'failed') {
        setPeerConnected(false);
        setStatus('error');
        toast.error('Connection to receiver lost.');
      }
    };

    return () => {
      peer.close();
    };
  }, []);

  const handleFilesSelect = (selectedFiles: File[]) => {
    const newItems: FileQueueItem[] = selectedFiles.map(f => ({
      id: nextFileId.current++,
      name: f.name,
      size: f.size,
      progress: 0,
      speed: 0,
      status: peerConnected ? 'transferring' : 'pending',
      file: f,
      type: f.type
    }));
    
    setFiles(prev => [...prev, ...newItems]);
    
    if (peerConnected && peerRef.current?.dataChannel) {
      newItems.forEach(item => startTransfer(item.file!, item.id, peerRef.current!.dataChannel!));
    }
  };

  const startTransfer = (fileToSend: File, fileId: number, channel: RTCDataChannel) => {
    const sender = new FileSender(channel, fileToSend, fileId);
    sendersRef.current.set(fileId, sender);

    sender.onProgress = (p, s) => {
      setFiles(prev => prev.map(f => f.id === fileId ? { ...f, progress: p, speed: s } : f));
    };

    sender.onComplete = () => {
      setFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: 'completed', progress: 100, speed: 0 } : f));
      sendersRef.current.delete(fileId);
      toast.success(`File sent: ${fileToSend.name}`);
    };

    sender.onError = (err) => {
      console.error(err);
      setFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: 'error' } : f));
      sendersRef.current.delete(fileId);
      toast.error(`Error sending file: ${fileToSend.name}`);
    };

    sender.start();
  };

  const handleCancel = (id: number) => {
    const sender = sendersRef.current.get(id);
    if (sender) {
      sender.cancel();
      sendersRef.current.delete(id);
    }
    setFiles(prev => prev.map(f => f.id === id ? { ...f, status: 'cancelled' } : f));
  };

  const handleRetry = (id: number) => {
    const fileItem = files.find(f => f.id === id);
    if (fileItem && fileItem.file && peerConnected && peerRef.current?.dataChannel) {
      setFiles(prev => prev.map(f => f.id === id ? { ...f, status: 'transferring', progress: 0, speed: 0 } : f));
      startTransfer(fileItem.file, id, peerRef.current.dataChannel);
    }
  };

  const handlePause = (id: number) => {
    const sender = sendersRef.current.get(id);
    if (sender) {
      sender.pause();
      setFiles(prev => prev.map(f => f.id === id ? { ...f, status: 'paused', speed: 0 } : f));
    }
  };

  const handleResume = (id: number) => {
    const sender = sendersRef.current.get(id);
    if (sender) {
      sender.resume();
      setFiles(prev => prev.map(f => f.id === id ? { ...f, status: 'transferring' } : f));
    }
  };

  // If files selected before peer connected, start when connected
  useEffect(() => {
    if (peerConnected && status === 'connected' && peerRef.current?.dataChannel) {
      files.forEach(f => {
        if (f.status === 'pending' && f.file) {
          setFiles(prev => prev.map(item => item.id === f.id ? { ...item, status: 'transferring' } : item));
          startTransfer(f.file, f.id, peerRef.current!.dataChannel!);
        }
      });
    }
  }, [peerConnected, status]);

  const receiveUrl = `${window.location.origin}/receive/${roomId}`;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Send Files</h1>
        <p className="text-gray-500 dark:text-gray-400">Share files securely via peer-to-peer connection</p>
      </div>

      <div className="grid md:grid-cols-2 gap-8 items-start">
        <div className="flex flex-col items-center space-y-6 md:sticky md:top-24">
          <div className="text-center">
            <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-4">1. Scan to Connect</h2>
            {roomId ? (
              <QRCodeBox url={receiveUrl} />
            ) : (
              <div className="w-[200px] h-[200px] bg-gray-100 dark:bg-gray-800 animate-pulse rounded-2xl"></div>
            )}
          </div>
          
          <div className="flex items-center space-x-2 text-sm">
            <div className={`w-3 h-3 rounded-full ${peerConnected ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`}></div>
            <span className="text-gray-600 dark:text-gray-300">
              {peerConnected ? 'Receiver Connected' : 'Waiting for receiver...'}
            </span>
          </div>
          
          {status === 'error' && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-4 text-center w-full max-w-sm">
              <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
              <h3 className="text-sm font-medium text-red-900 dark:text-red-100 mb-1">Connection Error</h3>
              <p className="text-red-700 dark:text-red-300 text-xs mb-4">The peer connection was lost or failed.</p>
              <button
                onClick={() => window.location.reload()}
                className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-red-500/20 flex items-center space-x-2 mx-auto"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Try Again</span>
              </button>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-4 text-center md:text-left">2. Select Files</h2>
          
          <FileDrop onFilesSelect={handleFilesSelect} disabled={!peerConnected} />
          
          <FileQueue 
            files={files} 
            onCancel={handleCancel} 
            onRetry={handleRetry} 
            onPause={handlePause} 
            onResume={handleResume} 
          />
        </div>
      </div>
    </div>
  );
}
