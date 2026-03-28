import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { PeerConnection } from '../webrtc/peer';
import { FileReceiver } from '../webrtc/fileReceiver';
import { FileQueue, FileQueueItem } from '../components/FileQueue';
import { Download, AlertCircle, RefreshCw, KeyRound, Lock, QrCode, Scan, ArrowLeft, File, CheckCircle } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { QRCodeSVG } from 'qrcode.react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { decryptText, encryptText, deriveKeyFromPin } from '../lib/crypto';
import { addHistoryRecord, updateHistoryRecord } from '../lib/db';
import { v4 as uuidv4 } from 'uuid';

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
      }, (error) => {
        // console.warn(error);
      });
    }, 100);
  };

  const handleManualConnect = async () => {
    if (!remoteSdp) {
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
      await peerRef.current?.setManualSignal(remoteSdp);
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
    <div className="max-w-2xl mx-auto p-6">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Receive Files</h1>
        <p className="text-gray-500 dark:text-gray-400 mb-4">Secure peer-to-peer file transfer</p>
        <div className="inline-flex items-center space-x-1.5 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 px-3 py-1 rounded-full text-xs font-medium border border-green-200 dark:border-green-800/30">
          <Lock className="w-3.5 h-3.5" />
          <span>End-to-End Encrypted</span>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-8">
        {status === 'scanning' && (
          <div className="flex flex-col items-center justify-center space-y-8">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Enter Connection Code</h2>
              <p className="text-gray-500 dark:text-gray-400">Enter the 4-digit code displayed on the sender's screen</p>
            </div>

            <div className="flex justify-center mb-2">
              <div className="inline-flex p-1 bg-gray-100 dark:bg-gray-800 rounded-xl">
                <button
                  onClick={() => setIsManualMode(false)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${!isManualMode ? 'bg-white dark:bg-gray-700 shadow-sm text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}
                >
                  Online (Code)
                </button>
                <button
                  onClick={() => setIsManualMode(true)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${isManualMode ? 'bg-white dark:bg-gray-700 shadow-sm text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}
                >
                  Offline (Manual)
                </button>
              </div>
            </div>
            
            {!isManualMode ? (
              <div className="w-full max-w-md space-y-6">
                {!isOnline && (
                  <div className="mb-4 p-2 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-[10px] rounded-lg border border-amber-200 dark:border-amber-800/30 flex items-center space-x-2">
                    <AlertCircle className="w-3 h-3" />
                    <span>You are offline. Switch to "Offline (Manual)" mode.</span>
                  </div>
                )}
                <div className="flex justify-center space-x-1.5 sm:space-x-3">
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
                      className="w-9 h-12 sm:w-14 sm:h-20 text-center text-xl sm:text-3xl font-bold bg-gray-50 dark:bg-gray-900/50 border-2 border-gray-200 dark:border-gray-700 rounded-lg sm:rounded-2xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all text-gray-900 dark:text-white"
                    />
                  ))}
                </div>
                <button
                  onClick={handlePinSubmit}
                  disabled={pin.join('').length !== 4}
                  className="w-full py-3 sm:py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 dark:disabled:bg-blue-800 text-white font-bold rounded-xl transition-all shadow-lg shadow-blue-500/20 text-base sm:text-lg"
                >
                  Connect
                </button>
              </div>
            ) : (
              <div className="w-full max-w-sm space-y-6">
                <div className="text-left space-y-4">
                  <div>
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
                  
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Step 1: Paste Sender's String</label>
                    <div className="relative">
                      <textarea
                        value={remoteSdp}
                        onChange={(e) => setRemoteSdp(e.target.value)}
                        placeholder="Paste the connection string from the sender here..."
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
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Scan Offer QR</h3>
                            <button onClick={() => setShowScanner(false)} className="text-gray-500 hover:text-gray-700">✕</button>
                          </div>
                          <div id="qr-reader" className="overflow-hidden rounded-xl"></div>
                        </div>
                      </div>
                    )}
                    <button
                      onClick={handleManualConnect}
                      disabled={!remoteSdp}
                      className="w-full mt-2 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-blue-500/20"
                    >
                      Process Sender String
                    </button>
                  </div>

                  {localSdp && (
                    <div className="animate-in fade-in slide-in-from-top-4 duration-300">
                      <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Step 2: Your Answer String</label>
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
                          Copy Answer String
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
                            <p className="text-[10px] text-gray-500 mt-2 text-center">Sender should scan this QR code</p>
                          </div>
                        )}
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 text-center italic">Give this answer string back to the sender to complete the connection.</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {status === 'connecting' && (
          <div className="text-center py-12">
            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <h2 className="text-xl font-medium text-gray-900 dark:text-white">Connecting to Peer...</h2>
            <p className="text-gray-500 dark:text-gray-400 mt-2">{connectionDetail}</p>
          </div>
        )}

        {status === 'connected' && (
          <div className="py-4">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center space-x-2 text-sm">
                <div className="w-3 h-3 rounded-full bg-green-500"></div>
                <span className="text-gray-600 dark:text-gray-300">
                  Sender Connected
                </span>
              </div>
              <button
                onClick={handleManualDisconnect}
                className="px-4 py-2 bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50 text-red-700 dark:text-red-400 rounded-xl text-sm font-semibold transition-colors"
              >
                Disconnect
              </button>
            </div>

            {files.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Download className="w-8 h-8 text-blue-500" />
                </div>
                <h2 className="text-xl font-medium text-gray-900 dark:text-white">Connected!</h2>
                <p className="text-gray-500 dark:text-gray-400 mt-2">Waiting for sender to select files...</p>
              </div>
            ) : (
              <FileQueue 
                files={files} 
                onCancel={handleCancel}
                onPause={handlePause}
                onResume={handleResume}
              />
            )}
          </div>
        )}

        {status === 'error' && (
          <div className="text-center py-8">
            <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-medium text-red-900 dark:text-red-100 mb-2">Connection Lost</h2>
            <p className="text-red-700 dark:text-red-300 mb-6">The connection to the sender was lost.</p>
            <button
              onClick={() => {
                window.location.hash = '';
                window.location.reload();
              }}
              className="px-6 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-white rounded-full transition-colors"
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
