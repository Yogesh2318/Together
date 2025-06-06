import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cookieParser from "cookie-parser";
import authRoutes from "./routes/auth.routes.js";
import friendRoutes from "./routes/friend.routes.js";
import usersRoutes from "./routes/user.routes.js";
import connectToMongoDB from "./db/connectToMongoDB.js";
import { Server } from 'socket.io';
import http from 'http';
import mediasoup from 'mediasoup';

dotenv.config();

// Initialize Express app
const app = express();

// Create an HTTP server
const server = http.createServer(app);

// Initialize Socket.IO with CORS configuration
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

// Middleware setup
app.use(cookieParser());
app.use(express.json());

app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
  })
);

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/friend", friendRoutes);
app.use("/api/users", usersRoutes);

// MediaSoup Configuration
const mediaCodecs = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: {
      'x-google-start-bitrate': 1000,
    },
  },
];

// MediaSoup worker and router management
let worker;
const rooms = new Map(); // roomId -> { router, transports, producers, consumers }

// Initialize MediaSoup Worker
async function createWorker() {
  worker = await mediasoup.createWorker({
    rtcMinPort: 10000,
    rtcMaxPort: 10100,
  });

  console.log(`MediaSoup worker pid ${worker.pid}`);

  worker.on('died', error => {
    console.error('MediaSoup worker has died', error);
    setTimeout(() => process.exit(1), 2000);
  });

  return worker;
}

// Create router for a room
async function createRoom(roomId) {
  console.log(`Creating room: ${roomId}`);
  
  const router = await worker.createRouter({ mediaCodecs });
  
  const room = {
    router,
    transports: new Map(),
    producers: new Map(),
    consumers: new Map(),
    peers: new Map() // socketId -> peerInfo
  };
  
  rooms.set(roomId, room);
  return room;
}

// Socket.IO user tracking
const userSocketMap = {}; // {userId: socketId}

