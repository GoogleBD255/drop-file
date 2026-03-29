import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { PeerConnection } from '../webrtc/peer';
import { FileReceiver } from '../webrtc/fileReceiver';
import { FileQueue, FileQueueItem } from '../components/FileQueue';
import { Download, AlertCircle, RefreshCw, KeyRound, Lock, QrCode, Scan, ArrowLeft, File, CheckCircle, Wifi, WifiOff, ShieldCheck } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { QRCodeSVG } from 'qrcode.react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { decryptText, encryptText, deriveKeyFromPin } from '../lib/crypto';
import { addHistoryRecord, updateHistoryRecord } from '../lib/db';
import { v4 as uuidv4 } from 'uuid';
import { motion, AnimatePresence } from 'motion/react';

export function Receive() {
  const { roomId } = useParams<{ roomId: string }>();
  const location = useLocation();
  const [encryptionKey, setEncryptionKey] = useState<string>(location.hash.replace('#', ''));
  const navigate = useNavigate();
  
  const [peerConnected, setPeerConnected] = useState(false);
  const [files, setFiles] = useState<FileQueueItem[]>([]);
  const [status, setStatus] = useState<'scanning' | 'connecting' | 'connected' | 'error'>('connecting');
  const [connectionDetail, setConnectionDetail] = useState<string>('Establishing secure WebRTC connection');
  const [isManualMode, setIsManualMode] = useState(false);
  const [localSdp, setLocalSdp] = useState('');
  const [remoteSdp, setRemoteSdp] = useState('');
  const [manualKey, setManualKey] = useState('');
  const [isGatheringIce, setIsGatheringIce] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [showQr, setShowQr] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [pin, setPin] = useState(['', '', '', '']);
  const pinRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null)
  ];
  
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const peerRef = useRef<PeerConnection | null>(null);
  const receiversRef = useRef<Map<number, FileReceiver>>(new Map());

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

          if (data.type === 'metadata') {
            const receiver = new FileReceiver(data, key);
            const dbId = uuidv4();
            
            await addHistoryRecord({
              id: dbId,
              fileName: data.name,
              fileSize: data.size,
              fileType: data.fileType || '',
              direction: 'received',
              status: 'failed', // Default to failed until complete
              timestamp: Date.now(),
            });
            
            receiver.onProgress = (p, s) => {
              peer.resetActivity();
              setFiles(prev => prev.map(f => f.id === data.fileId ? { ...f, progress: p, speed: s } : f));
            };
            
            receiver.onComplete = (file) => {
              const url = URL.createObjectURL(file);
              setFiles(prev => prev.map(f => f.id === data.fileId ? { ...f, status: 'completed', progress: 100, speed: 0, url } : f));
              receiversRef.current.delete(data.fileId);
              
              updateHistoryRecord(dbId, { status: 'completed', blob: file });
              toast.success(`File received: ${file.name}`);
              
              // Auto download
              const a = document.createElement('a');
              a.href = url;
              a.download = file.name;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
            };

            receiver.onError = (err) => {
              console.error(err);
              setFiles(prev => prev.map(f => f.id === data.fileId ? { ...f, status: 'error' } : f));
              receiversRef.current.delete(data.fileId);
              updateHistoryRecord(dbId, { status: 'failed' });
              toast.error(`Error receiving file: ${data.name}. ${err}`);
            };

            receiversRef.current.set(data.fileId, receiver);
            
            setFiles(prev => [...prev, {
              id: data.fileId,
              dbId,
              name: data.name,
              size: data.size,
              type: data.fileType,
              progress: 0,
              speed: 0,
              status: 'transferring'
            }]);
          } else if (data.type === 'complete') {
            receiversRef.current.get(data.fileId)?.finish();
          } else if (data.type === 'cancel') {
            const receiver = receiversRef.current.get(data.fileId);
            if (receiver) {
              receiver.cancel();
              receiversRef.current.delete(data.fileId);
            }
            setFiles(prev => prev.map(f => {
              if (f.id === data.fileId) {
                if (f.dbId) updateHistoryRecord(f.dbId, { status: 'cancelled' });
                return { ...f, status: 'cancelled' };
              }
              return f;
            }));
          } else if (data.type === 'pause') {
            setFiles(prev => prev.map(f => f.id === data.fileId ? { ...f, status: 'paused', speed: 0 } : f));
          } else if (data.type === 'resume') {
            setFiles(prev => prev.map(f => f.id === data.fileId ? { ...f, status: 'transferring' } : f));
          } else if (data.type === 'disconnect') {
            handleManualDisconnect();
          }
        } catch (e) {
          console.error("Error parsing message", e);
        }
      } else if (event.data instanceof ArrayBuffer) {
        const view = new DataView(event.data);
        const fileId = view.getUint32(0);
        const chunk = event.data.slice(4);
        receiversRef.current.get(fileId)?.receiveChunk(chunk);
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
    if (!roomId) {
      setStatus('scanning');
      return;
    }

    const initConnection = async () => {
      let key = location.hash.replace('#', '');
      if (!key && roomId.length === 4) {
        key = await deriveKeyFromPin(roomId);
      }
      setEncryptionKey(key);

      setStatus('connecting');
      setConnectionDetail('Connecting to signaling server...');
      const peer = new PeerConnection(roomId, false);
      peerRef.current = peer;

      peer.onError = (msg) => {
        toast.error(msg);
      };

      peer.onManualSignal = (signal) => {
        setLocalSdp(signal);
        setIsGatheringIce(false);
      };

      peer.onConnectionStateChange = (state) => {
        console.log("Receive Peer State:", state);
        if (state === 'connecting') {
          setConnectionDetail('Exchanging signals with sender...');
        } else if (state === 'connected') {
          setPeerConnected(true);
          setStatus('connected');
          toast.success('Connected to sender!');
        } else if (state === 'disconnected') {
          setConnectionDetail('Connection unstable, attempting to reconnect...');
          toast.loading('Reconnecting...', { id: 'reconnect-toast' });
        } else if (state === 'failed') {
          setPeerConnected(false);
          setStatus('error');
          toast.error('Connection failed.', { id: 'reconnect-toast' });
        }
      };

      peer.onDataChannel = (channel) => {
        setupDataChannel(peer, channel, key);
      };

      peer.onDisconnect = () => {
        setPeerConnected(false);
        setStatus('error');
        toast.error('Disconnected due to inactivity.');
      };
    };

    initConnection();

    return () => {
      if (peerRef.current) {
        peerRef.current.close();
      }
      // Cleanup URLs
      setFiles(prev => {
        prev.forEach(f => {
          if (f.url) URL.revokeObjectURL(f.url);
        });
        return prev;
      });
    };
  }, [roomId, location.hash]);

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
        toast.success("Offer string scanned!");
        handleManualConnect(decodedText);
      }, (error) => {
        // console.warn(error);
      });
    }, 100);
  };

  const handleManualConnect = async (sdpOverride?: string) => {
    const sdpToUse = sdpOverride || remoteSdp;
    if (!sdpToUse) {
      toast.error("Please paste the connection string from the sender");
      return;
    }
    
    // If we haven't initialized the peer yet (because we are in 'scanning' state)
    if (!peerRef.current) {
      const dummyRoomId = "manual-" + Date.now();
      const peer = new PeerConnection(dummyRoomId, false, true);
      peerRef.current = peer;
      
      peer.onError = (msg) => toast.error(msg);
      peer.onManualSignal = (signal) => {
        setLocalSdp(signal);
        setIsGatheringIce(false);
      };
      
      peer.onConnectionStateChange = (state) => {
        console.log("Manual Receive Peer State:", state);
        if (state === 'connected') {
          setPeerConnected(true);
          setStatus('connected');
          toast.success('Connected to sender!');
        } else if (state === 'failed') {
          setStatus('error');
        }
      };

      peer.onDataChannel = (channel) => {
        setupDataChannel(peer, channel, manualKey || undefined);
      };
    }

    try {
      setIsGatheringIce(true);
      setStatus('connecting');
      setConnectionDetail('Processing sender string...');
      await peerRef.current?.setManualSignal(sdpToUse);
    } catch (e) {
      toast.error("Invalid connection string");
      setStatus('scanning');
    }
  };

  const handlePinChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    
    const newPin = [...pin];
    newPin[index] = value.slice(-1); // Only keep the last digit
    setPin(newPin);

    // Auto-advance to next input
    if (value && index < 3) {
      pinRefs[index + 1].current?.focus();
    }
  };

  const handlePinKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !pin[index] && index > 0) {
      // Move to previous input on backspace if current is empty
      pinRefs[index - 1].current?.focus();
    } else if (e.key === 'Enter') {
      handlePinSubmit();
    }
  };

  const handlePinSubmit = () => {
    const fullPin = pin.join('');
    if (fullPin.length === 4) {
      navigate(`/receive/${fullPin}`);
    } else {
      toast.error('Please enter a 4-digit code.');
    }
  };

  const handleCancel = (id: number) => {
    const receiver = receiversRef.current.get(id);
    if (receiver) {
      receiver.cancel();
      receiversRef.current.delete(id);
    }
    setFiles(prev => prev.map(f => f.id === id ? { ...f, status: 'cancelled' } : f));
    peerRef.current?.sendMessage?.({ type: 'cancel', fileId: id });
  };

  const handlePause = (id: number) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, status: 'paused', speed: 0 } : f));
    peerRef.current?.sendMessage?.({ type: 'pause', fileId: id });
  };

  const handleResume = (id: number) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, status: 'transferring' } : f));
    peerRef.current?.sendMessage?.({ type: 'resume', fileId: id });
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
        setStatus('scanning');
        toast.success('Disconnected successfully');
        // Reload page to reset state completely
        window.location.href = '/receive';
      }, 200); // Slightly longer delay to ensure message is sent
    }
  };

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
      className="max-w-4xl mx-auto p-4 sm:p-6"
    >
      <div className="text-center mb-8 sm:mb-12">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="inline-block p-4 bg-blue-100 dark:bg-blue-900/30 rounded-3xl mb-6 shadow-xl shadow-blue-500/10"
        >
          <Download className="w-10 h-10 text-blue-600 dark:text-blue-400" />
        </motion.div>
        <h1 className="text-4xl sm:text-6xl font-black text-gray-900 dark:text-white mb-6 tracking-tighter">Receive Files</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-8 max-w-md mx-auto leading-relaxed font-medium text-lg">Securely receive files directly from another device using peer-to-peer technology.</p>
        
        <div className="flex flex-wrap justify-center gap-3">
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
        <div className="lg:col-span-12">
          <motion.div 
            layout
            className="glass rounded-3xl shadow-xl border border-white/20 dark:border-gray-700/30 overflow-hidden"
          >
            <AnimatePresence mode="wait">
              {status === 'scanning' && (
                <motion.div 
                  key="scanning"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="p-6 sm:p-10"
                >
                  <div className="flex flex-col items-center justify-center space-y-8">
                    <div className="text-center mb-10">
                      <h2 className="text-3xl font-black text-gray-900 dark:text-white mb-3 tracking-tight">Connect to Sender</h2>
                      <p className="text-gray-600 dark:text-gray-400 font-medium">Choose a connection method to start receiving files</p>
                    </div>

                    <div className="inline-flex p-1.5 bg-gray-100/50 dark:bg-gray-900/50 rounded-[1.5rem] border border-gray-200/50 dark:border-gray-700/50 mb-12">
                      <button
                        onClick={() => setIsManualMode(false)}
                        className={`px-8 py-3.5 rounded-2xl text-sm font-black transition-all duration-300 ${!isManualMode ? 'bg-white dark:bg-gray-700 shadow-xl text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}
                      >
                        Online (Code)
                      </button>
                      <button
                        onClick={() => setIsManualMode(true)}
                        className={`px-8 py-3.5 rounded-2xl text-sm font-black transition-all duration-300 ${isManualMode ? 'bg-white dark:bg-gray-700 shadow-xl text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}
                      >
                        Offline (Manual)
                      </button>
                    </div>
                    
                    {!isManualMode ? (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="w-full max-w-md space-y-8"
                      >
                        {!isOnline && (
                          <div className="p-4 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-xs rounded-2xl border border-amber-200 dark:border-amber-800/30 flex items-center space-x-3">
                            <AlertCircle className="w-5 h-5 flex-shrink-0" />
                            <span>You are currently offline. Please switch to "Offline (Manual)" mode or check your internet connection.</span>
                          </div>
                        )}
                        
                        <div className="space-y-4">
                          <label className="block text-center text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-widest">Enter 4-Digit Code</label>
                          <div className="flex justify-center space-x-3 sm:space-x-4">
                            {pin.map((digit, index) => (
                              <input
                                key={index}
                                ref={pinRefs[index]}
                                type="text"
                                inputMode="numeric"
                                pattern="\d*"
                                maxLength={1}
                                value={digit}
                                onChange={(e) => handlePinChange(index, e.target.value)}
                                onKeyDown={(e) => handlePinKeyDown(index, e)}
                                className="w-14 h-20 sm:w-16 sm:h-24 text-center text-3xl sm:text-4xl font-bold bg-white dark:bg-gray-900 border-2 border-gray-200 dark:border-gray-700 rounded-2xl focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all text-gray-900 dark:text-white shadow-sm"
                              />
                            ))}
                          </div>
                        </div>

                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={handlePinSubmit}
                          disabled={pin.join('').length !== 4 || !isOnline}
                          className="w-full py-5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:from-gray-400 disabled:to-gray-500 dark:disabled:from-gray-800 dark:disabled:to-gray-900 text-white font-bold rounded-2xl transition-all shadow-xl shadow-blue-500/25 text-lg flex items-center justify-center space-x-2"
                        >
                          <span>Connect to Sender</span>
                        </motion.button>
                      </motion.div>
                    ) : (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="w-full max-w-lg space-y-8"
                      >
                        <div className="space-y-6">
                          <div className="bg-gray-50/50 dark:bg-gray-900/30 p-6 rounded-2xl border border-gray-200 dark:border-gray-700">
                            <label className="block text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-widest mb-3">Optional: Encryption Key</label>
                            <div className="relative">
                              <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                              <input
                                type="text"
                                value={manualKey}
                                onChange={(e) => setManualKey(e.target.value)}
                                placeholder="Enter a secret key (optional)"
                                className="w-full pl-10 pr-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                              />
                            </div>
                            <p className="text-[10px] text-gray-400 mt-2 italic">Both devices must use the same key for secure transfer.</p>
                          </div>
                          
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <label className="block text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-widest">Step 1: Paste Sender's String</label>
                              <button
                                onClick={startScanner}
                                className="flex items-center space-x-1.5 text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline"
                              >
                                <Scan className="w-3.5 h-3.5" />
                                <span>Scan QR Code</span>
                              </button>
                            </div>
                            
                            <div className="relative group">
                              <textarea
                                value={remoteSdp}
                                onChange={(e) => setRemoteSdp(e.target.value)}
                                placeholder="Paste the connection string from the sender here..."
                                className="w-full h-32 p-4 text-[11px] font-mono bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all resize-none shadow-inner"
                              />
                              <div className="absolute inset-0 rounded-2xl border-2 border-blue-500/0 group-focus-within:border-blue-500/20 pointer-events-none transition-all"></div>
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
                                    className="bg-white dark:bg-gray-800 p-6 rounded-3xl w-full max-w-md shadow-2xl"
                                  >
                                    <div className="flex justify-between items-center mb-6">
                                      <h3 className="text-xl font-bold text-gray-900 dark:text-white">Scan QR Code</h3>
                                      <button 
                                        onClick={() => setShowScanner(false)} 
                                        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
                                      >
                                        <ArrowLeft className="w-5 h-5" />
                                      </button>
                                    </div>
                                    <div id="qr-reader" className="overflow-hidden rounded-2xl border-2 border-gray-100 dark:border-gray-100"></div>
                                    <p className="text-center text-sm text-gray-600 mt-4">Point your camera at the sender's QR code</p>
                                  </motion.div>
                                </motion.div>
                              )}
                            </AnimatePresence>

                            <motion.button
                              whileHover={{ scale: 1.01 }}
                              whileTap={{ scale: 0.99 }}
                              onClick={handleManualConnect}
                              disabled={!remoteSdp}
                              className="w-full py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 dark:disabled:bg-gray-800 text-white rounded-2xl font-bold transition-all shadow-lg shadow-blue-500/20"
                            >
                              Process Sender String
                            </motion.button>
                          </div>

                          {isGatheringIce && !localSdp && (
                            <div className="flex flex-col items-center justify-center p-8 space-y-3 bg-blue-50/50 dark:bg-blue-900/10 rounded-2xl border border-blue-100 dark:border-blue-800/30">
                              <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
                              <p className="text-sm font-medium text-blue-600 dark:text-blue-400">Generating connection answer...</p>
                            </div>
                          )}

                          <AnimatePresence>
                            {localSdp && (
                              <motion.div 
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                className="space-y-4 pt-4 border-t border-gray-100 dark:border-gray-700"
                              >
                                <label className="block text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-widest">Step 2: Your Answer String</label>
                                <div className="space-y-3">
                                  <textarea
                                    readOnly
                                    value={localSdp}
                                    className="w-full h-32 p-4 text-[11px] font-mono bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-2xl focus:outline-none resize-none shadow-inner"
                                  />
                                  <div className="grid grid-cols-2 gap-3">
                                    <button
                                      onClick={() => {
                                        navigator.clipboard.writeText(localSdp);
                                        toast.success('Copied to clipboard');
                                      }}
                                      className="py-3 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-xl text-sm font-bold transition-all flex items-center justify-center space-x-2"
                                    >
                                      <RefreshCw className="w-4 h-4" />
                                      <span>Copy String</span>
                                    </button>
                                    <button
                                      onClick={() => setShowQr(!showQr)}
                                      className="py-3 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 text-blue-600 dark:text-blue-400 rounded-xl text-sm font-bold transition-all flex items-center justify-center space-x-2"
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
                                        className="flex flex-col items-center p-6 bg-white rounded-3xl shadow-xl border border-gray-100"
                                      >
                                        <QRCodeSVG value={localSdp} size={240} level="L" includeMargin={true} />
                                        <p className="text-xs font-medium text-gray-600 mt-4 text-center">Ask the sender to scan this QR code to complete the connection</p>
                                      </motion.div>
                                    )}
                                  </AnimatePresence>
                                  <p className="text-[11px] text-gray-500 dark:text-gray-500 text-center italic">The connection will be established once the sender receives this answer.</p>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </motion.div>
                    )}
                  </div>
                </motion.div>
              )}

              {status === 'connecting' && (
                <motion.div 
                  key="connecting"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="p-12 sm:p-20 text-center"
                >
                  <div className="relative w-24 h-24 mx-auto mb-8">
                    <div className="absolute inset-0 border-4 border-blue-500/20 rounded-full"></div>
                    <div className="absolute inset-0 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <RefreshCw className="w-8 h-8 text-blue-600 animate-pulse" />
                    </div>
                  </div>
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">Connecting to Peer</h2>
                  <p className="text-gray-600 dark:text-gray-400 max-w-xs mx-auto">{connectionDetail}</p>
                </motion.div>
              )}

              {status === 'connected' && (
                <motion.div 
                  key="connected"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="p-6 sm:p-8"
                >
                  <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-8 pb-6 border-b border-gray-100 dark:border-gray-700">
                    <div className="flex items-center space-x-3 bg-green-50 dark:bg-green-900/20 px-4 py-2 rounded-2xl border border-green-100 dark:border-green-800/30">
                      <div className="relative">
                        <div className="w-3 h-3 rounded-full bg-green-500"></div>
                        <div className="absolute inset-0 w-3 h-3 rounded-full bg-green-500 animate-ping"></div>
                      </div>
                      <span className="text-sm font-bold text-green-700 dark:text-green-400">
                        Connected to Sender
                      </span>
                    </div>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={handleManualDisconnect}
                      className="w-full sm:w-auto px-6 py-2.5 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 rounded-xl text-sm font-bold transition-all border border-red-100 dark:border-red-800/30"
                    >
                      Disconnect
                    </motion.button>
                  </div>

                  {files.length === 0 ? (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-center py-16 sm:py-24"
                    >
                      <div className="w-20 h-20 bg-blue-50 dark:bg-blue-900/20 rounded-3xl flex items-center justify-center mx-auto mb-6">
                        <Download className="w-10 h-10 text-blue-500 animate-bounce" />
                      </div>
                      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Ready to Receive</h2>
                      <p className="text-gray-600 dark:text-gray-400 max-w-xs mx-auto">The connection is established. Waiting for the sender to pick files...</p>
                    </motion.div>
                  ) : (
                    <div className="animate-in fade-in duration-500">
                      <FileQueue 
                        files={files} 
                        onCancel={handleCancel}
                        onPause={handlePause}
                        onResume={handleResume}
                      />
                    </div>
                  )}
                </motion.div>
              )}

              {status === 'error' && (
                <motion.div 
                  key="error"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="p-12 sm:p-20 text-center"
                >
                  <div className="w-20 h-20 bg-red-50 dark:bg-red-900/20 rounded-3xl flex items-center justify-center mx-auto mb-6">
                    <AlertCircle className="w-10 h-10 text-red-500" />
                  </div>
                  <h2 className="text-2xl font-bold text-red-900 dark:text-red-100 mb-3">Connection Lost</h2>
                  <p className="text-red-700/70 dark:text-red-300/70 mb-8 max-w-xs mx-auto">The secure link between devices was interrupted. Please try connecting again.</p>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => {
                      window.location.hash = '';
                      window.location.reload();
                    }}
                    className="px-8 py-3.5 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-2xl font-bold transition-all shadow-xl shadow-gray-900/10 dark:shadow-white/10"
                  >
                    Try Reconnecting
                  </motion.button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}
