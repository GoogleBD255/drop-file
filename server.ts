import express from "express";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import path from "path";

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const PORT = 3000;

  // WebSocket Server for Signaling
  const wss = new WebSocketServer({ server });

  const rooms = new Map<string, Set<WebSocket>>();

  wss.on("connection", (ws) => {
    let currentRoom: string | null = null;

    ws.on("message", (message) => {
      try {
        const data = JSON.parse(message.toString());
        const { type, room, payload } = data;

        if (type === "join") {
          currentRoom = room;
          if (!rooms.has(room)) {
            rooms.set(room, new Set());
          }
          rooms.get(room)!.add(ws);
          
          // Notify others in the room
          rooms.get(room)!.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: "peer-joined" }));
            }
          });

          // Also notify the joining peer if they are not alone
          if (rooms.get(room)!.size > 1) {
            ws.send(JSON.stringify({ type: "peer-joined" }));
          }
        } else if (type === "signal") {
          // Broadcast signal to others in the room
          const targetRoom = room || currentRoom;
          if (targetRoom && rooms.has(targetRoom)) {
            rooms.get(targetRoom)!.forEach((client) => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: "signal", payload }));
              }
            });
          }
        }
      } catch (err) {
        console.error("WS message error", err);
      }
    });

    ws.on("close", () => {
      if (currentRoom && rooms.has(currentRoom)) {
        rooms.get(currentRoom)!.delete(ws);
        if (rooms.get(currentRoom)!.size === 0) {
          rooms.delete(currentRoom);
        } else {
          rooms.get(currentRoom)!.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: "peer-left" }));
            }
          });
        }
      }
    });
  });

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
