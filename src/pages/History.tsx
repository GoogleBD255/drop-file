import React, { useEffect, useState } from 'react';
import { getHistoryRecords, deleteHistoryRecord, clearHistory, TransferHistoryRecord } from '../lib/db';
import { Download, Trash2, CheckCircle, XCircle, AlertCircle, File as FileIcon } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { getFileIconInfo } from '../lib/icons';

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
    if (confirm('Are you sure you want to delete this record?')) {
      await deleteHistoryRecord(id);
      setRecords(prev => prev.filter(r => r.id !== id));
      toast.success('Record deleted');
    }
  };

  const handleClearAll = async () => {
    if (confirm('Are you sure you want to clear all history? This will delete all saved files.')) {
      await clearHistory();
      setRecords([]);
      toast.success('History cleared');
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-6 flex justify-center items-center min-h-[50vh]">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Transfer History</h1>
          <p className="text-gray-500 dark:text-gray-400">View and manage your sent and received files</p>
        </div>
        {records.length > 0 && (
          <button
            onClick={handleClearAll}
            className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40 dark:text-red-400 rounded-xl transition-colors"
          >
            Clear All
          </button>
        )}
      </div>

      {records.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-3xl border border-gray-100 dark:border-gray-700 shadow-sm">
          <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-4">
            <FileIcon className="w-8 h-8 text-gray-400" />
          </div>
          <h2 className="text-xl font-medium text-gray-900 dark:text-white mb-2">No history yet</h2>
          <p className="text-gray-500 dark:text-gray-400">Files you send and receive will appear here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {records.map(record => {
            const { icon: Icon, color, bg } = getFileIconInfo(record.fileName, record.fileType);
            const isReceived = record.direction === 'received';
            const isCompleted = record.status === 'completed';

            return (
              <div key={record.id} className="flex items-center p-3 sm:p-4 bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm hover:shadow-md transition-shadow">
                <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center flex-shrink-0 mr-3 sm:mr-4 ${bg}`}>
                  <Icon className={`w-5 h-5 sm:w-6 sm:h-6 ${color}`} />
                </div>
 
                <div className="flex-1 min-w-0 mr-2 sm:mr-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-2 mb-1">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate max-w-[150px] sm:max-w-none" title={record.fileName}>
                      {record.fileName}
                    </h3>
                    <span className={`inline-block w-fit px-2 py-0.5 text-[9px] sm:text-[10px] font-medium uppercase tracking-wider rounded-full mt-1 sm:mt-0 ${
                      isReceived 
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                    }`}>
                      {record.direction}
                    </span>
                  </div>
                  
                  <div className="flex flex-wrap items-center text-[10px] sm:text-xs text-gray-500 dark:text-gray-400 gap-x-2 sm:gap-x-3">
                    <span>{formatSize(record.fileSize)}</span>
                    <span className="hidden sm:inline">•</span>
                    <span>{formatDate(record.timestamp)}</span>
                    <span className="hidden sm:inline">•</span>
                    <span className="flex items-center space-x-1">
                      {record.status === 'completed' && <CheckCircle className="w-3 h-3 text-green-500" />}
                      {record.status === 'failed' && <AlertCircle className="w-3 h-3 text-red-500" />}
                      {record.status === 'cancelled' && <XCircle className="w-3 h-3 text-gray-400" />}
                      <span className="capitalize">{record.status}</span>
                    </span>
                  </div>
                </div>

                <div className="flex items-center space-x-2 flex-shrink-0">
                  {isReceived && isCompleted && record.blob && (
                    <button
                      onClick={() => handleDownload(record)}
                      className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 dark:hover:text-blue-400 rounded-xl transition-colors"
                      title="Download again"
                    >
                      <Download className="w-5 h-5" />
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(record.id)}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 dark:hover:text-red-400 rounded-xl transition-colors"
                    title="Delete record"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