// Helper function to get receiver's socket ID
export const getReceiverSocketId = (receiverId) => {
  return userSocketMap[receiverId];
};

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);
  
  // Get userId from query parameters
  const userId = socket.handshake.query.userId;
  
  if (userId && userId !== "undefined") {
    userSocketMap[userId] = socket.id;
    console.log(`User ${userId} connected with socket ${socket.id}`);
  }
  
  // Emit online users to all connected clients
  io.emit("onlineUsers", Object.keys(userSocketMap));

  // ============ CALL MANAGEMENT ============
  
  // Listen for meeting creation requests from clients
  socket.on("meeting-request", ({ meetingId, participants }) => {
    console.log(`Meeting request: ${meetingId} with participants: ${participants}`);
    
    participants.forEach(participant => {
      // Don't send the call to the caller themselves
      if (participant !== userId) {
        const receiverSocketId = getReceiverSocketId(participant);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit("incoming-call", { meetingId, participants });
          console.log(`Sent incoming call to ${participant}`);
        }
      }
    });
  });

  socket.on("accept-meeting", async ({ meetingId, participants }) => {
    console.log(`Meeting accepted: ${meetingId} by user: ${userId}`);
    
    // Create MediaSoup room if it doesn't exist
    if (!rooms.has(meetingId)) {
      await createRoom(meetingId);
    }
    
    // Notify all participants that the meeting was accepted
    participants.forEach(participant => {
      const receiverSocketId = getReceiverSocketId(participant);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit("meeting-accepted", { 
          meetingId, 
          participants, 
          acceptedBy: userId 
        });
      }
    });
  });

  socket.on("reject-meeting", ({ meetingId, participants }) => {
    console.log(`Meeting rejected: ${meetingId} by user: ${userId}`);
    
    // Notify all participants that the meeting was rejected
    participants.forEach(participant => {
      const receiverSocketId = getReceiverSocketId(participant);
      if (receiverSocketId && participant !== userId) {
        io.to(receiverSocketId).emit("call-rejected", { meetingId, rejectedBy: userId });
      }
    });
  });

  // ============ MEDIASOUP ROOM MANAGEMENT ============

  socket.on('join-room', async ({ roomId, userId: roomUserId }) => {
    console.log(`User ${roomUserId} joining room ${roomId}`);
    
    // Get or create room
    let room = rooms.get(roomId);
    if (!room) {
      room = await createRoom(roomId);
    }

    // Add peer to room
    room.peers.set(socket.id, {
      userId: roomUserId,
      transports: new Map(),
      producers: new Map(),
      consumers: new Map()
    });

    socket.join(roomId);

    // Send router RTP capabilities to client
    socket.emit('router-rtp-capabilities', {
      rtpCapabilities: room.router.rtpCapabilities
    });

    // Notify other peers in the room
    socket.to(roomId).emit('new-peer', { 
      socketId: socket.id, 
      userId: roomUserId 
    });
  });

  socket.on('create-webrtc-transport', async ({ roomId, direction }) => {
    console.log(`Creating WebRTC transport for ${direction} in room ${roomId}`);
    
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    try {
      const transport = await room.router.createWebRtcTransport({
        listenIps: [
          {
            ip: '127.0.0.1',
            announcedIp: '127.0.0.1'
          }
        ],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      });

      // Store transport
      const peer = room.peers.get(socket.id);
      peer.transports.set(transport.id, transport);
      room.transports.set(transport.id, transport);

      socket.emit('webrtc-transport-created', {
        transportId: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      });

    } catch (error) {
      console.error('Error creating WebRTC transport:', error);
      socket.emit('error', { message: 'Failed to create transport' });
    }
  });

  socket.on('connect-transport', async ({ roomId, transportId, dtlsParameters }) => {
    const room = rooms.get(roomId);
    const transport = room?.transports.get(transportId);

    if (!transport) {
      socket.emit('error', { message: 'Transport not found' });
      return;
    }

    try {
      await transport.connect({ dtlsParameters });
      socket.emit('transport-connected', { transportId });
    } catch (error) {
      console.error('Error connecting transport:', error);
      socket.emit('error', { message: 'Failed to connect transport' });
    }
  });

  socket.on('produce', async ({ roomId, transportId, kind, rtpParameters, appData }) => {
    const room = rooms.get(roomId);
    const transport = room?.transports.get(transportId);

    if (!transport) {
      socket.emit('error', { message: 'Transport not found' });
      return;
    }

    try {
      const producer = await transport.produce({
        kind,
        rtpParameters,
        appData: { ...appData, socketId: socket.id }
      });

      // Store producer
      const peer = room.peers.get(socket.id);
      peer.producers.set(producer.id, producer);
      room.producers.set(producer.id, producer);

      socket.emit('produced', { 
        producerId: producer.id,
        kind: producer.kind 
      });

      // Notify other peers about new producer
      socket.to(roomId).emit('new-producer', {
        producerId: producer.id,
        socketId: socket.id,
        kind: producer.kind
      });

    } catch (error) {
      console.error('Error producing:', error);
      socket.emit('error', { message: 'Failed to produce' });
    }
  });

  socket.on('consume', async ({ roomId, transportId, producerId, rtpCapabilities }) => {
    const room = rooms.get(roomId);
    const transport = room?.transports.get(transportId);
    const producer = room?.producers.get(producerId);

    if (!transport || !producer) {
      socket.emit('error', { message: 'Transport or producer not found' });
      return;
    }

    try {
      const consumer = await transport.consume({
        producerId,
        rtpCapabilities,
        paused: true,
      });

      // Store consumer
      const peer = room.peers.get(socket.id);
      peer.consumers.set(consumer.id, consumer);
      room.consumers.set(consumer.id, consumer);

      socket.emit('consumed', {
        consumerId: consumer.id,
        producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
      });

    } catch (error) {
      console.error('Error consuming:', error);
      socket.emit('error', { message: 'Failed to consume' });
    }
  });

  socket.on('resume-consumer', async ({ roomId, consumerId }) => {
    const room = rooms.get(roomId);
    const consumer = room?.consumers.get(consumerId);

    if (consumer) {
      await consumer.resume();
      socket.emit('consumer-resumed', { consumerId });
    }
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log("A user disconnected:", socket.id);
    
    // Clean up MediaSoup resources
    rooms.forEach((room, roomId) => {
      const peer = room.peers.get(socket.id);
      if (peer) {
        // Close all transports
        peer.transports.forEach(transport => {
          transport.close();
          room.transports.delete(transport.id);
        });

        // Close all producers
        peer.producers.forEach(producer => {
          producer.close();
          room.producers.delete(producer.id);
        });

        // Close all consumers
        peer.consumers.forEach(consumer => {
          consumer.close();
          room.consumers.delete(consumer.id);
        });

        room.peers.delete(socket.id);

        // Notify other peers
        socket.to(roomId).emit('peer-disconnected', { socketId: socket.id });

        // If room is empty, clean it up
        if (room.peers.size === 0) {
          room.router.close();
          rooms.delete(roomId);
          console.log(`Room ${roomId} closed`);
        }
      }
    });
    
    // Remove user from tracking
    if (userId && userId !== "undefined") {
      delete userSocketMap[userId];
      console.log(`User ${userId} disconnected`);
    }
    
    // Emit updated online users to all connected clients
    io.emit("onlineUsers", Object.keys(userSocketMap));
  });
});

// Export io for use in other files
export { io };

// Start the server
const PORT = process.env.PORT || 5000;
server.listen(PORT, async () => {
  try {
    await connectToMongoDB();
    await createWorker();
    console.log(`✅ Server is running on port ${PORT}`);
    console.log(`✅ MediaSoup worker initialized`);
  } catch (error) {
    console.error("❌ Error starting server:", error);
  }
});