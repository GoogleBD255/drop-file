import React, { useEffect, useState, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { FileDrop } from '../components/FileDrop';
import { FileQueue, FileQueueItem } from '../components/FileQueue';
import { PeerConnection } from '../webrtc/peer';
import { FileSender } from '../webrtc/fileSender';
import { AlertCircle, RefreshCw, Lock, QrCode, Scan, ShieldCheck, Wifi, WifiOff, Download, Send as SendIcon } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { QRCodeSVG } from 'qrcode.react';
import { Html5QrcodeScanner } from 'html5-qrcode';

import { generateEncryptionKey, decryptText, encryptText, deriveKeyFromPin } from '../lib/crypto';
import { addHistoryRecord, updateHistoryRecord } from '../lib/db';

import { motion, AnimatePresence } from 'motion/react';

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

  const handleManualConnect = async (sdpOverride?: string) => {
    const sdpToUse = sdpOverride || remoteSdp;
    if (!sdpToUse) {
      toast.error("Please paste the answer from the receiver");
      return;
    }
    
    // Update setupDataChannel with manual key if provided
    if (peerRef.current?.dataChannel) {
      setupDataChannel(peerRef.current, peerRef.current.dataChannel, manualKey || undefined);
    }

    try {
      await peerRef.current?.setManualSignal(sdpToUse);
      setConnectionDetail('Connecting to receiver...');
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
        // Auto-trigger connection
        handleManualConnect(decodedText);
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
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-6xl mx-auto p-4 sm:p-6"
    >
      <div className="text-center mb-10 sm:mb-14">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="inline-block p-4 bg-blue-100 dark:bg-blue-900/30 rounded-3xl mb-6 shadow-xl shadow-blue-500/10"
        >
          <SendIcon className="w-10 h-10 text-blue-600 dark:text-blue-400" />
        </motion.div>
        <h1 className="text-4xl sm:text-6xl font-black text-gray-900 dark:text-white mb-6 tracking-tighter">Send Files</h1>
        <p className="text-gray-600 dark:text-gray-400 max-w-lg mx-auto leading-relaxed font-medium text-lg">Securely share files directly with another device. Your data never touches any server.</p>
        
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <div className="inline-flex items-center space-x-1.5 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 px-3 py-1.5 rounded-full text-xs font-semibold border border-green-200 dark:border-green-800/30">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>End-to-End Encrypted</span>
          </div>
          <div className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border ${isOnline ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800/30' : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800/30'}`}>
            {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
            <span>{isOnline ? 'Online Mode Available' : 'Offline Mode Only'}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-5 space-y-8 lg:sticky lg:top-24">
          <motion.div 
            layout
            className="glass rounded-3xl shadow-xl border border-white/20 dark:border-gray-700/30 overflow-hidden"
          >
            <div className="p-6 sm:p-8">
              <h2 className="text-2xl font-black text-gray-900 dark:text-white mb-8 flex items-center space-x-4">
                <span className="w-10 h-10 bg-blue-600 text-white rounded-2xl flex items-center justify-center text-sm font-black shadow-xl shadow-blue-500/30">1</span>
                <span>Connection Setup</span>
              </h2>
              
              <div className="inline-flex p-1.5 bg-gray-100/50 dark:bg-gray-900/50 rounded-[1.5rem] border border-gray-200/50 dark:border-gray-700/50 w-full mb-10">
                <button
                  onClick={() => setIsManualMode(false)}
                  className={`flex-1 py-3.5 rounded-2xl text-sm font-black transition-all duration-300 ${!isManualMode ? 'bg-white dark:bg-gray-700 shadow-xl text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}
                >
                  Online Mode
                </button>
                <button
                  onClick={() => setIsManualMode(true)}
                  className={`flex-1 py-3.5 rounded-2xl text-sm font-black transition-all duration-300 ${isManualMode ? 'bg-white dark:bg-gray-700 shadow-xl text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}
                >
                  Offline Mode
                </button>
              </div>

              <AnimatePresence mode="wait">
                {!isManualMode ? (
                  <motion.div
                    key="online"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-6"
                  >
                    {roomId ? (
                      <div className="text-center">
                        {!isOnline && (
                          <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-xs rounded-2xl border border-amber-200 dark:border-amber-800/30 flex items-center space-x-3">
                            <AlertCircle className="w-5 h-5 flex-shrink-0" />
                            <span>You are currently offline. Please switch to "Offline Mode" or check your internet connection.</span>
                          </div>
                        )}
                        <p className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-widest mb-4">Share this code with receiver</p>
                        <div className="text-5xl sm:text-7xl font-mono font-black text-blue-600 dark:text-blue-400 tracking-[0.2em] py-10 bg-blue-50/50 dark:bg-blue-900/10 rounded-3xl border border-blue-100 dark:border-blue-900/30 shadow-inner">
                          {roomId}
                        </div>
                      </div>
                    ) : (
                      <div className="w-full h-48 bg-gray-100/50 dark:bg-gray-800/50 animate-pulse rounded-3xl"></div>
                    )}
                  </motion.div>
                ) : (
                  <motion.div
                    key="manual"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-6"
                  >
                    <div className="bg-gray-50/50 dark:bg-gray-900/30 p-6 rounded-2xl border border-gray-200 dark:border-gray-700">
                      <label className="block text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-widest mb-3">Optional: Encryption Key</label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                          type="text"
                          value={manualKey}
                          onChange={(e) => setManualKey(e.target.value)}
                          placeholder="Secret key for extra security"
                          className="w-full pl-10 pr-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm"
                        />
                      </div>
                    </div>

                    <div className="space-y-4">
                      <label className="block text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-widest">Step 1: Your Connection String</label>
                      {!localSdp ? (
                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={startManualGathering}
                          disabled={isGatheringIce}
                          className="w-full py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 dark:disabled:bg-gray-800 text-white rounded-2xl text-sm font-bold transition-all shadow-xl shadow-blue-500/20 flex items-center justify-center space-x-2"
                        >
                          {isGatheringIce ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
                          <span>{isGatheringIce ? 'Gathering ICE...' : 'Generate Connection String'}</span>
                        </motion.button>
                      ) : (
                        <div className="space-y-4">
                          <textarea
                            readOnly
                            value={localSdp}
                            className="w-full h-32 p-4 text-[11px] font-mono bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-2xl focus:outline-none break-all resize-none shadow-inner"
                          />
                          <div className="grid grid-cols-2 gap-3">
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(localSdp);
                                toast.success('Copied to clipboard');
                              }}
                              className="py-3 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-2"
                            >
                              <RefreshCw className="w-4 h-4" />
                              <span>Copy String</span>
                            </button>
                            <button
                              onClick={() => setShowQr(!showQr)}
                              className="py-3 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 text-blue-600 dark:text-blue-400 rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-2"
                            >
                              <QrCode className="w-4 h-4" />
                              <span>{showQr ? 'Hide QR' : 'Show QR'}</span>
                            </button>
                          </div>
                          <AnimatePresence>
                            {showQr && (
                              <motion.div 
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                className="flex flex-col items-center p-6 bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden"
                              >
                                <QRCodeSVG value={localSdp} size={200} level="L" includeMargin={true} />
                                <p className="text-[10px] text-gray-400 mt-4 font-medium">Ask receiver to scan this code</p>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      )}
                    </div>

                    <div className="space-y-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                      <label className="block text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-widest">Step 2: Receiver's Answer</label>
                      <div className="relative group">
                        <textarea
                          value={remoteSdp}
                          onChange={(e) => setRemoteSdp(e.target.value)}
                          placeholder="Paste the answer string here..."
                          className="w-full h-32 p-4 text-[11px] font-mono bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all resize-none shadow-inner"
                        />
                        <button
                          onClick={startScanner}
                          className="absolute bottom-3 right-3 p-3 bg-blue-600 text-white rounded-xl shadow-lg hover:bg-blue-700 transition-all hover:scale-110 active:scale-95"
                          title="Scan QR Code"
                        >
                          <Scan className="w-5 h-5" />
                        </button>
                      </div>
                      <motion.button
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.99 }}
                        onClick={() => handleManualConnect()}
                        disabled={!remoteSdp || peerConnected}
                        className="w-full py-4 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-2xl text-sm font-bold transition-all shadow-xl shadow-green-500/20"
                      >
                        Connect Manually
                      </motion.button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
          
          <div className="flex flex-col items-center space-y-4 w-full px-4">
            <div className="flex items-center space-x-3 bg-white/50 dark:bg-gray-800/50 px-5 py-2.5 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
              <div className="relative">
                <div className={`w-3 h-3 rounded-full ${peerConnected ? 'bg-green-500' : 'bg-amber-500'}`}></div>
                {peerConnected ? (
                  <div className="absolute inset-0 w-3 h-3 rounded-full bg-green-500 animate-ping"></div>
                ) : (
                  <div className="absolute inset-0 w-3 h-3 rounded-full bg-amber-500 animate-pulse"></div>
                )}
              </div>
              <span className="text-sm font-bold text-gray-700 dark:text-gray-200">
                {peerConnected ? 'Receiver Connected' : connectionDetail}
              </span>
            </div>
            
            {peerConnected && (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleManualDisconnect}
                className="px-6 py-2 bg-red-50 hover:bg-red-100 dark:bg-red-900/10 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl text-xs font-bold transition-all border border-red-100 dark:border-red-900/30"
              >
                Disconnect Session
              </motion.button>
            )}
          </div>

          {status === 'error' && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 rounded-3xl p-8 text-center w-full shadow-xl shadow-red-500/5"
            >
              <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-red-900 dark:text-red-100 mb-2">Connection Error</h3>
              <p className="text-red-700/70 dark:text-red-300/70 text-sm mb-8 leading-relaxed max-w-xs mx-auto">The peer connection was lost or failed. Please check your network and try again.</p>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  window.location.hash = '';
                  window.location.reload();
                }}
                className="px-8 py-3.5 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-2xl text-sm font-bold transition-all shadow-xl shadow-gray-900/10 dark:shadow-white/10 flex items-center space-x-2 mx-auto"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Restart Connection</span>
              </motion.button>
            </motion.div>
          )}
        </div>

        <div className="lg:col-span-7 space-y-8">
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4 }}
          >
            <h2 className="text-2xl font-black text-gray-900 dark:text-white mb-8 flex items-center space-x-4">
              <span className="w-10 h-10 bg-blue-600 text-white rounded-2xl flex items-center justify-center text-sm font-black shadow-xl shadow-blue-500/30">2</span>
              <span>Select Files</span>
            </h2>
            
            <div className="space-y-8">
              <FileDrop onFilesSelect={handleFilesSelect} disabled={!peerConnected} />
              
              <AnimatePresence>
                {files.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <FileQueue 
                      files={files} 
                      onCancel={handleCancel} 
                      onRetry={handleRetry} 
                      onPause={handlePause} 
                      onResume={handleResume} 
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      </div>

      <AnimatePresence>
        {showScanner && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-gray-900 p-8 rounded-[2.5rem] w-full max-w-md shadow-2xl"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">Scan Answer QR</h3>
                <button 
                  onClick={() => setShowScanner(false)} 
                  className="w-10 h-10 flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-full text-gray-600 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                >
                  ✕
                </button>
              </div>
              <div id="qr-reader" className="overflow-hidden rounded-3xl border-4 border-gray-100 dark:border-gray-800 shadow-inner"></div>
              <p className="text-center text-xs text-gray-600 mt-6 font-medium">Point your camera at the receiver's QR code</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
