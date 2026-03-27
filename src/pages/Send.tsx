import React, { useEffect, useState, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { FileDrop } from '../components/FileDrop';
import { FileQueue, FileQueueItem } from '../components/FileQueue';
import { PeerConnection } from '../webrtc/peer';
import { FileSender } from '../webrtc/fileSender';
import { AlertCircle, RefreshCw, Lock } from 'lucide-react';
import { toast } from 'react-hot-toast';

import { generateEncryptionKey, decryptText, encryptText, deriveKeyFromPin } from '../lib/crypto';
import { addHistoryRecord, updateHistoryRecord } from '../lib/db';

export function Send() {
  const [roomId, setRoomId] = useState<string>('');
  const [encryptionKey, setEncryptionKey] = useState<string>('');
  const [peerConnected, setPeerConnected] = useState(false);
  const [files, setFiles] = useState<FileQueueItem[]>([]);
  const [status, setStatus] = useState<'waiting' | 'connected' | 'error'>('waiting');
  const [connectionDetail, setConnectionDetail] = useState<string>('Waiting for receiver...');
  
  const peerRef = useRef<PeerConnection | null>(null);
  const sendersRef = useRef<Map<number, FileSender>>(new Map());
  const nextFileId = useRef(1);

  useEffect(() => {
    const initRoom = async () => {
      const newRoomId = Math.floor(1000 + Math.random() * 9000).toString();
      const newKey = await deriveKeyFromPin(newRoomId);
      setRoomId(newRoomId);
      setEncryptionKey(newKey);

      const peer = new PeerConnection(newRoomId, true);
      peerRef.current = peer;

      peer.onError = (msg) => {
        toast.error(msg);
      };

      peer.onConnectionStateChange = (state) => {
        console.log("Send Peer State:", state);
        if (state === 'connecting') {
          setConnectionDetail('Exchanging signals with receiver...');
        } else if (state === 'connected') {
          setPeerConnected(true);
          setStatus('connected');
          toast.success('Receiver connected!');
          
          // Setup message listener for the data channel
          if (peer.dataChannel) {
            const sendMessage = async (message: any) => {
              peer.resetActivity();
              
              if (peer.dataChannel?.readyState !== 'open') {
                await new Promise((resolve, reject) => {
                  const timeout = setTimeout(() => reject(new Error("Timeout waiting for data channel")), 10000);
                  const check = () => {
                    if (peer.dataChannel?.readyState === 'open') {
                      clearTimeout(timeout);
                      resolve(null);
                    } else if (peer.dataChannel?.readyState === 'closed' || peer.dataChannel?.readyState === 'closing') {
                      clearTimeout(timeout);
                      reject(new Error("Data channel closed"));
                    } else {
                      setTimeout(check, 500);
                    }
                  };
                  check();
                });
              }

              if (newKey) {
                const encrypted = await encryptText(JSON.stringify(message), newKey);
                peer.dataChannel!.send(JSON.stringify({ type: 'encrypted', payload: encrypted }));
              } else {
                peer.dataChannel!.send(JSON.stringify(message));
              }
            };

            peer.sendMessage = sendMessage;

            peer.dataChannel.onmessage = async (event) => {
              peer.resetActivity();
              if (typeof event.data === 'string') {
                try {
                  let data = JSON.parse(event.data);
                  
                  if (data.type === 'ping') return; // Ignore ping messages

                  if (data.type === 'encrypted' && newKey) {
                    const decrypted = await decryptText(data.payload, newKey);
                    data = JSON.parse(decrypted);
                  }

                  if (data.type === 'cancel') {
                    const sender = sendersRef.current.get(data.fileId);
                    if (sender) {
                      sender.cancel();
                      sendersRef.current.delete(data.fileId);
                    }
                    setFiles(prev => prev.map(f => {
                      if (f.id === data.fileId) {
                        if (f.dbId) updateHistoryRecord(f.dbId, { status: 'cancelled' });
                        return { ...f, status: 'cancelled' };
                      }
                      return f;
                    }));
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
                  } else if (data.type === 'disconnect') {
                    handleManualDisconnect();
                  }
                } catch (e) {
                  console.error("Error parsing message", e);
                }
              }
            };
          }
        } else if (state === 'disconnected') {
          setConnectionDetail('Connection unstable, attempting to reconnect...');
          toast.loading('Reconnecting...', { id: 'reconnect-toast' });
        } else if (state === 'failed' || state === 'closed') {
          setPeerConnected(false);
          setStatus('error');
          setConnectionDetail('Connection failed');
          toast.error('Connection failed.', { id: 'reconnect-toast' });
        }
      };

      peer.onDisconnect = () => {
        setPeerConnected(false);
        setStatus('error');
        toast.error('Disconnected due to inactivity.');
      };
    };

    initRoom();

    return () => {
      if (peerRef.current) {
        peerRef.current.close();
      }
    };
  }, []);

  const handleFilesSelect = (selectedFiles: File[]) => {
    peerRef.current?.resetActivity();
    const newItems: FileQueueItem[] = selectedFiles.map(f => ({
      id: nextFileId.current++,
      dbId: uuidv4(),
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
      newItems.forEach(item => startTransfer(item.file!, item.id, item.dbId!, peerRef.current!.dataChannel!));
    }
  };

  const startTransfer = async (fileToSend: File, fileId: number, dbId: string, channel: RTCDataChannel) => {
    await addHistoryRecord({
      id: dbId,
      fileName: fileToSend.name,
      fileSize: fileToSend.size,
      fileType: fileToSend.type,
      direction: 'sent',
      status: 'failed', // Default to failed, update to completed when done
      timestamp: Date.now(),
    });

    const sender = new FileSender(channel, fileToSend, fileId, encryptionKey);
    sendersRef.current.set(fileId, sender);

    sender.onProgress = (p, s) => {
      peerRef.current?.resetActivity();
      setFiles(prev => prev.map(f => f.id === fileId ? { ...f, progress: p, speed: s } : f));
    };

    sender.onComplete = () => {
      setFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: 'completed', progress: 100, speed: 0 } : f));
      sendersRef.current.delete(fileId);
      updateHistoryRecord(dbId, { status: 'completed' });
      toast.success(`File sent: ${fileToSend.name}`);
    };

    sender.onError = (err) => {
      console.error(err);
      setFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: 'error' } : f));
      sendersRef.current.delete(fileId);
      updateHistoryRecord(dbId, { status: 'failed' });
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
    setFiles(prev => prev.map(f => {
      if (f.id === id) {
        if (f.dbId) updateHistoryRecord(f.dbId, { status: 'cancelled' });
        return { ...f, status: 'cancelled' };
      }
      return f;
    }));
  };

  const handleRetry = (id: number) => {
    const fileItem = files.find(f => f.id === id);
    if (fileItem && fileItem.file && peerConnected && peerRef.current?.dataChannel) {
      setFiles(prev => prev.map(f => f.id === id ? { ...f, status: 'transferring', progress: 0, speed: 0 } : f));
      startTransfer(fileItem.file, id, fileItem.dbId!, peerRef.current.dataChannel);
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

  const handleManualDisconnect = () => {
    if (peerRef.current) {
      // Try to notify the other peer before closing
      peerRef.current.sendMessage?.({ type: 'disconnect' }).catch(() => {});
      setTimeout(() => {
        peerRef.current?.close();
        setPeerConnected(false);
        setStatus('waiting');
        toast.success('Disconnected successfully');
        // Reload page to reset state completely
        window.location.reload();
      }, 100);
    }
  };

  // If files selected before peer connected, start when connected
  useEffect(() => {
    if (peerConnected && status === 'connected' && peerRef.current?.dataChannel) {
      files.forEach(f => {
        if (f.status === 'pending' && f.file) {
          setFiles(prev => prev.map(item => item.id === f.id ? { ...item, status: 'transferring' } : item));
          startTransfer(f.file, f.id, f.dbId!, peerRef.current!.dataChannel!);
        }
      });
    }
  }, [peerConnected, status]);

  // Reset activity on user interaction
  useEffect(() => {
    const handleUserActivity = () => {
      if (peerConnected) {
        peerRef.current?.resetActivity();
      }
    };

    window.addEventListener('mousemove', handleUserActivity);
    window.addEventListener('keydown', handleUserActivity);
    window.addEventListener('click', handleUserActivity);
    window.addEventListener('touchstart', handleUserActivity);

    return () => {
      window.removeEventListener('mousemove', handleUserActivity);
      window.removeEventListener('keydown', handleUserActivity);
      window.removeEventListener('click', handleUserActivity);
      window.removeEventListener('touchstart', handleUserActivity);
    };
  }, [peerConnected]);

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Send Files</h1>
        <p className="text-gray-500 dark:text-gray-400 mb-4">Share files securely via peer-to-peer connection</p>
        <div className="inline-flex items-center space-x-1.5 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 px-3 py-1 rounded-full text-xs font-medium border border-green-200 dark:border-green-800/30">
          <Lock className="w-3.5 h-3.5" />
          <span>End-to-End Encrypted</span>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-8 items-start">
        <div className="flex flex-col items-center space-y-6 md:sticky md:top-24">
          <div className="text-center w-full">
            <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-4">1. Share Connection Code</h2>
            {roomId ? (
              <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 shadow-sm border border-gray-100 dark:border-gray-700 w-full max-w-sm mx-auto">
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Enter this 4-digit code on the receiving device:</p>
                <div className="text-6xl font-mono font-bold text-blue-600 dark:text-blue-400 tracking-[0.2em] py-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl">
                  {roomId}
                </div>
              </div>
            ) : (
              <div className="w-full max-w-sm h-[200px] bg-gray-100 dark:bg-gray-800 animate-pulse rounded-2xl mx-auto"></div>
            )}
          </div>
          
            <div className="flex flex-col items-center space-y-4">
              <div className="flex items-center space-x-2 text-sm">
                <div className={`w-3 h-3 rounded-full ${peerConnected ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`}></div>
                <span className="text-gray-600 dark:text-gray-300">
                  {peerConnected ? 'Receiver Connected' : connectionDetail}
                </span>
              </div>
              
              {peerConnected && (
                <button
                  onClick={handleManualDisconnect}
                  className="px-4 py-2 bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50 text-red-700 dark:text-red-400 rounded-xl text-sm font-semibold transition-colors"
                >
                  Disconnect
                </button>
              )}
            </div>
          
          {status === 'error' && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-6 text-center w-full max-w-sm">
              <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
              <h3 className="text-sm font-medium text-red-900 dark:text-red-100 mb-1">Connection Failed</h3>
              <p className="text-red-700 dark:text-red-300 text-xs mb-4">
                We couldn't establish a secure connection. This often happens on mobile hotspots or restricted networks.
              </p>
              <div className="text-left text-[10px] space-y-2 text-gray-600 dark:text-gray-400 border-t border-red-100 dark:border-red-800/50 pt-4 mb-4">
                <p className="font-semibold text-gray-700 dark:text-gray-300">Tips for Hotspot users:</p>
                <ul className="list-disc pl-4 space-y-1">
                  <li>Turn off VPN on both devices</li>
                  <li>Try using a different browser (Chrome/Edge)</li>
                  <li>Refresh both pages and try a new code</li>
                  <li>Ensure "Mobile Data" is active on the phone</li>
                </ul>
              </div>
              <button
                onClick={() => {
                  window.location.hash = '';
                  window.location.reload();
                }}
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
