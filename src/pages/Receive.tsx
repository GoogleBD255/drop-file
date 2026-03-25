import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { PeerConnection } from '../webrtc/peer';
import { FileReceiver } from '../webrtc/fileReceiver';
import { FileQueue, FileQueueItem } from '../components/FileQueue';
import { Download, AlertCircle, Camera, Image as ImageIcon, Upload, Link as LinkIcon, RefreshCw, KeyRound } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import { toast } from 'react-hot-toast';
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
  const [scanMethod, setScanMethod] = useState<'camera' | 'file'>('camera');
  const [manualMode, setManualMode] = useState<'code' | 'link'>('code');
  const [pin, setPin] = useState(['', '', '', '']);
  const [permissionState, setPermissionState] = useState<'prompt' | 'granted' | 'denied' | 'not_now'>(() => {
    return localStorage.getItem('cameraPermissionGranted') === 'true' ? 'granted' : 'prompt';
  });
  const [cameras, setCameras] = useState<any[]>([]);
  const [currentCameraIndex, setCurrentCameraIndex] = useState(0);
  const [manualLink, setManualLink] = useState('');
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pinRefs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];
  
  const peerRef = useRef<PeerConnection | null>(null);
  const receiversRef = useRef<Map<number, FileReceiver>>(new Map());

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
      const peer = new PeerConnection(roomId, false);
      peerRef.current = peer;

      peer.onConnectionStateChange = (state) => {
        if (state === 'connected') {
          setPeerConnected(true);
          setStatus('connected');
          toast.success('Connected to sender!');
        } else if (state === 'disconnected' || state === 'failed') {
          setPeerConnected(false);
          setStatus('error');
          toast.error('Connection to sender lost.');
        }
      };

      peer.onDataChannel = (channel) => {
        const sendMessage = async (message: any) => {
          if (key) {
            const encrypted = await encryptText(JSON.stringify(message), key);
            channel.send(JSON.stringify({ type: 'encrypted', payload: encrypted }));
          } else {
            channel.send(JSON.stringify(message));
          }
        };

        peerRef.current!.sendMessage = sendMessage;

        channel.onmessage = async (event) => {
          if (typeof event.data === 'string') {
            try {
              let data = JSON.parse(event.data);
              
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

  const handleScanSuccess = (text: string) => {
    try {
      const url = new URL(text);
      const parts = url.pathname.split('/');
      const id = parts[parts.length - 1];
      if (id) {
        toast.success('QR Code scanned successfully!');
        navigate(`/receive/${id}${url.hash}`);
      } else {
        toast.error('Invalid QR code format.');
      }
    } catch (e) {
      console.error("Invalid QR code URL");
      toast.error('Invalid QR code URL. Please try again.');
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const loadingToast = toast.loading('Scanning image...');
    try {
      const html5QrCode = new Html5Qrcode("reader-hidden");
      const decodedText = await html5QrCode.scanFile(file, true);
      toast.dismiss(loadingToast);
      handleScanSuccess(decodedText);
    } catch (err) {
      console.error("Error scanning file", err);
      toast.dismiss(loadingToast);
      toast.error("Could not find a valid QR code in the image.");
    }
    
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualLink.trim()) return;
    
    try {
      let id = manualLink.trim();
      let hash = '';
      if (manualLink.includes('/')) {
        const url = new URL(manualLink.startsWith('http') ? manualLink : `https://${manualLink}`);
        const parts = url.pathname.split('/');
        id = parts[parts.length - 1];
        hash = url.hash;
      }
      
      if (id) {
        navigate(`/receive/${id}${hash}`);
      } else {
        toast.error('Invalid link format.');
      }
    } catch (err) {
      // If it's just a room ID
      navigate(`/receive/${manualLink.trim()}`);
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

  const handleAllowCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach(track => track.stop());
      localStorage.setItem('cameraPermissionGranted', 'true');
      setPermissionState('granted');
    } catch (err) {
      console.error("Camera permission error:", err);
      setPermissionState('denied');
      localStorage.removeItem('cameraPermissionGranted');
    }
  };

  useEffect(() => {
    Html5Qrcode.getCameras().then(devices => {
      if (devices && devices.length > 1) {
        setCameras(devices);
      }
    }).catch(err => {
      console.error("Error getting cameras", err);
    });
  }, []);

  useEffect(() => {
    if (status === 'scanning' && scanMethod === 'camera' && permissionState === 'granted') {
      const html5QrCode = new Html5Qrcode("reader");
      html5QrCodeRef.current = html5QrCode;
      
      const cameraConfig = cameras.length > 0 
        ? { deviceId: cameras[currentCameraIndex].id }
        : { facingMode: "environment" };

      html5QrCode.start(
        cameraConfig,
        { 
          fps: 10, 
        },
        (decodedText) => {
          if (html5QrCodeRef.current && html5QrCodeRef.current.isScanning) {
            html5QrCodeRef.current.stop().catch(console.error);
          }
          handleScanSuccess(decodedText);
        },
        (errorMessage) => {
          // ignore errors during scanning
        }
      ).then(() => {
        // successfully started
      }).catch(err => {
        console.error("Error starting camera", err);
        const errorMsg = err.toString().toLowerCase();
        if (errorMsg.includes("notallowederror") || errorMsg.includes("permission denied")) {
          setPermissionState('denied');
          localStorage.removeItem('cameraPermissionGranted');
          toast.error("Camera permission was denied. Please check and try again.");
        } else {
          toast.error("Could not access camera. Please check permissions.");
        }
      });

      return () => {
        if (html5QrCodeRef.current && html5QrCodeRef.current.isScanning) {
          html5QrCodeRef.current.stop().then(() => {
            html5QrCodeRef.current?.clear();
          }).catch(console.error);
        }
      };
    }
  }, [status, scanMethod, permissionState, currentCameraIndex, cameras, navigate]);

  const switchCamera = () => {
    if (cameras.length > 1) {
      setCurrentCameraIndex((prev) => (prev + 1) % cameras.length);
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

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Receive Files</h1>
        <p className="text-gray-500 dark:text-gray-400">Secure peer-to-peer file transfer</p>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-8">
        {status === 'scanning' && (
          <div className="flex flex-col items-center justify-center space-y-8">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Scan QR Code</h2>
              <p className="text-gray-500 dark:text-gray-400">Point your camera at the sender's screen</p>
            </div>
            
            <div className="w-full max-w-md relative">
              {scanMethod === 'camera' ? (
                <div className="relative group">
                  <div id="reader" className="mx-auto w-full overflow-hidden rounded-3xl border-4 border-blue-500/20 dark:border-blue-400/20 bg-black aspect-square shadow-2xl relative z-0 flex items-center justify-center">
                    {/* Custom Modal for Prompt */}
                    {permissionState === 'prompt' && (
                      <div className="absolute inset-0 z-30 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-4 sm:p-6 text-center overflow-y-auto">
                        <div className="my-auto flex flex-col items-center justify-center w-full">
                          <div className="w-12 h-12 sm:w-16 sm:h-16 bg-blue-500/20 rounded-full flex items-center justify-center mb-3 sm:mb-4 flex-shrink-0">
                            <Camera className="w-6 h-6 sm:w-8 h-8 text-blue-500" />
                          </div>
                          <h3 className="text-lg sm:text-xl font-bold text-white mb-1.5 sm:mb-2">Camera Permission Required</h3>
                          <p className="text-white/70 text-xs sm:text-sm mb-5 sm:mb-6 max-w-[250px] sm:max-w-none">
                            Camera access is needed to scan QR codes and transfer files securely.
                          </p>
                          <div className="flex flex-col w-full space-y-2.5 sm:space-y-3">
                            <button
                              onClick={handleAllowCamera}
                              className="w-full py-2.5 sm:py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition-all shadow-lg shadow-blue-500/30 text-sm sm:text-base"
                            >
                              Allow Camera
                            </button>
                            <button
                              onClick={() => setPermissionState('not_now')}
                              className="w-full py-2.5 sm:py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl font-medium transition-all text-sm sm:text-base"
                            >
                              Not Now
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Not Now State */}
                    {permissionState === 'not_now' && (
                      <div className="absolute inset-0 z-30 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-4 sm:p-6 text-center overflow-y-auto">
                        <div className="my-auto flex flex-col items-center justify-center w-full">
                          <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gray-500/20 rounded-full flex items-center justify-center mb-3 sm:mb-4 flex-shrink-0">
                            <Camera className="w-6 h-6 sm:w-8 sm:h-8 text-gray-400" />
                          </div>
                          <h3 className="text-lg sm:text-xl font-bold text-white mb-1.5 sm:mb-2">Camera is Required</h3>
                          <p className="text-white/70 text-xs sm:text-sm mb-5 sm:mb-6 max-w-[250px] sm:max-w-none">
                            We cannot scan QR codes without camera access. You can upload an image instead.
                          </p>
                          <button
                            onClick={() => setPermissionState('prompt')}
                            className="px-6 sm:px-8 py-2.5 sm:py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition-all shadow-lg shadow-blue-500/30 flex items-center space-x-2 text-sm sm:text-base"
                          >
                            <RefreshCw className="w-4 h-4 sm:w-5 sm:h-5" />
                            <span>Try Again</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Denied State */}
                    {permissionState === 'denied' && (
                      <div className="absolute inset-0 z-30 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-4 sm:p-6 text-center overflow-y-auto">
                        <div className="my-auto flex flex-col items-center justify-center w-full">
                          <div className="w-10 h-10 sm:w-16 sm:h-16 bg-red-500/20 rounded-full flex items-center justify-center mb-2 sm:mb-4 flex-shrink-0">
                            <AlertCircle className="w-5 h-5 sm:w-8 sm:h-8 text-red-500" />
                          </div>
                          <h3 className="text-base sm:text-xl font-bold text-white mb-2 sm:mb-2">Permission Blocked</h3>
                          <div className="text-white/70 text-[10px] sm:text-sm mb-4 sm:mb-6 space-y-1 sm:space-y-2 text-left bg-white/5 p-3 sm:p-4 rounded-xl w-full">
                            <p className="font-semibold text-white text-center mb-1 sm:mb-2">How to unblock:</p>
                            <ul className="list-disc pl-4 space-y-0.5 sm:space-y-1">
                              <li><strong>iPhone:</strong> Tap 'aA' in address bar → Website Settings → Allow Camera.</li>
                              <li><strong>Android:</strong> Tap lock icon 🔒 in address bar → Permissions → Allow Camera.</li>
                              <li><strong>Desktop:</strong> Click camera/lock icon in address bar → Allow.</li>
                            </ul>
                          </div>
                          <button
                            onClick={() => {
                              window.location.hash = '';
                              window.location.reload();
                            }}
                            className="px-6 sm:px-8 py-2.5 sm:py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition-all shadow-lg shadow-blue-500/30 flex items-center space-x-2 text-sm sm:text-base"
                          >
                            <RefreshCw className="w-4 h-4 sm:w-5 sm:h-5" />
                            <span>Reload Page</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {/* Scanner Overlay UI */}
                  {permissionState === 'granted' && (
                    <>
                      <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center">
                        <div className="absolute top-0 left-0 w-full h-1 bg-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.5)] animate-scan"></div>
                      </div>
                      
                      {cameras.length > 1 && (
                        <button
                          onClick={switchCamera}
                          className="absolute bottom-6 right-6 z-20 p-3 bg-black/50 backdrop-blur-md border border-white/20 rounded-full text-white hover:bg-black/70 transition-all shadow-lg"
                        >
                          <RefreshCw className="w-6 h-6" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="cursor-pointer mx-auto w-full overflow-hidden rounded-3xl border-4 border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 aspect-square flex flex-col items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-all shadow-xl p-4 sm:p-6 text-center"
                >
                  <Upload className="w-12 h-12 sm:w-16 sm:h-16 text-gray-400 mb-3 sm:mb-4 flex-shrink-0" />
                  <p className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">Upload QR Code</p>
                  <p className="text-xs sm:text-sm text-gray-500 mt-1.5 sm:mt-2">Tap to select an image</p>
                </div>
              )}
            </div>

            <div className="flex flex-col w-full max-w-md space-y-6">
              <div className="flex bg-gray-100 dark:bg-gray-700/50 p-1.5 rounded-2xl">
                <button
                  onClick={() => setScanMethod('camera')}
                  className={`flex-1 flex items-center justify-center space-x-2 py-3 rounded-xl text-sm font-semibold transition-all ${
                    scanMethod === 'camera' 
                      ? 'bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm' 
                      : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  }`}
                >
                  <Camera className="w-5 h-5" />
                  <span>Camera</span>
                </button>
                <button
                  onClick={() => setScanMethod('file')}
                  className={`flex-1 flex items-center justify-center space-x-2 py-3 rounded-xl text-sm font-semibold transition-all ${
                    scanMethod === 'file' 
                      ? 'bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm' 
                      : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  }`}
                >
                  <ImageIcon className="w-5 h-5" />
                  <span>Upload</span>
                </button>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center" aria-hidden="true">
                  <div className="w-full border-t border-gray-200 dark:border-gray-700"></div>
                </div>
                <div className="relative flex justify-center">
                  <span className="px-3 bg-white dark:bg-gray-800 text-sm font-medium text-gray-400 uppercase tracking-widest">Or connect manually</span>
                </div>
              </div>

              <div className="flex bg-gray-100 dark:bg-gray-700/50 p-1.5 rounded-2xl">
                <button
                  onClick={() => setManualMode('code')}
                  className={`flex-1 flex items-center justify-center space-x-2 py-2 rounded-xl text-sm font-medium transition-all ${
                    manualMode === 'code' 
                      ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm' 
                      : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  }`}
                >
                  <KeyRound className="w-4 h-4" />
                  <span>4-Digit Code</span>
                </button>
                <button
                  onClick={() => setManualMode('link')}
                  className={`flex-1 flex items-center justify-center space-x-2 py-2 rounded-xl text-sm font-medium transition-all ${
                    manualMode === 'link' 
                      ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm' 
                      : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  }`}
                >
                  <LinkIcon className="w-4 h-4" />
                  <span>Paste Link</span>
                </button>
              </div>

              {manualMode === 'code' ? (
                <div className="space-y-4">
                  <div className="flex justify-center space-x-3">
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
                        className="w-14 h-16 text-center text-2xl font-bold bg-gray-50 dark:bg-gray-900/50 border-2 border-gray-200 dark:border-gray-700 rounded-2xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all text-gray-900 dark:text-white"
                      />
                    ))}
                  </div>
                  <button
                    onClick={handlePinSubmit}
                    disabled={pin.join('').length !== 4}
                    className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 dark:disabled:bg-blue-800 text-white font-bold rounded-xl transition-all shadow-lg shadow-blue-500/20"
                  >
                    Connect
                  </button>
                </div>
              ) : (
                <form onSubmit={handleManualSubmit} className="space-y-3">
                  <div className="relative flex items-center">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <LinkIcon className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      type="text"
                      id="link-input"
                      value={manualLink}
                      onChange={(e) => setManualLink(e.target.value)}
                      className="block w-full pl-12 pr-28 py-4 border-2 border-gray-100 dark:border-gray-700 rounded-2xl leading-5 bg-gray-50 dark:bg-gray-900/50 text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent sm:text-sm transition-all"
                      placeholder="Paste connection link"
                    />
                    <button
                      type="submit"
                      disabled={!manualLink.trim()}
                      className="absolute right-2 top-2 bottom-2 px-5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 dark:disabled:bg-blue-800 text-white text-sm font-bold rounded-xl transition-all shadow-lg shadow-blue-500/20"
                    >
                      Connect
                    </button>
                  </div>
                </form>
              )}
            </div>

            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              accept="image/*" 
              onChange={handleFileUpload}
            />
            <div id="reader-hidden" className="hidden"></div>
          </div>
        )}

        {status === 'connecting' && (
          <div className="text-center py-12">
            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <h2 className="text-xl font-medium text-gray-900 dark:text-white">Connecting to Peer...</h2>
            <p className="text-gray-500 dark:text-gray-400 mt-2">Establishing secure WebRTC connection</p>
          </div>
        )}

        {status === 'connected' && (
          <div className="py-4">
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
