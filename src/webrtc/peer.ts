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

  private pingInterval?: number;
  private inactivityTimeout?: number;
  private readonly INACTIVITY_LIMIT = 5 * 60 * 1000; // 5 minutes

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
      ]
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
    };

    this.ws.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "peer-joined") {
        if (this.isInitiator) {
          this.createOffer();
        }
      } else if (data.type === "peer-left") {
        this.onPeerLeft?.();
      } else if (data.type === "signal") {
        await this.handleSignal(data.payload);
      }
    };
  }

  private setupPeerConnection() {
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal({ candidate: event.candidate });
      }
    };

    this.pc.onconnectionstatechange = () => {
      this.onConnectionStateChange?.(this.pc.connectionState);
      if (this.pc.connectionState === 'connected') {
        this.startPing();
      } else if (this.pc.connectionState === 'disconnected' || this.pc.connectionState === 'failed' || this.pc.connectionState === 'closed') {
        this.stopPing();
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
    if (this.inactivityTimeout) {
      window.clearTimeout(this.inactivityTimeout);
    }
    this.pc.close();
    this.ws.close();
  }
}
