import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuthContext } from '../../context/AuthContext';
import { useSocketContext } from '../../context/Socket';
import { Device } from 'mediasoup-client';

const Meeting = () => {
  const { meetingId } = useParams();
  const navigate = useNavigate();
  const { socket } = useSocketContext();
  const { authUser } = useAuthContext();
  
  // State management
  const [device, setDevice] = useState(null);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [peers, setPeers] = useState(new Map());
  const [isJoined, setIsJoined] = useState(false);
  const [isDeviceReady, setIsDeviceReady] = useState(false);
  const [pendingProducers, setPendingProducers] = useState([]);
  
  // Refs
  const localVideoRef = useRef(null);
  const producerTransport = useRef(null);
  const consumerTransport = useRef(null);
  const producers = useRef(new Map());
  const consumers = useRef(new Map());
  const localStream = useRef(null);
  const peerStreams = useRef(new Map());

  // Initialize MediaSoup device and join room
  useEffect(() => {
    if (!socket || !authUser) return;

    const initializeDevice = async () => {
      try {
        console.log('Joining room:', meetingId);
        
        // Join the room
        socket.emit('join-room', {
          roomId: meetingId,
          userId: authUser._id
        });

        // Handle router capabilities
        const handleRouterCapabilities = async ({ rtpCapabilities }) => {
          console.log('Received router RTP capabilities');
          
          try {
            // Create MediaSoup device
            const newDevice = new Device();
            await newDevice.load({ routerRtpCapabilities: rtpCapabilities });
            console.log('Device loaded successfully');
            setDevice(newDevice);
            
            // Get user media
            const stream = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: true
            });
            
            localStream.current = stream;
            if (localVideoRef.current) {
              localVideoRef.current.srcObject = stream;
            }
            
            // Create transports
            await createProducerTransport(newDevice);
            await createConsumerTransport(newDevice);
            
            // Mark device as ready
            setIsDeviceReady(true);
            setIsJoined(true);
            console.log('Device setup complete');
          } catch (error) {
            console.error('Error setting up device:', error);
          }
        };

        // Handle new producers from other peers - IMPROVED
        const handleNewProducer = ({ producerId, socketId, kind }) => {
          console.log(`New producer: ${producerId} from ${socketId} (${kind})`);
          
          if (isDeviceReady && device && consumerTransport.current) {
            // Device is ready, consume immediately
            consume(producerId, kind, socketId);
          } else {
            // Device not ready, queue the producer
            console.log('Device not ready, queueing producer');
            setPendingProducers(prev => [...prev, { producerId, socketId, kind }]);
          }
        };

        // Handle new peers
        const handleNewPeer = ({ socketId, userId }) => {
          console.log(`New peer joined: ${userId} (${socketId})`);
          setPeers(prev => {
            const newPeers = new Map(prev);
            newPeers.set(socketId, { 
              userId, 
              videoRef: React.createRef(),
              audioStream: null,
              videoStream: null
            });
            return newPeers;
          });
        };

        // Handle consumer resumed
        const handleConsumerResumed = ({ consumerId }) => {
          console.log(`Consumer resumed: ${consumerId}`);
          const consumerInfo = consumers.current.get(consumerId);
          if (consumerInfo) {
            const { consumer, socketId, kind } = consumerInfo;
            console.log(`Consumer ${consumerId} (${kind}) resumed for peer ${socketId}`);
            setPeers(prev => new Map(prev));
          }
        };

        // Handle peer disconnection
        const handlePeerDisconnected = ({ socketId }) => {
          console.log(`Peer disconnected: ${socketId}`);
          
          // Clean up streams
          const peerStream = peerStreams.current.get(socketId);
          if (peerStream) {
            peerStream.getTracks().forEach(track => track.stop());
            peerStreams.current.delete(socketId);
          }
          
          setPeers(prev => {
            const newPeers = new Map(prev);
            newPeers.delete(socketId);
            return newPeers;
          });
        };

        // Set up event listeners
        socket.on('router-rtp-capabilities', handleRouterCapabilities);
        socket.on('new-producer', handleNewProducer);
        socket.on('new-peer', handleNewPeer);
        socket.on('consumer-resumed', handleConsumerResumed);
        socket.on('peer-disconnected', handlePeerDisconnected);

      } catch (error) {
        console.error('Error initializing device:', error);
      }
    };

    initializeDevice();

    return () => {
      console.log('Cleaning up meeting component');
      
      // Remove event listeners
      socket.off('router-rtp-capabilities');
      socket.off('new-producer');
      socket.off('new-peer');
      socket.off('consumer-resumed');
      socket.off('peer-disconnected');
      
      // Clean up media
      if (localStream.current) {
        localStream.current.getTracks().forEach(track => track.stop());
      }
      
      // Clean up peer streams
      peerStreams.current.forEach(stream => {
        stream.getTracks().forEach(track => track.stop());
      });
      peerStreams.current.clear();
    };
  }, [socket, authUser, meetingId]);

  // Process pending producers when device becomes ready
  useEffect(() => {
    if (isDeviceReady && device && consumerTransport.current && pendingProducers.length > 0) {
      console.log(`Processing ${pendingProducers.length} pending producers`);
      
      const processPendingProducers = async () => {
        for (const { producerId, socketId, kind } of pendingProducers) {
          try {
            await consume(producerId, kind, socketId);
          } catch (error) {
            console.error('Error processing pending producer:', error);
          }
        }
        setPendingProducers([]); // Clear pending producers
      };
      
      processPendingProducers();
    }
  }, [isDeviceReady, device, consumerTransport.current, pendingProducers]);

  // Create producer transport
  const createProducerTransport = async (device) => {
    return new Promise((resolve, reject) => {
      console.log('Creating producer transport');
      
      socket.emit('create-webrtc-transport', {
        roomId: meetingId,
        direction: 'send'
      });

      const handleTransportCreated = async ({ transportId, iceParameters, iceCandidates, dtlsParameters }) => {
        try {
          console.log('Producer transport created:', transportId);
          
          const transport = device.createSendTransport({
            id: transportId,
            iceParameters,
            iceCandidates,
            dtlsParameters
          });

          transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
            try {
              console.log('Connecting producer transport');
              socket.emit('connect-transport', {
                roomId: meetingId,
                transportId,
                dtlsParameters
              });
              
              const handleConnected = () => {
                console.log('Producer transport connected');
                socket.off('transport-connected', handleConnected);
                callback();
              };
              
              socket.once('transport-connected', handleConnected);
            } catch (error) {
              console.error('Producer transport connect error:', error);
              errback(error);
            }
          });

          transport.on('produce', async ({ kind, rtpParameters, appData }, callback, errback) => {
            try {
              console.log('Producing:', kind);
              socket.emit('produce', {
                roomId: meetingId,
                transportId,
                kind,
                rtpParameters,
                appData
              });

              const handleProduced = ({ producerId }) => {
                console.log('Produced:', producerId);
                socket.off('produced', handleProduced);
                callback({ id: producerId });
              };
              
              socket.once('produced', handleProduced);
            } catch (error) {
              console.error('Produce error:', error);
              errback(error);
            }
          });

          producerTransport.current = transport;
          socket.off('webrtc-transport-created', handleTransportCreated);
          
          // Start producing
          await startProducing(transport);
          resolve(transport);
        } catch (error) {
          console.error('Producer transport setup error:', error);
          reject(error);
        }
      };

      socket.once('webrtc-transport-created', handleTransportCreated);
    });
  };

  // Create consumer transport
  const createConsumerTransport = async (device) => {
    return new Promise((resolve, reject) => {
      console.log('Creating consumer transport');
      
      socket.emit('create-webrtc-transport', {
        roomId: meetingId,
        direction: 'receive'
      });

      const handleTransportCreated = async ({ transportId, iceParameters, iceCandidates, dtlsParameters }) => {
        try {
          console.log('Consumer transport created:', transportId);
          
          const transport = device.createRecvTransport({
            id: transportId,
            iceParameters,
            iceCandidates,
            dtlsParameters
          });

          transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
            try {
              console.log('Connecting consumer transport');
              socket.emit('connect-transport', {
                roomId: meetingId,
                transportId,
                dtlsParameters
              });
              
              const handleConnected = () => {
                console.log('Consumer transport connected');
                socket.off('transport-connected', handleConnected);
                callback();
              };
              
              socket.once('transport-connected', handleConnected);
            } catch (error) {
              console.error('Consumer transport connect error:', error);
              errback(error);
            }
          });

          consumerTransport.current = transport;
          socket.off('webrtc-transport-created', handleTransportCreated);
          resolve(transport);
        } catch (error) {
          console.error('Consumer transport setup error:', error);
          reject(error);
        }
      };

      socket.once('webrtc-transport-created', handleTransportCreated);
    });
  };

  // Start producing media
  const startProducing = async (transport) => {
    if (!localStream.current) return;

    try {
      // Produce video
      const videoTrack = localStream.current.getVideoTracks()[0];
      if (videoTrack) {
        console.log('Starting video production');
        const videoProducer = await transport.produce({
          track: videoTrack,
          encodings: [
            { maxBitrate: 100000 },
            { maxBitrate: 300000 },
            { maxBitrate: 900000 }
          ],
          codecOptions: {
            videoGoogleStartBitrate: 1000
          }
        });
        producers.current.set('video', videoProducer);
        console.log('Video producer created:', videoProducer.id);
      }

      // Produce audio
      const audioTrack = localStream.current.getAudioTracks()[0];
      if (audioTrack) {
        console.log('Starting audio production');
        const audioProducer = await transport.produce({ track: audioTrack });
        producers.current.set('audio', audioProducer);
        console.log('Audio producer created:', audioProducer.id);
      }
    } catch (error) {
      console.error('Error starting production:', error);
    }
  };

  // Consume media from other peers - FIXED VERSION
  const consume = async (producerId, kind, socketId) => {
    // Comprehensive validation
    if (!device) {
      console.error('Device not ready');
      return;
    }

    if (!device.loaded) {
      console.error('Device not loaded');
      return;
    }

    if (!consumerTransport.current) {
      console.error('Consumer transport not ready');
      return;
    }

    console.log(`Consuming ${kind} from producer ${producerId} (peer: ${socketId})`);

    try {
      socket.emit('consume', {
        roomId: meetingId,
        transportId: consumerTransport.current.id,
        producerId,
        rtpCapabilities: device.rtpCapabilities
      });

      const handleConsumed = async ({ consumerId, rtpParameters }) => {
        try {
          console.log(`Creating consumer ${consumerId} for ${kind}`);
          
          const consumer = await consumerTransport.current.consume({
            id: consumerId,
            producerId,
            kind,
            rtpParameters
          });

          // Store consumer info
          consumers.current.set(consumerId, { consumer, socketId, kind });

          // Get the media track
          const track = consumer.track;
          console.log(`Received ${kind} track from ${socketId}`, track);

          // Get or create stream for this peer
          let peerStream = peerStreams.current.get(socketId);
          if (!peerStream) {
            peerStream = new MediaStream();
            peerStreams.current.set(socketId, peerStream);
            console.log(`Created new stream for peer ${socketId}`);
          }

          // Add track to peer stream
          peerStream.addTrack(track);
          console.log(`Added ${kind} track to peer ${socketId} stream. Stream has ${peerStream.getTracks().length} tracks`);

          // Update peer data
          setPeers(prev => {
            const newPeers = new Map(prev);
            const peer = newPeers.get(socketId);
            if (peer) {
              peer.videoStream = peerStream;
              peer.audioStream = peerStream;
              
              if (peer.videoRef && peer.videoRef.current && peerStream.getTracks().length > 0) {
                console.log(`Setting srcObject for peer ${socketId}`);
                peer.videoRef.current.srcObject = peerStream;
              }
              
              newPeers.set(socketId, { ...peer });
            }
            return newPeers;
          });

          // Resume consumer
          socket.emit('resume-consumer', {
            roomId: meetingId,
            consumerId
          });

          console.log(`Successfully set up consumer for ${kind} from ${socketId}`);
          socket.off('consumed', handleConsumed);
          
        } catch (error) {
          console.error('Error consuming media:', error);
          socket.off('consumed', handleConsumed);
        }
      };

      socket.once('consumed', handleConsumed);
      
    } catch (error) {
      console.error('Error in consume function:', error);
    }
  };

  // Update peer video elements when streams change
  useEffect(() => {
    console.log('Updating peer video elements, peers count:', peers.size);
    peers.forEach((peer, socketId) => {
      const peerStream = peerStreams.current.get(socketId);
      if (peerStream && peer.videoRef && peer.videoRef.current) {
        const tracks = peerStream.getTracks();
        console.log(`Setting stream for peer ${socketId}, stream has ${tracks.length} tracks:`, tracks.map(t => t.kind));
        
        if (tracks.length > 0) {
          peer.videoRef.current.srcObject = peerStream;
          
          peer.videoRef.current.onloadedmetadata = () => {
            console.log(`Video metadata loaded for peer ${socketId}`);
          };
          
          peer.videoRef.current.onplay = () => {
            console.log(`Video started playing for peer ${socketId}`);
          };
        }
      }
    });
  }, [peers]);

  // Toggle audio
  const toggleAudio = () => {
    const audioProducer = producers.current.get('audio');
    if (audioProducer) {
      if (isAudioEnabled) {
        audioProducer.pause();
      } else {
        audioProducer.resume();
      }
      setIsAudioEnabled(!isAudioEnabled);
    }
  };

  // Toggle video
  const toggleVideo = () => {
    const videoProducer = producers.current.get('video');
    if (videoProducer) {
      if (isVideoEnabled) {
        videoProducer.pause();
      } else {
        videoProducer.resume();
      }
      setIsVideoEnabled(!isVideoEnabled);
    }
  };

  // Leave meeting
  const leaveMeeting = () => {
    console.log('Leaving meeting');
    
    // Stop local stream
    if (localStream.current) {
      localStream.current.getTracks().forEach(track => track.stop());
    }

    // Close producers
    producers.current.forEach(producer => producer.close());

    // Close consumers
    consumers.current.forEach(({ consumer }) => consumer.close());

    // Close transports
    if (producerTransport.current) producerTransport.current.close();
    if (consumerTransport.current) consumerTransport.current.close();

    // Clean up peer streams
    peerStreams.current.forEach(stream => {
      stream.getTracks().forEach(track => track.stop());
    });

    navigate('/friends');
  };

  if (!authUser) {
    return <div className="text-white">Please log in to join the meeting</div>;
  }

  return (
    <div className="min-h-screen bg-gray-900 p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-white">
            Meeting: {meetingId}
          </h1>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">
              {isJoined ? 'Connected' : 'Connecting...'}
            </span>
            <div className={`w-3 h-3 rounded-full ${isJoined ? 'bg-green-500' : 'bg-yellow-500'}`}></div>
          </div>
        </div>

        {/* Video Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {/* Local Video */}
          <div className="relative bg-gray-800 rounded-lg overflow-hidden aspect-video">
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="w-full h-full object-cover"
            />
            <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-sm">
              You
            </div>
            {!isVideoEnabled && (
              <div className="absolute inset-0 bg-gray-700 flex items-center justify-center">
                <div className="w-16 h-16 bg-gray-600 rounded-full flex items-center justify-center">
                  <span className="text-white text-xl font-bold">
                    {authUser.username.charAt(0).toUpperCase()}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Peer Videos */}
          {Array.from(peers.entries()).map(([socketId, peer]) => {
            const peerStream = peerStreams.current.get(socketId);
            const streamTracks = peerStream ? peerStream.getTracks() : [];
            
            return (
              <div key={socketId} className="relative bg-gray-800 rounded-lg overflow-hidden aspect-video">
                <video
                  ref={peer.videoRef}
                  className="w-full h-full object-cover"
                  autoPlay
                  playsInline
                />
                <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-sm">
                  {peer.userId}
                </div>
                <div className="absolute top-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-xs">
                  {streamTracks.length > 0 
                    ? `Tracks: ${streamTracks.map(t => t.kind).join(', ')}` 
                    : 'No Stream'}
                </div>
              </div>
            );
          })}
        </div>

        {/* Enhanced Debug Info */}
        <div className="mb-4 p-4 bg-gray-800 rounded-lg">
          <h3 className="text-white font-bold mb-2">Debug Info:</h3>
          <div className="text-sm text-gray-300">
            <p>Device: {device ? (device.loaded ? 'Ready' : 'Loading...') : 'Not ready'}</p>
            <p>Device Ready: {isDeviceReady ? 'Yes' : 'No'}</p>
            <p>Joined: {isJoined ? 'Yes' : 'No'}</p>
            <p>Peers: {peers.size}</p>
            <p>Consumers: {consumers.current.size}</p>
            <p>Peer Streams: {peerStreams.current.size}</p>
            <p>Pending Producers: {pendingProducers.length}</p>
            <p>Producer Transport: {producerTransport.current ? 'Ready' : 'Not ready'}</p>
            <p>Consumer Transport: {consumerTransport.current ? 'Ready' : 'Not ready'}</p>
            
            {Array.from(peers.entries()).map(([socketId, peer]) => {
              const stream = peerStreams.current.get(socketId);
              return (
                <div key={socketId} className="mt-2 p-2 bg-gray-700 rounded">
                  <p className="font-semibold">Peer {peer.userId}:</p>
                  <p>Socket: {socketId}</p>
                  <p>Stream: {stream ? `${stream.getTracks().length} tracks` : 'None'}</p>
                  {stream && stream.getTracks().map((track, i) => (
                    <p key={i} className="ml-4">- {track.kind}: {track.readyState}</p>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        {/* Controls */}
        <div className="flex justify-center gap-4">
          <button
            onClick={toggleAudio}
            className={`p-4 rounded-full transition-colors ${
              isAudioEnabled 
                ? 'bg-gray-700 hover:bg-gray-600 text-white' 
                : 'bg-red-500 hover:bg-red-600 text-white'
            }`}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {isAudioEnabled ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-3a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              )}
            </svg>
          </button>

          <button
            onClick={toggleVideo}
            className={`p-4 rounded-full transition-colors ${
              isVideoEnabled 
                ? 'bg-gray-700 hover:bg-gray-600 text-white' 
                : 'bg-red-500 hover:bg-red-600 text-white'
            }`}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {isVideoEnabled ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636m12.728 12.728L18.364 5.636M5.636 18.364l12.728-12.728" />
              )}
            </svg>
          </button>

          <button
            onClick={leaveMeeting}
            className="p-4 rounded-full bg-red-500 hover:bg-red-600 text-white transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 21v-4a2 2 0 012-2h4l2-2h2a2 2 0 012 2v4a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default Meeting;