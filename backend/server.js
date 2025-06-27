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
    peers: new Map(), // socketId -> peerInfo
    screenSharerId: null // Track who is currently screen sharing
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

  // Add peer to room FIRST
  room.peers.set(socket.id, {
    userId: roomUserId,
    transports: new Map(),
    producers: new Map(),
    consumers: new Map()
  });

  // Join socket room
  socket.join(roomId);

  // Send router RTP capabilities to client
  socket.emit('router-rtp-capabilities', {
    rtpCapabilities: room.router.rtpCapabilities
  });

  // IMPORTANT: Wait a bit before sending room state to ensure everything is set up
  setTimeout(() => {
    // Send complete room state to the new user
    const existingPeers = Array.from(room.peers.entries())
      .filter(([socketId]) => socketId !== socket.id) // Exclude the joining user
      .map(([socketId, peer]) => ({
        socketId,
        userId: peer.userId
      }));

    const existingProducers = Array.from(room.producers.values())
      .filter(producer => producer.appData.socketId !== socket.id) // Exclude own producers
      .map(producer => ({
        producerId: producer.id,
        socketId: producer.appData.socketId,
        kind: producer.kind
      }));

    console.log(`Sending room state to ${socket.id}: ${existingPeers.length} peers, ${existingProducers.length} producers`);
    
    socket.emit('room-state', {
      peers: existingPeers,
      producers: existingProducers
    });

    // Notify existing peers about new user (AFTER sending room state)
    socket.to(roomId).emit('new-peer', {
      socketId: socket.id,
      userId: roomUserId
    });

    console.log(`User ${roomUserId} successfully joined room ${roomId}`);
  }, 500); // Small delay to ensure everything is ready
});

// The 'join-room' handler now properly manages peer announcements

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
    if (!peer) {
      socket.emit('error', { message: 'Peer not found in room' });
      return;
    }

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
    console.log(`Transport ${transportId} connected for ${socket.id}`);
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

    console.log(`Producer ${producer.id} (${kind}) created for ${socket.id}`);

    socket.emit('produced', { 
      producerId: producer.id,
      kind: producer.kind 
    });

    // Notify other peers about new producer with a small delay
    // This ensures the producer is fully set up before others try to consume
    setTimeout(() => {
      socket.to(roomId).emit('new-producer', {
        producerId: producer.id,
        socketId: socket.id,
        kind: producer.kind
      });
      console.log(`Notified peers about new producer ${producer.id} from ${socket.id}`);
    }, 100);

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
    console.error(`Consume failed - Transport: ${!!transport}, Producer: ${!!producer}`);
    socket.emit('error', { message: 'Transport or producer not found' });
    return;
  }

  // Don't allow consuming own producers
  if (producer.appData.socketId === socket.id) {
    console.log('Preventing self-consumption');
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

    console.log(`Consumer ${consumer.id} created for producer ${producerId} by ${socket.id}`);

    socket.emit('consumed', {
      consumerId: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      appData: producer.appData
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
    console.log(`Consumer ${consumerId} resumed for ${socket.id}`);
    socket.emit('consumer-resumed', { consumerId });
  }
});

// Screen share handlers
socket.on('start-screen-share', ({ roomId }) => {
  console.log(`Screen share started by ${socket.id} in room ${roomId}`);
  
  const room = rooms.get(roomId);
  if (!room) {
    return socket.emit('screen-share-denied', { reason: 'Room not found' });
  }

  const peer = room.peers.get(socket.id);
  if (!peer) {
    return socket.emit('screen-share-denied', { reason: 'You are not properly in the room' });
  }

  const sharerUserId = peer.userId;

  // Check if someone else is already sharing
  if (room.screenSharerId && room.screenSharerId !== sharerUserId) {
    return socket.emit('screen-share-denied', { reason: 'Someone else is already sharing their screen' });
  }

  // Set this user as the screen sharer
  room.screenSharerId = sharerUserId;
  console.log(`Screen sharer set to ${sharerUserId} in room ${roomId}`);

  // Notify all peers in the room (including sender)
  io.in(roomId).emit('screen-share-started', { sharerId: sharerUserId });
  console.log(`Screen share started notification sent to room ${roomId}`);
});

socket.on('stop-screen-share', ({ roomId }) => {
  console.log(`Screen share stopped by ${socket.id} in room ${roomId}`);
  
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  const peer = room.peers.get(socket.id);
  if (!peer) {
    return;
  }
  const sharerUserId = peer.userId;

  // Clear screen sharer if it was this user
  if (room.screenSharerId === sharerUserId) {
    room.screenSharerId = null;
    console.log(`Screen sharer cleared in room ${roomId}`);
  }

  // Notify all peers in the room (including sender)
  io.in(roomId).emit('screen-share-stopped', { sharerId: sharerUserId });
  console.log(`Screen share stopped notification sent to room ${roomId}`);
});

// Add explicit leave-room handler
socket.on('leave-room', ({ roomId }) => {
  console.log(`User ${socket.id} leaving room ${roomId}`);
  
  const room = rooms.get(roomId);
  if (room) {
    // Clean up peer resources (same as disconnect logic)
    cleanupPeerFromRoom(socket.id, room, roomId);
  }
  
  socket.leave(roomId);
});

// Helper function to clean up peer from room
function cleanupPeerFromRoom(socketId, room, roomId) {
  const peer = room.peers.get(socketId);
  if (peer) {
    console.log(`Cleaning up peer ${socketId} from room ${roomId}`);
    
    const wasSharing = room.screenSharerId === peer.userId;
    
    // Close all transports
    peer.transports.forEach(transport => {
      transport.close();
      room.transports.delete(transport.id);
    });

    // Close all producers and notify other peers
    peer.producers.forEach(producer => {
      producer.close();
      room.producers.delete(producer.id);
      
      // Check if this was a screen share producer
      if (producer.appData.mediaTag === 'screen-share') {
        // Notify other peers that screen share stopped
        socket.to(roomId).emit('screen-share-stopped', { sharerId: socketId });
        console.log(`Screen share stopped notification sent for ${socketId}`);
      }
      
      // Notify other peers that this producer is gone
      socket.to(roomId).emit('producer-closed', { 
        producerId: producer.id, 
        socketId: socketId 
      });
    });

    // Close all consumers
    peer.consumers.forEach(consumer => {
      consumer.close();
      room.consumers.delete(consumer.id);
    });

    room.peers.delete(socketId);

    // Clear screen sharer if this user was sharing
    if (wasSharing) {
      room.screenSharerId = null;
      console.log(`Screen sharer cleared due to disconnect in room ${roomId}`);
      // Notify remaining peers that screen share has stopped
      socket.to(roomId).emit('screen-share-stopped', { sharerId: peer.userId });
    }

    // Notify other peers about disconnection
    socket.to(roomId).emit('peer-disconnected', { socketId });

    console.log(`Peer ${socketId} cleaned up from room ${roomId}. Remaining peers: ${room.peers.size}`);

    // If room is empty, clean it up
    if (room.peers.size === 0) {
      room.router.close();
      rooms.delete(roomId);
      console.log(`Room ${roomId} closed - no peers remaining`);
    }
  }
}

// Handle disconnection - use the helper function
socket.on("disconnect", () => {
  console.log("A user disconnected:", socket.id);
  
  // Clean up MediaSoup resources from all rooms
  rooms.forEach((room, roomId) => {
    if (room.peers.has(socket.id)) {
      cleanupPeerFromRoom(socket.id, room, roomId);
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