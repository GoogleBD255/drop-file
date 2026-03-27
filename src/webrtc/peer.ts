import { getSocketUrl } from "./socket";

export class PeerConnection {
  private pc: RTCPeerConnection;
  private ws: WebSocket;
  private roomId: string;
  private isInitiator: boolean;
  private iceCandidateQueue: RTCIceCandidate[] = [];
  
  public dataChannel?: RTCDataChannel;
  public onDataChannel?: (channel: RTCDataChannel) => void;
  public onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
  public onPeerLeft?: () => void;
  public sendMessage?: (message: any) => Promise<void>;
  public onDisconnect?: () => void;
  public onError?: (message: string) => void;

  private pingInterval?: number;
  private wsPingInterval?: number;
  private inactivityTimeout?: number;
  private readonly INACTIVITY_LIMIT = 10 * 60 * 1000; // 10 minutes

  constructor(roomId: string, isInitiator: boolean) {
    this.roomId = roomId;
    this.isInitiator = isInitiator;
    
    this.ws = new WebSocket(getSocketUrl());
    
    this.pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
        { urls: "stun:stun4.l.google.com:19302" },
        { urls: "stun:stun.services.mozilla.com" },
        { urls: "stun:stun.cloudflare.com:3478" },
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun.voipstunt.com" },
        { urls: "stun:iphone-stun.strato-iphone.de:3478" },
        {
          urls: "turn:openrelay.metered.ca:80",
          username: "openrelayproject",
          credential: "openrelayproject"
        },
        {
          urls: "turn:openrelay.metered.ca:443",
          username: "openrelayproject",
          credential: "openrelayproject"
        },
        {
          urls: "turn:openrelay.metered.ca:443?transport=tcp",
          username: "openrelayproject",
          credential: "openrelayproject"
        }
      ],
      iceCandidatePoolSize: 10,
      bundlePolicy: "max-bundle"
    });

    this.setupWebSocket();
    this.setupPeerConnection();
    this.resetInactivityTimeout();
  }

  public resetActivity() {
    this.resetInactivityTimeout();
  }

  private resetInactivityTimeout() {
    if (this.inactivityTimeout) {
      window.clearTimeout(this.inactivityTimeout);
    }
    this.inactivityTimeout = window.setTimeout(() => {
      console.log("Disconnecting due to inactivity");
      this.onDisconnect?.();
      this.close();
    }, this.INACTIVITY_LIMIT);
  }

  private setupWebSocket() {
    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({ type: "join", room: this.roomId }));
      
      // Keep signaling WebSocket alive
      this.wsPingInterval = window.setInterval(() => {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: "ws-ping" }));
        }
      }, 30000);
    };

    this.ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "error") {
          this.onError?.(data.message);
          this.onConnectionStateChange?.('failed');
          return;
        }
        if (data.type === "peer-joined") {
          if (this.isInitiator) {
            // Small delay to ensure both sides are ready
            setTimeout(() => this.createOffer(), 500);
          }
        } else if (data.type === "peer-left") {
          this.onPeerLeft?.();
        } else if (data.type === "signal") {
          await this.handleSignal(data.payload);
        }
      } catch (e) {
        console.error("Signaling message error", e);
      }
    };

    this.ws.onerror = (err) => {
      console.error("Signaling WebSocket error", err);
    };

    this.ws.onclose = () => {
      if (this.wsPingInterval) window.clearInterval(this.wsPingInterval);
    };
  }

  private setupPeerConnection() {
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal({ candidate: event.candidate });
      }
    };

    this.pc.onicegatheringstatechange = () => {
      console.log("ICE Gathering State:", this.pc.iceGatheringState);
    };

    this.pc.oniceconnectionstatechange = () => {
      console.log("ICE Connection State:", this.pc.iceConnectionState);
      if (this.pc.iceConnectionState === 'failed') {
        this.pc.restartIce();
      }
    };

    this.pc.onconnectionstatechange = () => {
      console.log("Connection State:", this.pc.connectionState);
      const state = this.pc.connectionState;
      
      if (state === 'connected') {
        this.startPing();
        this.onConnectionStateChange?.(state);
      } else if (state === 'disconnected') {
        console.log("Connection disconnected, waiting for potential recovery...");
        this.onConnectionStateChange?.(state);
      } else if (state === 'failed') {
        console.log("Connection failed, attempting ICE restart...");
        try {
          this.pc.restartIce();
        } catch (e) {
          console.error("Failed to restart ICE", e);
        }
        this.onConnectionStateChange?.(state);
      } else if (state === 'closed') {
        this.stopPing();
        this.onConnectionStateChange?.(state);
      }
    };

    if (this.isInitiator) {
      this.dataChannel = this.pc.createDataChannel("fileTransfer", {
        ordered: true
      });
      this.setupDataChannel(this.dataChannel);
    } else {
      this.pc.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this.setupDataChannel(this.dataChannel);
        this.onDataChannel?.(this.dataChannel);
      };
    }
  }

  private setupDataChannel(channel: RTCDataChannel) {
    channel.binaryType = "arraybuffer";
    
    // We need to intercept messages to reset activity, but we can't easily override onmessage here
    // without breaking the sender/receiver logic. So we'll rely on the UI components to call resetActivity()
    // However, we can add a listener that doesn't overwrite the main one.
    channel.addEventListener('message', () => {
      this.resetActivity();
    });
  }

  private startPing() {
    this.stopPing();
    this.pingInterval = window.setInterval(() => {
      if (this.dataChannel?.readyState === 'open') {
        // Send a ping message. The receiver will ignore it if it doesn't match their expected format,
        // but it keeps the connection alive.
        try {
          this.dataChannel.send(JSON.stringify({ type: 'ping' }));
        } catch (e) {
          console.error("Failed to send ping", e);
        }
      }
    }, 10000); // Send ping every 10 seconds
  }

  private stopPing() {
    if (this.pingInterval) {
      window.clearInterval(this.pingInterval);
      this.pingInterval = undefined;
    }
  }

  private async createOffer() {
    try {
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      this.sendSignal({ sdp: this.pc.localDescription });
    } catch (err) {
      console.error("Error creating offer", err);
    }
  }

  private async handleSignal(signal: any) {
    try {
      if (signal.sdp) {
        await this.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        if (signal.sdp.type === "offer") {
          const answer = await this.pc.createAnswer();
          await this.pc.setLocalDescription(answer);
          this.sendSignal({ sdp: this.pc.localDescription });
        }
        
        // Process queued candidates
        while (this.iceCandidateQueue.length > 0) {
          const candidate = this.iceCandidateQueue.shift();
          if (candidate) {
            await this.pc.addIceCandidate(candidate);
          }
        }
      } else if (signal.candidate) {
        const candidate = new RTCIceCandidate(signal.candidate);
        if (this.pc.remoteDescription) {
          await this.pc.addIceCandidate(candidate);
        } else {
          this.iceCandidateQueue.push(candidate);
        }
      }
    } catch (err) {
      console.error("Error handling signal", err);
    }
  }

  private sendSignal(payload: any) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: "signal",
        room: this.roomId,
        payload
      }));
    }
  }

  public close() {
    this.stopPing();
    if (this.wsPingInterval) window.clearInterval(this.wsPingInterval);
    if (this.inactivityTimeout) {
      window.clearTimeout(this.inactivityTimeout);
    }
    this.pc.close();
    this.ws.close();
  }
}
