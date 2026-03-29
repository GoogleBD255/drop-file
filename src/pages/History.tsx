import React, { useEffect, useState } from 'react';
import { getHistoryRecords, deleteHistoryRecord, clearHistory, TransferHistoryRecord } from '../lib/db';
import { Download, Trash2, CheckCircle, XCircle, AlertCircle, File as FileIcon, History as HistoryIcon, ArrowUpRight, ArrowDownLeft, Search } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { getFileIconInfo } from '../lib/icons';
import { motion, AnimatePresence } from 'motion/react';

function formatSize(bytes: number) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).format(new Date(timestamp));
}

export function History() {
  const [records, setRecords] = useState<TransferHistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  useEffect(() => {
    loadRecords();
  }, []);

  const loadRecords = async () => {
    try {
      const data = await getHistoryRecords();
      setRecords(data);
    } catch (err) {
      console.error('Failed to load history', err);
      toast.error('Failed to load transfer history');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = (record: TransferHistoryRecord) => {
    if (!record.blob) {
      toast.error('File data is no longer available');
      return;
    }
    const url = URL.createObjectURL(record.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = record.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDelete = async (id: string) => {
    await deleteHistoryRecord(id);
    setRecords(prev => prev.filter(r => r.id !== id));
    toast.success('Record deleted');
  };

  const handleClearAll = async () => {
    await clearHistory();
    setRecords([]);
    setShowClearConfirm(false);
    toast.success('History cleared');
  };

  const filteredRecords = records.filter(record => 
    record.fileName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-6 flex justify-center items-center min-h-[50vh]">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-4xl mx-auto p-4 sm:p-6"
    >
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-12">
        <div>
          <div className="flex items-center space-x-4 mb-3">
            <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-2xl shadow-xl shadow-blue-500/10">
              <HistoryIcon className="w-8 h-8 text-blue-600 dark:text-blue-400" />
            </div>
            <h1 className="text-4xl font-black text-gray-900 dark:text-white tracking-tighter">Transfer History</h1>
          </div>
          <p className="text-gray-600 dark:text-gray-400 font-medium text-lg">Manage your sent and received files</p>
        </div>
        
        {records.length > 0 && (
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowClearConfirm(true)}
            className="px-6 py-3 text-sm font-black text-red-600 bg-red-50 hover:bg-red-100 dark:bg-red-900/10 dark:hover:bg-red-900/20 dark:text-red-400 rounded-2xl transition-all border border-red-100 dark:border-red-900/30 shadow-sm"
          >
            Clear All History
          </motion.button>
        )}
      </div>

      {records.length > 0 && (
        <div className="relative mb-10">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-14 pr-6 py-4.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-[1.5rem] focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all shadow-xl shadow-gray-200/20 dark:shadow-none font-medium"
          />
        </div>
      )}

      <AnimatePresence mode="popLayout">
        {filteredRecords.length === 0 ? (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center py-20 glass rounded-[2.5rem] border border-white/20 dark:border-gray-700/30 shadow-xl"
          >
            <div className="w-20 h-20 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-6">
              <FileIcon className="w-10 h-10 text-gray-400" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              {searchQuery ? 'No matching files' : 'No history yet'}
            </h2>
            <p className="text-gray-600 dark:text-gray-400 max-w-xs mx-auto">
              {searchQuery ? `We couldn't find any files matching "${searchQuery}"` : 'Files you send and receive will appear here for quick access.'}
            </p>
          </motion.div>
        ) : (
          <div className="space-y-4">
            {filteredRecords.map((record, index) => {
              const { icon: Icon, color, bg } = getFileIconInfo(record.fileName, record.fileType);
              const isReceived = record.direction === 'received';
              const isCompleted = record.status === 'completed';

              return (
                <motion.div 
                  key={record.id}
                  layout
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="group flex items-center p-4 sm:p-5 bg-white dark:bg-gray-800 rounded-3xl border border-gray-100 dark:border-gray-700 shadow-sm hover:shadow-xl hover:border-blue-100 dark:hover:border-blue-900/30 transition-all duration-300"
                >
                  <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center flex-shrink-0 mr-4 sm:mr-5 ${bg} shadow-inner`}>
                    <Icon className={`w-6 h-6 sm:w-7 sm:h-7 ${color}`} />
                  </div>
   
                  <div className="flex-1 min-w-0 mr-4">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-3 mb-1.5">
                      <h3 className="text-base font-bold text-gray-900 dark:text-white truncate max-w-[200px] sm:max-w-md" title={record.fileName}>
                        {record.fileName}
                      </h3>
                      <div className="flex items-center space-x-2 mt-1 sm:mt-0">
                        <span className={`inline-flex items-center space-x-1 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-lg ${
                          isReceived 
                            ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400 border border-green-100 dark:border-green-800/30'
                            : 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400 border border-blue-100 dark:border-blue-800/30'
                        }`}>
                          {isReceived ? <ArrowDownLeft className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />}
                          <span>{record.direction}</span>
                        </span>
                      </div>
                    </div>
                    
                    <div className="flex flex-wrap items-center text-xs text-gray-600 dark:text-gray-400 gap-x-3 gap-y-1 font-medium">
                      <span className="bg-gray-100 dark:bg-gray-700/50 px-2 py-0.5 rounded-md">{formatSize(record.fileSize)}</span>
                      <span className="hidden sm:inline text-gray-300 dark:text-gray-600">•</span>
                      <span>{formatDate(record.timestamp)}</span>
                      <span className="hidden sm:inline text-gray-300 dark:text-gray-600">•</span>
                      <span className="flex items-center space-x-1.5">
                        {record.status === 'completed' && <CheckCircle className="w-3.5 h-3.5 text-green-500" />}
                        {record.status === 'failed' && <AlertCircle className="w-3.5 h-3.5 text-red-500" />}
                        {record.status === 'cancelled' && <XCircle className="w-3.5 h-3.5 text-gray-400" />}
                        <span className={`capitalize ${
                          record.status === 'completed' ? 'text-green-600 dark:text-green-400' : 
                          record.status === 'failed' ? 'text-red-600 dark:text-red-400' : ''
                        }`}>{record.status}</span>
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    {isReceived && isCompleted && record.blob && (
                      <motion.button
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => handleDownload(record)}
                        className="p-3 text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 dark:hover:text-blue-400 rounded-2xl transition-all"
                        title="Download again"
                      >
                        <Download className="w-5 h-5" />
                      </motion.button>
                    )}
                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => handleDelete(record.id)}
                      className="p-3 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 dark:hover:text-red-400 rounded-2xl transition-all"
                      title="Delete record"
                    >
                      <Trash2 className="w-5 h-5" />
                    </motion.button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showClearConfirm && (
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
              <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
                <Trash2 className="w-8 h-8 text-red-600 dark:text-red-400" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900 dark:text-white text-center mb-4">Clear All History?</h3>
              <p className="text-gray-500 dark:text-gray-400 text-center mb-8 leading-relaxed">
                This will permanently delete all transfer records and saved files. This action cannot be undone.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => setShowClearConfirm(false)}
                  className="py-3.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 rounded-2xl text-sm font-bold hover:bg-gray-200 dark:hover:bg-gray-700 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleClearAll}
                  className="py-3.5 bg-red-600 text-white rounded-2xl text-sm font-bold hover:bg-red-700 transition-all shadow-xl shadow-red-500/20"
                >
                  Yes, Clear All
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
