import { encryptChunk, encryptText } from '../lib/crypto';

export class FileSender {
  private channel: RTCDataChannel;
  private file: File;
  public fileId: number;
  private encryptionKey?: string;
  private chunkSize = 64 * 1024; // 64KB - More robust for WebRTC data channels
  private offset = 0;
  private isCancelled = false;
  private isPaused = false;
  private isReading = false;
  private isWaitingForBuffer = false;
  
  public onProgress?: (progress: number, speed: number) => void;
  public onComplete?: () => void;
  public onError?: (error: Error) => void;

  private startTime = 0;
  private lastReportTime = 0;
  private lastReportOffset = 0;

  constructor(channel: RTCDataChannel, file: File, fileId: number, encryptionKey?: string) {
    this.channel = channel;
    this.file = file;
    this.fileId = fileId;
    this.encryptionKey = encryptionKey;
    console.log(`FileSender initialized for ${file.name} (${file.size} bytes), ID: ${fileId}`);
  }

  private async sendMessage(message: any) {
    if (this.encryptionKey) {
      const encrypted = await encryptText(JSON.stringify(message), this.encryptionKey);
      this.channel.send(JSON.stringify({ type: 'encrypted', payload: encrypted }));
    } else {
      this.channel.send(JSON.stringify(message));
    }
  }

  public async start() {
    this.channel.bufferedAmountLowThreshold = 1024 * 1024; // 1MB
    
    const metadata = {
      type: "metadata",
      fileId: this.fileId,
      name: this.file.name,
      size: this.file.size,
      fileType: this.file.type
    };
    
    await this.sendMessage(metadata);
    
    this.startTime = Date.now();
    this.lastReportTime = this.startTime;
    
    if (!this.isCancelled && !this.isPaused) {
      this.readNextChunk();
    }
  }

  public pause() {
    this.isPaused = true;
    this.sendMessage({ type: "pause", fileId: this.fileId }).catch(() => {});
  }

  public resume() {
    this.isPaused = false;
    this.sendMessage({ type: "resume", fileId: this.fileId }).catch(() => {});
    
    if (!this.isReading && !this.isWaitingForBuffer) {
      this.readNextChunk();
    }
  }

  public cancel() {
    this.isCancelled = true;
    this.sendMessage({ type: "cancel", fileId: this.fileId }).catch(() => {});
  }

  private async sendBuffer(buffer: ArrayBuffer) {
    if (this.isCancelled) return;
    
    // Wait for channel to be open if it's not
    if (this.channel.readyState !== 'open') {
      console.log("Channel not open, waiting for recovery...");
      try {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Timeout waiting for data channel")), 30000);
          const check = () => {
            if (this.channel.readyState === 'open') {
              clearTimeout(timeout);
              resolve(null);
            } else if (this.channel.readyState === 'closed' || this.channel.readyState === 'closing') {
              clearTimeout(timeout);
              reject(new Error("Data channel closed"));
            } else {
              setTimeout(check, 500);
            }
          };
          check();
        });
      } catch (e) {
        this.onError?.(e as Error);
        return;
      }
    }

    try {
      let dataToSend = buffer;
      if (this.encryptionKey) {
        dataToSend = await encryptChunk(buffer, this.encryptionKey);
      }

      const combined = new Uint8Array(4 + dataToSend.byteLength);
      const view = new DataView(combined.buffer);
      view.setUint32(0, this.fileId);
      combined.set(new Uint8Array(dataToSend), 4);
      
      this.channel.send(combined.buffer);
      this.offset += buffer.byteLength;
      
      this.reportProgress();

      if (this.offset < this.file.size) {
        if (!this.isPaused) {
          if (this.channel.bufferedAmount > this.channel.bufferedAmountLowThreshold) {
            this.isWaitingForBuffer = true;
            const listener = () => {
              this.channel.removeEventListener("bufferedamountlow", listener);
              this.isWaitingForBuffer = false;
              if (!this.isCancelled && !this.isPaused) this.readNextChunk();
            };
            this.channel.addEventListener("bufferedamountlow", listener);
          } else {
            this.readNextChunk();
          }
        }
      } else {
        await this.sendMessage({ type: "complete", fileId: this.fileId });
        this.onComplete?.();
      }
    } catch (err) {
      this.onError?.(err as Error);
    }
  }

  private async readNextChunk() {
    if (this.isCancelled || this.isPaused) return;
    this.isReading = true;
    try {
      const slice = this.file.slice(this.offset, this.offset + this.chunkSize);
      const buffer = await slice.arrayBuffer();
      this.isReading = false;
      if (!this.isCancelled) {
        this.sendBuffer(buffer);
      }
    } catch (err) {
      this.isReading = false;
      if (!this.isCancelled) {
        this.onError?.(err as Error);
        this.cancel();
      }
    }
  }

  private reportProgress() {
    const now = Date.now();
    if (now - this.lastReportTime > 500 || this.offset === this.file.size) {
      const progress = this.file.size === 0 ? 100 : (this.offset / this.file.size) * 100;
      
      const timeDiff = (now - this.lastReportTime) / 1000;
      const bytesDiff = this.offset - this.lastReportOffset;
      const speed = timeDiff > 0 ? bytesDiff / timeDiff : 0;
      
      this.onProgress?.(progress, speed);
      
      this.lastReportTime = now;
      this.lastReportOffset = this.offset;
    }
  }
}
