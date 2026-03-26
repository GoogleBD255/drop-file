/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { Send } from './pages/Send';
import { Receive } from './pages/Receive';
import { History } from './pages/History';
import { Send as SendIcon, Download, Smartphone, Zap, RefreshCw, Clock, Lock } from 'lucide-react';

function Home() {
  return (
    <div className="max-w-4xl mx-auto p-6 text-center pt-20">
      <h1 className="text-5xl font-bold text-gray-900 dark:text-white tracking-tight mb-6">
        Fast <span className="text-blue-600">Share</span>
      </h1>
      <p className="text-xl text-gray-500 dark:text-gray-400 mb-6 max-w-2xl mx-auto">
        Lightning-fast, secure, peer-to-peer file transfer directly in your browser. No limits, no servers, no hassle.
      </p>
      <div className="flex justify-center mb-12">
        <div className="inline-flex items-center space-x-1.5 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 px-4 py-1.5 rounded-full text-sm font-medium border border-green-200 dark:border-green-800/30">
          <Lock className="w-4 h-4" />
          <span>100% End-to-End Encrypted</span>
        </div>
      </div>
      
      <div className="grid sm:grid-cols-2 gap-6 max-w-2xl mx-auto">
        <Link 
          to="/send" 
          className="group flex flex-col items-center p-8 bg-white dark:bg-gray-800 rounded-3xl shadow-sm border border-gray-100 dark:border-gray-700 hover:shadow-md hover:border-blue-200 dark:hover:border-blue-800 transition-all"
        >
          <div className="w-16 h-16 bg-blue-50 dark:bg-blue-900/30 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
            <SendIcon className="w-8 h-8 text-blue-600 dark:text-blue-400" />
          </div>
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-2">Send Files</h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Generate a 4-digit code and send files to another device</p>
        </Link>

        <Link 
          to="/receive" 
          className="group flex flex-col items-center p-8 bg-white dark:bg-gray-800 rounded-3xl shadow-sm border border-gray-100 dark:border-gray-700 hover:shadow-md hover:border-green-200 dark:hover:border-green-800 transition-all"
        >
          <div className="w-16 h-16 bg-green-50 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
            <Download className="w-8 h-8 text-green-600 dark:text-green-400" />
          </div>
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-2">Receive Files</h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Enter a 4-digit code to receive files from another device</p>
        </Link>
      </div>
      <div className="mt-16 pt-8 border-t border-gray-100 dark:border-gray-800">
        <button 
          onClick={() => {
            if (confirm('This will reset all app settings and reload the page. Continue?')) {
              localStorage.clear();
              sessionStorage.clear();
              window.location.href = window.location.origin;
            }
          }}
          className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors flex items-center space-x-2 mx-auto"
        >
          <RefreshCw className="w-3 h-3" />
          <span>Reset Application</span>
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallBtn, setShowInstallBtn] = useState(false);

  useEffect(() => {
    window.addEventListener('beforeinstallprompt', (e) => {
      // Prevent Chrome 67 and earlier from automatically showing the prompt
      e.preventDefault();
      // Stash the event so it can be triggered later.
      setDeferredPrompt(e);
      setShowInstallBtn(true);
    });

    window.addEventListener('appinstalled', () => {
      setShowInstallBtn(false);
      setDeferredPrompt(null);
      console.log('PWA was installed');
    });
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    // Show the install prompt
    deferredPrompt.prompt();
    // Wait for the user to respond to the prompt
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`User response to the install prompt: ${outcome}`);
    // We've used the prompt, and can't use it again, throw it away
    setDeferredPrompt(null);
    setShowInstallBtn(false);
  };

  return (
    <Router>
      <Toaster position="bottom-center" toastOptions={{ duration: 4000 }} />
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 font-sans text-gray-900 dark:text-gray-100 selection:bg-blue-200 dark:selection:bg-blue-900">
        <nav className="border-b border-gray-200 dark:border-gray-800 bg-white/50 dark:bg-gray-900/50 backdrop-blur-md sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between h-16 items-center">
              <Link to="/" className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                  <Zap className="w-5 h-5 text-white fill-current" />
                </div>
                <span className="font-bold text-xl tracking-tight">Fast Share</span>
              </Link>

              <div className="flex items-center space-x-4">
                <Link to="/history" className="flex items-center space-x-2 px-3 py-2 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
                  <Clock className="w-5 h-5" />
                  <span className="hidden sm:inline font-medium text-sm">History</span>
                </Link>
                
                {showInstallBtn && (
                  <button
                    onClick={handleInstallClick}
                    className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition-all shadow-lg shadow-blue-500/20"
                  >
                    <Smartphone className="w-4 h-4" />
                    <span>Install App</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </nav>

        <main>
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
