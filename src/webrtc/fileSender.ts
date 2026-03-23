export class FileSender {
  private channel: RTCDataChannel;
  private file: File;
  public fileId: number;
  private chunkSize = 64 * 1024; // 64KB
  private offset = 0;
  private fileReader = new FileReader();
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

  constructor(channel: RTCDataChannel, file: File, fileId: number) {
    this.channel = channel;
    this.file = file;
    this.fileId = fileId;

    this.fileReader.onerror = () => {
      if (!this.isCancelled) {
        this.onError?.(new Error("Error reading file"));
        this.cancel();
      }
    };

    this.fileReader.onload = (e) => {
      this.isReading = false;
      if (this.isCancelled) return;
      if (!e.target?.result) return;
      const buffer = e.target.result as ArrayBuffer;
      
      // Handle backpressure
      if (this.channel.bufferedAmount > this.channel.bufferedAmountLowThreshold) {
        this.isWaitingForBuffer = true;
        const listener = () => {
          this.channel.removeEventListener("bufferedamountlow", listener);
          this.isWaitingForBuffer = false;
          if (!this.isCancelled) this.sendBuffer(buffer);
        };
        this.channel.addEventListener("bufferedamountlow", listener);
      } else {
        this.sendBuffer(buffer);
      }
    };
  }

  public start() {
    this.channel.bufferedAmountLowThreshold = 128 * 1024; // 128KB
    
    // Send metadata first
    const metadata = {
      type: "metadata",
      fileId: this.fileId,
      name: this.file.name,
      size: this.file.size,
      fileType: this.file.type
    };
    
    this.channel.send(JSON.stringify(metadata));
    
    this.startTime = Date.now();
    this.lastReportTime = this.startTime;
    
    // Wait for receiver to acknowledge metadata before sending chunks
    setTimeout(() => {
      if (!this.isCancelled && !this.isPaused) this.readNextChunk();
    }, 100);
  }

  public pause() {
    this.isPaused = true;
    try {
      this.channel.send(JSON.stringify({ type: "pause", fileId: this.fileId }));
    } catch (e) {}
  }

  public resume() {
    this.isPaused = false;
    try {
      this.channel.send(JSON.stringify({ type: "resume", fileId: this.fileId }));
    } catch (e) {}
    
    if (!this.isReading && !this.isWaitingForBuffer) {
      this.readNextChunk();
    }
  }

  public cancel() {
    this.isCancelled = true;
    this.fileReader.abort();
    try {
      this.channel.send(JSON.stringify({ type: "cancel", fileId: this.fileId }));
    } catch (e) {}
  }

  private sendBuffer(buffer: ArrayBuffer) {
    if (this.isCancelled) return;
    try {
      const header = new ArrayBuffer(4);
      new DataView(header).setUint32(0, this.fileId);
      
      const combined = new Uint8Array(4 + buffer.byteLength);
      combined.set(new Uint8Array(header), 0);
      combined.set(new Uint8Array(buffer), 4);
      
      this.channel.send(combined.buffer);
      this.offset += buffer.byteLength;
      
      this.reportProgress();

      if (this.offset < this.file.size) {
        if (!this.isPaused) {
          this.readNextChunk();
        }
      } else {
        this.channel.send(JSON.stringify({ type: "complete", fileId: this.fileId }));
        this.onComplete?.();
      }
    } catch (err) {
      this.onError?.(err as Error);
    }
  }

  private readNextChunk() {
    if (this.isCancelled || this.isPaused) return;
    this.isReading = true;
    const slice = this.file.slice(this.offset, this.offset + this.chunkSize);
    this.fileReader.readAsArrayBuffer(slice);
  }

  private reportProgress() {
    const now = Date.now();
    if (now - this.lastReportTime > 500 || this.offset === this.file.size) {
      const progress = this.file.size === 0 ? 100 : (this.offset / this.file.size) * 100;
      
      const timeDiff = (now - this.lastReportTime) / 1000; // seconds
      const bytesDiff = this.offset - this.lastReportOffset;
      const speed = timeDiff > 0 ? bytesDiff / timeDiff : 0; // bytes per second
      
      this.onProgress?.(progress, speed);
      
      this.lastReportTime = now;
      this.lastReportOffset = this.offset;
    }
  }
}
