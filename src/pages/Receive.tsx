import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PeerConnection } from '../webrtc/peer';
import { FileReceiver } from '../webrtc/fileReceiver';
import { FileQueue, FileQueueItem } from '../components/FileQueue';
import { Download, AlertCircle, Camera, Image as ImageIcon, Upload, Link as LinkIcon, RefreshCw } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import { toast } from 'react-hot-toast';

export function Receive() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  
  const [peerConnected, setPeerConnected] = useState(false);
  const [files, setFiles] = useState<FileQueueItem[]>([]);
  const [status, setStatus] = useState<'scanning' | 'connecting' | 'connected' | 'error'>('connecting');
  const [scanMethod, setScanMethod] = useState<'camera' | 'file'>('camera');
  const [cameraStarted, setCameraStarted] = useState(true);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [cameras, setCameras] = useState<any[]>([]);
  const [currentCameraIndex, setCurrentCameraIndex] = useState(0);
  const [manualLink, setManualLink] = useState('');
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const peerRef = useRef<PeerConnection | null>(null);
  const receiversRef = useRef<Map<number, FileReceiver>>(new Map());

  useEffect(() => {
    if (!roomId) {
      setStatus('scanning');
      return;
    }

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
      channel.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'metadata') {
              const receiver = new FileReceiver(data);
              
              receiver.onProgress = (p, s) => {
                setFiles(prev => prev.map(f => f.id === data.fileId ? { ...f, progress: p, speed: s } : f));
              };
              
              receiver.onComplete = (file) => {
                const url = URL.createObjectURL(file);
                setFiles(prev => prev.map(f => f.id === data.fileId ? { ...f, status: 'completed', progress: 100, speed: 0, url } : f));
                receiversRef.current.delete(data.fileId);
                
                toast.success(`File received: ${file.name}`);
                
                // Auto download
                const a = document.createElement('a');
                a.href = url;
                a.download = file.name;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
              };

              receiversRef.current.set(data.fileId, receiver);
              
              setFiles(prev => [...prev, {
                id: data.fileId,
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
              setFiles(prev => prev.map(f => f.id === data.fileId ? { ...f, status: 'cancelled' } : f));
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

    return () => {
      peer.close();
      // Cleanup URLs
      setFiles(prev => {
        prev.forEach(f => {
          if (f.url) URL.revokeObjectURL(f.url);
        });
        return prev;
      });
    };
  }, [roomId]);

  const handleScanSuccess = (text: string) => {
    try {
      const url = new URL(text);
      const parts = url.pathname.split('/');
      const id = parts[parts.length - 1];
      if (id) {
        toast.success('QR Code scanned successfully!');
        navigate(`/receive/${id}`);
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
      if (manualLink.includes('/')) {
        const url = new URL(manualLink.startsWith('http') ? manualLink : `https://${manualLink}`);
        const parts = url.pathname.split('/');
        id = parts[parts.length - 1];
      }
      
      if (id) {
        navigate(`/receive/${id}`);
      } else {
        toast.error('Invalid link format.');
      }
    } catch (err) {
      // If it's just a room ID
      navigate(`/receive/${manualLink.trim()}`);
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
    if (status === 'scanning' && scanMethod === 'camera') {
      setCameraStarted(true);
    }
  }, [status, scanMethod]);

  useEffect(() => {
    if (status === 'scanning' && scanMethod === 'camera' && cameraStarted) {
      const html5QrCode = new Html5Qrcode("reader");
      html5QrCodeRef.current = html5QrCode;
      
      const cameraConfig = cameras.length > 0 
        ? { deviceId: cameras[currentCameraIndex].id }
        : { facingMode: "environment" };

      html5QrCode.start(
        cameraConfig,
        { 
          fps: 10, 
          qrbox: (viewfinderWidth, viewfinderHeight) => {
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            const qrboxSize = Math.floor(minEdge * 0.7);
            return { width: qrboxSize, height: qrboxSize };
          }
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
        setPermissionDenied(false);
      }).catch(err => {
        console.error("Error starting camera", err);
        const errorMsg = err.toString().toLowerCase();
        if (errorMsg.includes("notallowederror") || errorMsg.includes("permission denied")) {
          setPermissionDenied(true);
          toast.error("Camera permission was denied. Please check and try again.");
        } else {
          toast.error("Could not access camera. Please check permissions.");
        }
        setCameraStarted(false);
      });

      return () => {
        if (html5QrCodeRef.current && html5QrCodeRef.current.isScanning) {
          html5QrCodeRef.current.stop().then(() => {
            html5QrCodeRef.current?.clear();
          }).catch(console.error);
        }
      };
    }
  }, [status, scanMethod, cameraStarted, currentCameraIndex, cameras, navigate]);

  const switchCamera = () => {
    if (cameras.length > 1) {
      setCurrentCameraIndex((prev) => (prev + 1) % cameras.length);
    }
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
                    {!cameraStarted && (
                      <div className="z-20 flex flex-col items-center justify-center space-y-6 p-8 text-center">
                        {permissionDenied ? (
                          <div className="space-y-4">
                            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto">
                              <Camera className="w-8 h-8 text-red-500" />
                            </div>
                            <div className="space-y-2">
                              <p className="text-white font-bold text-lg">Permission Blocked</p>
                              <p className="text-white/60 text-sm max-w-[240px] mx-auto">
                                Please check your camera permission and try again.
                              </p>
                            </div>
                            <button
                              onClick={() => window.location.reload()}
                              className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-base font-bold transition-all shadow-lg shadow-blue-500/30 flex items-center space-x-2 mx-auto"
                            >
                              <RefreshCw className="w-5 h-5" />
                              <span>Try Again</span>
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setCameraStarted(true)}
                            className="flex flex-col items-center justify-center space-y-4 group"
                          >
                            <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center shadow-lg shadow-blue-500/40 group-hover:scale-110 transition-transform">
                              <Camera className="w-8 h-8 text-white" />
                            </div>
                            <div className="text-center">
                              <p className="text-white font-bold text-lg">Enable Camera</p>
                              <p className="text-white/60 text-sm">Tap to start scanning</p>
                            </div>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  
                  {/* Scanner Overlay UI */}
                  {cameraStarted && (
                    <>
                      <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center">
                        <div className="w-64 h-64 border-2 border-blue-500 rounded-3xl opacity-50 animate-pulse"></div>
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
                  className="cursor-pointer mx-auto w-full overflow-hidden rounded-3xl border-4 border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 aspect-square flex flex-col items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-all shadow-xl"
                >
                  <Upload className="w-16 h-16 text-gray-400 mb-4" />
                  <p className="text-lg font-semibold text-gray-900 dark:text-white">Upload QR Code</p>
                  <p className="text-sm text-gray-500 mt-2">Tap to select an image</p>
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
                  <span>Uploade</span>
                </button>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center" aria-hidden="true">
                  <div className="w-full border-t border-gray-200 dark:border-gray-700"></div>
                </div>
                <div className="relative flex justify-center">
                  <span className="px-3 bg-white dark:bg-gray-800 text-sm font-medium text-gray-400 uppercase tracking-widest">Or enter manually</span>
                </div>
              </div>

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
                    placeholder="Paste link or Room ID"
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
              <FileQueue files={files} />
            )}
          </div>
        )}

        {status === 'error' && (
          <div className="text-center py-8">
            <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-medium text-red-900 dark:text-red-100 mb-2">Connection Lost</h2>
            <p className="text-red-700 dark:text-red-300 mb-6">The connection to the sender was lost.</p>
            <button
              onClick={() => window.location.reload()}
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
