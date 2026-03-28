import React, { useEffect, useState, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { FileDrop } from '../components/FileDrop';
import { FileQueue, FileQueueItem } from '../components/FileQueue';
import { PeerConnection } from '../webrtc/peer';
import { FileSender } from '../webrtc/fileSender';
import { AlertCircle, RefreshCw, Lock, QrCode, Scan } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { QRCodeSVG } from 'qrcode.react';
import { Html5QrcodeScanner } from 'html5-qrcode';

import { generateEncryptionKey, decryptText, encryptText, deriveKeyFromPin } from '../lib/crypto';
import { addHistoryRecord, updateHistoryRecord } from '../lib/db';

export function Send() {
  const [roomId, setRoomId] = useState<string>('');
  const [encryptionKey, setEncryptionKey] = useState<string>('');
  const [peerConnected, setPeerConnected] = useState(false);
  const [files, setFiles] = useState<FileQueueItem[]>([]);
  const [status, setStatus] = useState<'waiting' | 'connected' | 'error'>('waiting');
  const [connectionDetail, setConnectionDetail] = useState<string>('Waiting for receiver...');
  const [isManualMode, setIsManualMode] = useState(false);
  const [localSdp, setLocalSdp] = useState('');
  const [remoteSdp, setRemoteSdp] = useState('');
  const [manualKey, setManualKey] = useState('');
  const [isGatheringIce, setIsGatheringIce] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [showQr, setShowQr] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const peerRef = useRef<PeerConnection | null>(null);
  const sendersRef = useRef<Map<number, FileSender>>(new Map());
  const nextFileId = useRef(1);

  const setupDataChannel = (peer: PeerConnection, channel: RTCDataChannel, key?: string) => {
    const sendMessage = async (message: any) => {
      peer.resetActivity();
      
      if (channel.readyState !== 'open') {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Timeout waiting for data channel")), 10000);
          const check = () => {
            if (channel.readyState === 'open') {
              clearTimeout(timeout);
              resolve(null);
            } else if (channel.readyState === 'closed' || channel.readyState === 'closing') {
              clearTimeout(timeout);
              reject(new Error("Data channel closed"));
            } else {
              setTimeout(check, 500);
            }
          };
          check();
        });
      }

      if (key) {
        const encrypted = await encryptText(JSON.stringify(message), key);
        channel.send(JSON.stringify({ type: 'encrypted', payload: encrypted }));
      } else {
        channel.send(JSON.stringify(message));
      }
    };

    peer.sendMessage = sendMessage;

    channel.onmessage = async (event) => {
      peer.resetActivity();
      if (typeof event.data === 'string') {
        try {
          let data = JSON.parse(event.data);
          
          if (data.type === 'ping') return; // Ignore ping messages

          if (data.type === 'encrypted' && key) {
            const decrypted = await decryptText(data.payload, key);
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
            sendersRef.current.get(data.fileId)?.pause();
            setFiles(prev => prev.map(f => f.id === data.fileId ? { ...f, status: 'paused', speed: 0 } : f));
          } else if (data.type === 'resume') {
            sendersRef.current.get(data.fileId)?.resume();
            setFiles(prev => prev.map(f => f.id === data.fileId ? { ...f, status: 'transferring' } : f));
          } else if (data.type === 'disconnect') {
            handleManualDisconnect();
          }
        } catch (e) {
          console.error("Error parsing message", e);
        }
      }
    };
  };

  useEffect(() => {
    const handleOnlineStatus = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', handleOnlineStatus);
    window.addEventListener('offline', handleOnlineStatus);
    return () => {
      window.removeEventListener('online', handleOnlineStatus);
      window.removeEventListener('offline', handleOnlineStatus);
    };
  }, []);

  useEffect(() => {
    const initRoom = async () => {
      const newRoomId = Math.floor(1000 + Math.random() * 8999).toString();
      const newKey = await deriveKeyFromPin(newRoomId);
      setRoomId(newRoomId);
      setEncryptionKey(newKey);

      const peer = new PeerConnection(newRoomId, true);
      peerRef.current = peer;

      peer.onError = (msg) => {
        toast.error(msg);
      };

      peer.onManualSignal = (signal) => {
        setLocalSdp(signal);
        setIsGatheringIce(false);
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
            setupDataChannel(peer, peer.dataChannel, newKey);
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

  const handleManualConnect = async () => {
    if (!remoteSdp) {
      toast.error("Please paste the answer from the receiver");
      return;
    }
    
    // Update setupDataChannel with manual key if provided
    if (peerRef.current?.dataChannel) {
      setupDataChannel(peerRef.current, peerRef.current.dataChannel, manualKey || undefined);
    }

    try {
      await peerRef.current?.setManualSignal(remoteSdp);
    } catch (e) {
      toast.error("Invalid answer string");
    }
  };

  const startManualGathering = () => {
    setIsGatheringIce(true);
    peerRef.current?.createManualOffer();
  };

  const startScanner = () => {
    setShowScanner(true);
    setTimeout(() => {
      const scanner = new Html5QrcodeScanner(
        "qr-reader",
        { fps: 10, qrbox: { width: 250, height: 250 } },
        /* verbose= */ false
      );
      scanner.render((decodedText) => {
        setRemoteSdp(decodedText);
        scanner.clear();
        setShowScanner(false);
        toast.success("Answer string scanned!");
      }, (error) => {
        // console.warn(error);
      });
    }, 100);
  };

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

    const activeKey = isManualMode ? (manualKey || undefined) : encryptionKey;
    const sender = new FileSender(channel, fileToSend, fileId, activeKey);
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
    if (peerRef.current && !isDisconnecting) {
      setIsDisconnecting(true);
      console.log("Initiating manual disconnect...");
      // Try to notify the other peer before closing
      peerRef.current.sendMessage?.({ type: 'disconnect' }).catch(() => {});
      setTimeout(() => {
        peerRef.current?.close();
        setPeerConnected(false);
        setStatus('waiting');
        toast.success('Disconnected successfully');
        // Reload page to reset state completely
        window.location.reload();
      }, 200); // Slightly longer delay to ensure message is sent
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
            
            <div className="flex justify-center mb-6">
              <div className="inline-flex p-1 bg-gray-100 dark:bg-gray-800 rounded-xl">
                <button
                  onClick={() => setIsManualMode(false)}
                  className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all ${!isManualMode ? 'bg-white dark:bg-gray-700 shadow-sm text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}
                >
                  Online (Code)
                </button>
                <button
                  onClick={() => setIsManualMode(true)}
                  className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all ${isManualMode ? 'bg-white dark:bg-gray-700 shadow-sm text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}
                >
                  Offline (Manual)
                </button>
              </div>
            </div>

            {!isManualMode ? (
              roomId ? (
                <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 sm:p-8 shadow-sm border border-gray-100 dark:border-gray-700 w-full max-w-sm mx-auto">
                  {!isOnline && (
                    <div className="mb-4 p-2 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-[10px] rounded-lg border border-amber-200 dark:border-amber-800/30 flex items-center space-x-2">
                      <AlertCircle className="w-3 h-3" />
                      <span>You are offline. Switch to "Offline (Manual)" mode.</span>
                    </div>
                  )}
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Enter this 4-digit code on the receiving device:</p>
                  <div className="text-4xl sm:text-6xl font-mono font-bold text-blue-600 dark:text-blue-400 tracking-[0.1em] sm:tracking-[0.2em] py-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl overflow-hidden break-all">
                    {roomId}
                  </div>
                </div>
              ) : (
                <div className="w-full max-w-sm h-[200px] bg-gray-100 dark:bg-gray-800 animate-pulse rounded-2xl mx-auto"></div>
              )
            ) : (
              <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-700 w-full max-w-sm mx-auto space-y-4">
                <div className="text-left">
                  <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Optional: Encryption Key</label>
                  <input
                    type="text"
                    value={manualKey}
                    onChange={(e) => setManualKey(e.target.value)}
                    placeholder="Enter a secret key (optional)"
                    className="w-full p-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <p className="text-[10px] text-gray-500 mt-1 italic">Use the same key on both devices for encryption.</p>
                </div>

                <div className="text-left">
                  <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Step 1: Your Connection String</label>
                  {!localSdp ? (
                    <button
                      onClick={startManualGathering}
                      disabled={isGatheringIce}
                      className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-blue-500/20"
                    >
                      {isGatheringIce ? 'Gathering...' : 'Generate String'}
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <textarea
                        readOnly
                        value={localSdp}
                        className="w-full h-24 p-2 text-[10px] font-mono bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none break-all"
                      />
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(localSdp);
                          toast.success('Copied to clipboard');
                        }}
                        className="w-full py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg text-xs font-bold transition-all"
                      >
                        Copy String
                      </button>
                      <button
                        onClick={() => setShowQr(!showQr)}
                        className="w-full py-2 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 text-blue-600 dark:text-blue-400 rounded-lg text-xs font-bold transition-all flex items-center justify-center space-x-2"
                      >
                        <QrCode className="w-4 h-4" />
                        <span>{showQr ? 'Hide QR Code' : 'Show QR Code'}</span>
                      </button>
                      {showQr && (
                        <div className="flex flex-col items-center p-4 bg-white rounded-xl shadow-inner border border-gray-100">
                          <QRCodeSVG value={localSdp} size={200} level="L" includeMargin={true} />
                          <p className="text-[10px] text-gray-500 mt-2 text-center">Receiver should scan this QR code</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="text-left">
                  <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Step 2: Paste Receiver's Answer</label>
                  <div className="relative">
                    <textarea
                      value={remoteSdp}
                      onChange={(e) => setRemoteSdp(e.target.value)}
                      placeholder="Paste the answer string from the receiver here..."
                      className="w-full h-24 p-2 text-[10px] font-mono bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none break-all"
                    />
                    <button
                      onClick={startScanner}
                      className="absolute bottom-2 right-2 p-2 bg-blue-600 text-white rounded-lg shadow-lg hover:bg-blue-700 transition-all"
                      title="Scan QR Code"
                    >
                      <Scan className="w-4 h-4" />
                    </button>
                  </div>
                  {showScanner && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
                      <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl w-full max-w-md">
                        <div className="flex justify-between items-center mb-4">
                          <h3 className="text-lg font-bold text-gray-900 dark:text-white">Scan Answer QR</h3>
                          <button onClick={() => setShowScanner(false)} className="text-gray-500 hover:text-gray-700">✕</button>
                        </div>
                        <div id="qr-reader" className="overflow-hidden rounded-xl"></div>
                      </div>
                    </div>
                  )}
                  <button
                    onClick={handleManualConnect}
                    disabled={!remoteSdp || peerConnected}
                    className="w-full mt-2 py-3 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-green-500/20"
                  >
                    Connect Manually
                  </button>
                </div>
              </div>
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
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-4 text-center w-full max-w-sm">
              <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
              <h3 className="text-sm font-medium text-red-900 dark:text-red-100 mb-1">Connection Error</h3>
              <p className="text-red-700 dark:text-red-300 text-xs mb-4">The peer connection was lost or failed.</p>
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
