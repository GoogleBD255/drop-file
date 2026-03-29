/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { Send } from './pages/Send';
import { Receive } from './pages/Receive';
import { History } from './pages/History';
import { Send as SendIcon, Download, Smartphone, Zap, RefreshCw, Clock, Lock, ArrowLeft } from 'lucide-react';

import { motion, AnimatePresence } from 'motion/react';


function Home() {
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  useEffect(() => {
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIosDevice = /iphone|ipad|ipod/.test(userAgent);
    const isStandaloneMode = ('standalone' in window.navigator && (window.navigator as any).standalone) || window.matchMedia('(display-mode: standalone)').matches;
    
    setIsIOS(isIosDevice);
    setIsStandalone(isStandaloneMode);
  }, []);

  const handleReset = () => {
    localStorage.clear();
    sessionStorage.clear();
    window.location.href = window.location.origin;
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-12 sm:px-6 lg:px-8 text-center sm:pt-32">
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="inline-flex items-center space-x-2 bg-blue-50/50 dark:bg-blue-900/10 text-blue-600 dark:text-blue-400 px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.2em] mb-10 border border-blue-100/50 dark:border-blue-800/30 shadow-xl shadow-blue-500/5">
          <Zap className="w-3 h-3 fill-current" />
          <span>v2.0 is now live</span>
        </div>
        
        <h1 className="text-5xl sm:text-8xl font-black text-gray-900 dark:text-white mb-8 tracking-tighter leading-none">
          Share files <br />
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400">instantly.</span>
        </h1>
        
        <p className="text-lg sm:text-xl text-gray-600 dark:text-gray-400 mb-12 max-w-2xl mx-auto leading-relaxed font-medium">
          Fast Share uses peer-to-peer technology to transfer files directly between devices. No servers, no limits, just pure speed.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-6 mb-20">
          <Link to="/send" className="w-full sm:w-auto">
            <motion.button
              whileHover={{ scale: 1.05, y: -5 }}
              whileTap={{ scale: 0.95 }}
              className="w-full sm:w-auto px-10 py-5 bg-blue-600 hover:bg-blue-700 text-white rounded-[2rem] text-lg font-black transition-all shadow-2xl shadow-blue-500/40 flex items-center justify-center space-x-3"
            >
              <SendIcon className="w-6 h-6" />
              <span>Send Files</span>
            </motion.button>
          </Link>
          <Link to="/receive" className="w-full sm:w-auto">
            <motion.button
              whileHover={{ scale: 1.05, y: -5 }}
              whileTap={{ scale: 0.95 }}
              className="w-full sm:w-auto px-10 py-5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-[2rem] text-lg font-black transition-all shadow-xl hover:shadow-2xl border border-gray-100 dark:border-gray-700 flex items-center justify-center space-x-3"
            >
              <Download className="w-6 h-6" />
              <span>Receive Files</span>
            </motion.button>
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 max-w-4xl mx-auto">
          {[
            { icon: Lock, title: "Private", desc: "End-to-end encrypted transfers" },
            { icon: Zap, title: "Fast", desc: "Direct peer-to-peer connection" },
            { icon: Smartphone, title: "Simple", desc: "No account or setup required" }
          ].map((feature, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 + (i * 0.1) }}
              className="p-8 glass rounded-[2.5rem] text-center group hover:scale-105 transition-transform"
            >
              <div className="w-14 h-14 bg-blue-50 dark:bg-blue-900/20 rounded-2xl flex items-center justify-center mx-auto mb-6 group-hover:rotate-12 transition-transform">
                <feature.icon className="w-7 h-7 text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className="text-lg font-black text-gray-900 dark:text-white mb-2 tracking-tight">{feature.title}</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 font-medium leading-relaxed">{feature.desc}</p>
            </motion.div>
          ))}
        </div>
      </motion.div>
      
      {isIOS && !isStandalone && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2 }}
          className="mt-20 max-w-lg mx-auto glass border border-blue-200 dark:border-blue-800 rounded-[2.5rem] p-8 text-sm text-blue-800 dark:text-blue-300 flex items-start space-x-4 text-left shadow-xl shadow-blue-500/5"
        >
          <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/40 rounded-2xl flex items-center justify-center flex-shrink-0">
            <Smartphone className="w-6 h-6" />
          </div>
          <div>
            <p className="font-bold text-base mb-1">Install on iOS</p>
            <p className="opacity-80 leading-relaxed font-medium">Tap the <strong>Share</strong> button in Safari and select <strong>"Add to Home Screen"</strong> for the best experience.</p>
          </div>
        </motion.div>
      )}

      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 }}
        className="mt-32 pt-12 border-t border-gray-100 dark:border-gray-800"
      >
        <button 
          onClick={() => setShowResetConfirm(true)}
          className="px-8 py-4 text-xs font-black text-gray-400 hover:text-gray-900 dark:hover:text-white transition-all flex items-center space-x-2 mx-auto bg-gray-100/50 dark:bg-gray-800/50 rounded-2xl hover:bg-gray-200 dark:hover:bg-gray-700 uppercase tracking-widest"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Reset Application Settings</span>
        </button>
      </motion.div>

      <AnimatePresence>
        {showResetConfirm && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-gray-900 p-8 rounded-[2.5rem] w-full max-w-md shadow-2xl border border-gray-100 dark:border-gray-800"
            >
              <div className="w-16 h-16 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
                <RefreshCw className="w-8 h-8 text-amber-600 dark:text-amber-400" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900 dark:text-white text-center mb-4">Reset Application?</h3>
              <p className="text-gray-600 dark:text-gray-400 text-center mb-8 leading-relaxed">
                This will clear all local storage, history, and settings. The page will reload. Continue?
              </p>
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => setShowResetConfirm(false)}
                  className="py-3.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 rounded-2xl text-sm font-bold hover:bg-gray-200 dark:hover:bg-gray-700 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReset}
                  className="py-3.5 bg-amber-600 text-white rounded-2xl text-sm font-bold hover:bg-amber-700 transition-all shadow-xl shadow-amber-500/20"
                >
                  Yes, Reset
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Navbar({ showInstallBtn, handleInstallClick }: { showInstallBtn: boolean, handleInstallClick: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const isHome = location.pathname === '/';

  return (
    <nav className="glass sticky top-0 z-40 w-full border-b border-gray-200/50 dark:border-gray-800/50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-20 items-center">
          <div className="flex items-center space-x-4">
            <AnimatePresence mode="wait">
              {!isHome && (
                <motion.button
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  onClick={() => navigate(-1)}
                  className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white rounded-2xl hover:bg-gray-100/50 dark:hover:bg-gray-800/50 transition-all shadow-sm"
                  aria-label="Go back"
                >
                  <ArrowLeft className="w-8 h-5" />
                </motion.button>
              )}
            </AnimatePresence>

            <Link to="/" className="flex items-center space-x-3 group">
              <div className="p-2 bg-blue-600 rounded-2xl group-hover:scale-110 transition-transform shadow-lg shadow-blue-500/20">
                <Zap className="w-6 h-6 text-white" />
              </div>
              <span className="font-black text-xl tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-400">Fast Share</span>
            </Link>
          </div>

          <div className="flex items-center space-x-2 sm:space-x-4">
            <Link to="/history" className="flex items-center space-x-2 px-3 py-2.5 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-all rounded-2xl hover:bg-gray-100/50 dark:hover:bg-gray-800/50 font-bold text-sm">
              <Clock className="w-5 h-5" />
              <span className="hidden sm:inline">History</span>
            </Link>
            
            {showInstallBtn && (
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleInstallClick}
                className="flex items-center space-x-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-sm font-bold transition-all shadow-xl shadow-blue-500/20"
              >
                <Smartphone className="w-4 h-4" />
                <span>Install</span>
              </motion.button>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}

export default function App() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallBtn, setShowInstallBtn] = useState(false);

  useEffect(() => {
    // Force dark mode
    document.documentElement.classList.add('dark');
    
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallBtn(true);
    });

    window.addEventListener('appinstalled', () => {
      setShowInstallBtn(false);
      setDeferredPrompt(null);
    });
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setShowInstallBtn(false);
  };

  return (
    <Router>
      <Toaster 
        position="bottom-center" 
        toastOptions={{ 
          duration: 4000,
          style: {
            background: '#1f2937',
            color: '#fff',
            borderRadius: '1rem',
            padding: '1rem 1.5rem',
            fontSize: '0.875rem',
            fontWeight: '600',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          }
        }} 
      />
      <div className="min-h-screen bg-transparent font-sans text-gray-900 dark:text-gray-100 selection:bg-blue-200 dark:selection:bg-blue-900">
        <Navbar showInstallBtn={showInstallBtn} handleInstallClick={handleInstallClick} />

        <main className="pb-20">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/send" element={<Send />} />
            <Route path="/receive" element={<Receive />} />
            <Route path="/receive/:roomId" element={<Receive />} />
            <Route path="/history" element={<History />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}
