import { decryptChunk } from '../lib/crypto';

export class FileReceiver {
  private receivedSize = 0;
  public metadata: any;
  private encryptionKey?: string;
  
  public onProgress?: (progress: number, speed: number) => void;
  public onComplete?: (file: File) => void;
  public onError?: (error: string) => void;

  private startTime = 0;
  private lastReportTime = 0;
  private lastReportSize = 0;

  private fileHandle?: FileSystemFileHandle;
  private writable?: any; // FileSystemWritableFileStream
  private fallbackBuffers: ArrayBuffer[] = [];
  private useOPFS = false;
  
  private writeQueue: ArrayBuffer[] = [];
  private isWriting = false;
  private isFinished = false;
  private isCancelled = false;
  private isInitializing = true;

  constructor(metadata: any, encryptionKey?: string) {
    this.metadata = metadata;
    this.encryptionKey = encryptionKey;
    this.startTime = Date.now();
    this.lastReportTime = this.startTime;
    console.log(`FileReceiver initialized for ${metadata.name} (${metadata.size} bytes), ID: ${metadata.fileId}`);
    this.initStorage();
  }

  private async initStorage() {
    try {
      if (!navigator.storage || !navigator.storage.getDirectory) {
        throw new Error("OPFS not supported in this browser");
      }
      const root = await navigator.storage.getDirectory();
      // Sanitize filename to avoid issues with special characters
      const safeName = this.metadata.name.replace(/[^a-z0-9._-]/gi, '_');
      this.fileHandle = await root.getFileHandle(`transfer_${Date.now()}_${safeName}`, { create: true });
      this.writable = await (this.fileHandle as any).createWritable();
      this.useOPFS = true;
      console.log("OPFS storage initialized successfully");
    } catch (e) {
      console.warn("OPFS not available, falling back to memory. Large files might fail.", e);
      this.useOPFS = false;
    } finally {
      this.isInitializing = false;
      // Process any chunks that arrived during initialization
      if (this.useOPFS) {
        this.processWriteQueue();
      } else {
        // Move everything from writeQueue to fallbackBuffers
        this.fallbackBuffers.push(...this.writeQueue);
        this.writeQueue = [];
        if (this.isFinished) {
          this.finalize();
        }
      }
    }
  }

  public async receiveChunk(chunk: ArrayBuffer) {
    if (this.isCancelled) return;
    
    let dataToProcess = chunk;
    if (this.encryptionKey) {
      try {
        dataToProcess = await decryptChunk(chunk, this.encryptionKey);
      } catch (e) {
        console.error("Decryption error", e);
        this.onError?.("Decryption failed. The encryption key might be incorrect.");
        this.cancel();
        return;
      }
    }

    this.receivedSize += dataToProcess.byteLength;
    this.reportProgress();

    if (this.isInitializing) {
      this.writeQueue.push(dataToProcess);
      return;
    }

    if (this.useOPFS) {
      this.writeQueue.push(dataToProcess);
      this.processWriteQueue();
    } else {
      this.fallbackBuffers.push(dataToProcess);
    }
  }

  public cancel() {
    this.isCancelled = true;
    this.writeQueue = [];
    this.fallbackBuffers = [];
    if (this.writable) {
      this.writable.close().catch(() => {});
    }
  }

  private async processWriteQueue() {
    if (this.isWriting || !this.writable || this.isInitializing || this.isCancelled) return;
    this.isWriting = true;
    
    while (this.writeQueue.length > 0 && !this.isCancelled) {
      const chunk = this.writeQueue.shift();
      if (chunk) {
        try {
          await this.writable.write(chunk);
        } catch (e) {
          console.error("Error writing to OPFS", e);
        }
      }
    }
    
    this.isWriting = false;
    
    if (this.isCancelled) return;

    if (this.isFinished && this.writeQueue.length === 0) {
      this.finalize();
    }
  }

  private reportProgress() {
    const now = Date.now();
    if (now - this.lastReportTime > 500 || this.receivedSize === this.metadata.size) {
      const progress = this.metadata.size === 0 ? 100 : (this.receivedSize / this.metadata.size) * 100;
      
      const timeDiff = (now - this.lastReportTime) / 1000;
      const bytesDiff = this.receivedSize - this.lastReportSize;
      const speed = timeDiff > 0 ? bytesDiff / timeDiff : 0;
      
      this.onProgress?.(progress, speed);
      
      this.lastReportTime = now;
      this.lastReportSize = this.receivedSize;
    }
  }

  public finish() {
    if (this.useOPFS) {
      this.isFinished = true;
      if (!this.isWriting && this.writeQueue.length === 0) {
        this.finalize();
      }
    } else {
      this.finalize();
    }
  }

  private async finalize() {
    if (this.useOPFS && this.writable && this.fileHandle) {
      await this.writable.close();
      const file = await this.fileHandle.getFile();
      const finalFile = new File([file], this.metadata.name, { type: this.metadata.fileType });
      this.onComplete?.(finalFile);
    } else {
      const blob = new Blob(this.fallbackBuffers, { type: this.metadata.fileType });
      const file = new File([blob], this.metadata.name, { type: this.metadata.fileType });
      this.fallbackBuffers = []; // Free memory
      this.onComplete?.(file);
    }
  }
}
