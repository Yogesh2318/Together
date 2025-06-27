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
  const [screenShare, setScreenShare] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isScreenSharingActive, setIsScreenSharingActive] = useState(false);
  const [screenSharerId, setScreenSharerId] = useState(null);
  const [screenShareStream, setScreenShareStream] = useState(null);
  const [screenShareProducer, setScreenShareProducer] = useState(null);
  const [peerScreenShares, setPeerScreenShares] = useState(new Map());
  const [screenShareDenied, setScreenShareDenied] = useState(null);
  
  // Refs
  const localVideoRef = useRef(null);
  const screenShareVideoRef = useRef(null);
  const producerTransport = useRef(null);
  const consumerTransport = useRef(null);
  const producers = useRef(new Map());
  const consumers = useRef(new Map());
  const localStream = useRef(null);
  const peerStreams = useRef(new Map());
  const peerScreenShareStreams = useRef(new Map());
  const setupComplete = useRef(false);
  const initializationInProgress = useRef(false);

  // Initialize MediaSoup device and join room
  useEffect(() => {
    if (!socket || !authUser || setupComplete.current || initializationInProgress.current) return;

    const initializeDevice = async () => {
      try {
        initializationInProgress.current = true;
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
            
            // Get user media first
            const stream = await navigator.mediaDevices.getUserMedia({
              video: { width: 640, height: 480 },
              audio: true
            });
            
            localStream.current = stream;
            if (localVideoRef.current) {
              localVideoRef.current.srcObject = stream;
            }
            
            // Create transports in sequence
            await createProducerTransport(newDevice);
            await createConsumerTransport(newDevice);
            
            // Set device and mark as ready
            setDevice(newDevice);
            setIsDeviceReady(true);
            setIsInitialized(true);
            
            // Small delay to ensure everything is set up
            setTimeout(() => {
              setIsJoined(true);
              console.log('Device setup complete, ready to handle peers');
              
              // Request existing producers in the room
              socket.emit('get-producers', { roomId: meetingId });
            }, 500);
            
          } catch (error) {
            console.error('Error setting up device:', error);
            initializationInProgress.current = false;
          }
        };

        // Handle room state
        const handleRoomState = ({ peers: existingPeers, producers: existingProducers }) => {
          console.log('Received room state:', { existingPeers, existingProducers });
          
          // Set up peers first
          const newPeers = new Map();
          existingPeers.forEach(({ socketId, userId }) => {
            newPeers.set(socketId, {
              userId,
              videoRef: React.createRef(),
              audioStream: null,
              videoStream: null
            });
          });
          setPeers(newPeers);

          // Then handle existing producers
          if (isDeviceReady && device && consumerTransport.current) {
            existingProducers.forEach(({ producerId, socketId, kind }) => {
              if (socketId !== socket.id) {
                consume(producerId, kind, socketId);
              }
            });
          } else {
            setPendingProducers(existingProducers);
          }
        };

        // Set up event listeners
        socket.on('router-rtp-capabilities', handleRouterCapabilities);
        socket.on('room-state', handleRoomState);
        socket.on('new-producer', handleNewProducer);
        socket.on('new-peer', handleNewPeer);
        socket.on('consumer-resumed', handleConsumerResumed);
        socket.on('peer-disconnected', handlePeerDisconnected);
        socket.on('producer-closed', handleProducerClosed);
        // Screen sharing events
        socket.on('screen-share-started', ({ sharerId }) => {
          setIsScreenSharingActive(true);
          setScreenSharerId(sharerId);
        });
        socket.on('screen-share-stopped', ({ sharerId }) => {
          setIsScreenSharingActive(false);
          setScreenSharerId(null);
          // If we were sharing, stop our screen share
          if (sharerId === socket.id && screenShare) {
            stopScreenShare();
          }
        });
        socket.on('screen-share-denied', ({ reason }) => {
          setScreenShareDenied(reason || 'Screen sharing is not available right now.');
          setTimeout(() => setScreenShareDenied(null), 5000); // Clear after 5 seconds
        });

        setupComplete.current = true;
      } catch (error) {
        console.error('Error initializing device:', error);
        initializationInProgress.current = false;
      }
    };

    initializeDevice();

    return () => {
      console.log('Cleaning up meeting component');
      setupComplete.current = false;
      initializationInProgress.current = false;
      
      // Remove event listeners
      socket.off('router-rtp-capabilities');
      socket.off('room-state');
      socket.off('new-producer');
      socket.off('new-peer');
      socket.off('consumer-resumed');
      socket.off('peer-disconnected');
      socket.off('producer-closed');
      socket.off('screen-share-started');
      socket.off('screen-share-stopped');
      socket.off('screen-share-denied');
      
      // Clean up media
      if (localStream.current) {
        localStream.current.getTracks().forEach(track => track.stop());
      }
      
      // Clean up screen share stream
      if (screenShareStream) {
        screenShareStream.getTracks().forEach(track => track.stop());
      }
      
      // Clean up peer streams
      peerStreams.current.forEach(stream => {
        stream.getTracks().forEach(track => track.stop());
      });
      peerStreams.current.clear();
      
      // Clean up peer screen share streams
      peerScreenShareStreams.current.forEach(stream => {
        stream.getTracks().forEach(track => track.stop());
      });
      peerScreenShareStreams.current.clear();
    };
  }, [socket, authUser, meetingId]);

  // Handle new producers from other peers
  const handleNewProducer = ({ producerId, socketId, kind }) => {
    console.log(`New producer: ${producerId} from ${socketId} (${kind})`);
    
    // Don't consume our own producers
    if (socketId === socket.id) {
      console.log('Ignoring own producer');
      return;
    }
    
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
    
    // Don't add ourselves as a peer
    if (socketId === socket.id) return;
    
    setPeers(prev => {
      const newPeers = new Map(prev);
      if (!newPeers.has(socketId)) {
        newPeers.set(socketId, {
          userId,
          videoRef: React.createRef(),
          audioStream: null,
          videoStream: null
        });
      }
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
      
      // Force re-render to update video elements
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
    
    // Clean up screen share streams
    const peerScreenShareStream = peerScreenShareStreams.current.get(socketId);
    if (peerScreenShareStream) {
      peerScreenShareStream.getTracks().forEach(track => track.stop());
      peerScreenShareStreams.current.delete(socketId);
    }
    
    // Remove consumers for this peer
    const consumersToRemove = [];
    consumers.current.forEach((consumerInfo, consumerId) => {
      if (consumerInfo.socketId === socketId) {
        consumerInfo.consumer.close();
        consumersToRemove.push(consumerId);
      }
    });
    consumersToRemove.forEach(consumerId => consumers.current.delete(consumerId));
    
    setPeers(prev => {
      const newPeers = new Map(prev);
      newPeers.delete(socketId);
      return newPeers;
    });
    
    // Remove from peer screen shares
    setPeerScreenShares(prev => {
      const newScreenShares = new Map(prev);
      newScreenShares.delete(socketId);
      return newScreenShares;
    });
  };

  // Handle producer closed
  const handleProducerClosed = ({ producerId, socketId }) => {
    console.log(`Producer closed: ${producerId} from ${socketId}`);
    
    // Remove consumers for this producer
    const consumersToRemove = [];
    consumers.current.forEach((consumerInfo, consumerId) => {
      if (consumerInfo.socketId === socketId) {
        consumerInfo.consumer.close();
        consumersToRemove.push(consumerId);
      }
    });
    consumersToRemove.forEach(consumerId => consumers.current.delete(consumerId));
    
    // Clean up peer streams for this socket
    const peerStream = peerStreams.current.get(socketId);
    if (peerStream) {
      peerStream.getTracks().forEach(track => track.stop());
      peerStreams.current.delete(socketId);
    }
    
    // Update peers to reflect the change
    setPeers(prev => {
      const newPeers = new Map(prev);
      const peer = newPeers.get(socketId);
      if (peer) {
        peer.videoStream = null;
        peer.audioStream = null;
        newPeers.set(socketId, { ...peer });
      }
      return newPeers;
    });
  };

  // Process pending producers when device becomes ready
  useEffect(() => {
    if (isDeviceReady && device && consumerTransport.current && pendingProducers.length > 0) {
      console.log(`Processing ${pendingProducers.length} pending producers`);
      
      const processPendingProducers = async () => {
        const producersToProcess = [...pendingProducers];
        setPendingProducers([]); // Clear pending producers immediately to prevent race conditions
        
        for (const { producerId, socketId, kind } of producersToProcess) {
          try {
            await consume(producerId, kind, socketId);
            // Add small delay between consumptions to prevent overwhelming the system
            await new Promise(resolve => setTimeout(resolve, 100));
          } catch (error) {
            console.error('Error processing pending producer:', error);
          }
        }
      };
      
      processPendingProducers();
    }
  }, [isDeviceReady, device, consumerTransport.current, pendingProducers]);

  // Create producer transport
  const createProducerTransport = async (device) => {
    return new Promise((resolve, reject) => {
      console.log('Creating producer transport');
      
      const transportPromise = new Promise((transportResolve, transportReject) => {
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
            transportResolve(transport);
          } catch (error) {
            console.error('Producer transport setup error:', error);
            transportReject(error);
          }
        };

        socket.once('webrtc-transport-created', handleTransportCreated);
      });

      socket.emit('create-webrtc-transport', {
        roomId: meetingId,
        direction: 'send'
      });

      transportPromise
        .then(async (transport) => {
          // Start producing immediately after transport is ready
          await startProducing(transport);
          resolve(transport);
        })
        .catch(reject);
    });
  };

  // Create consumer transport
  const createConsumerTransport = async (device) => {
    return new Promise((resolve, reject) => {
      console.log('Creating consumer transport');
      
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
      
      socket.emit('create-webrtc-transport', {
        roomId: meetingId,
        direction: 'receive'
      });
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

  // Consume media from other peers - ENHANCED VERSION
  const consume = async (producerId, kind, socketId) => {
    // Comprehensive validation
    if (!device || !device.loaded) {
      console.error('Device not ready for consumption');
      return;
    }

    if (!consumerTransport.current) {
      console.error('Consumer transport not ready');
      return;
    }

    // Don't consume our own producers
    if (socketId === socket.id) {
      console.log('Skipping own producer');
      return;
    }

    console.log(`Consuming ${kind} from producer ${producerId} (peer: ${socketId})`);

    try {
      // Create consumer promise to handle the async response
      const consumePromise = new Promise((resolve, reject) => {
        const handleConsumed = async ({ consumerId, rtpParameters, appData }) => {
          try {
            console.log(`Creating consumer ${consumerId} for ${kind}`);
            
            const consumer = await consumerTransport.current.consume({
              id: consumerId,
              producerId,
              kind,
              rtpParameters
            });

            // Store consumer info
            consumers.current.set(consumerId, { consumer, socketId, kind, appData });
            console.log(`Consumer created: ${consumerId}`);

            // Get the media track
            const track = consumer.track;
            console.log(`Received ${kind} track from ${socketId}`, track);

            // Check if this is a screen share stream
            const isScreenShare = appData && appData.mediaTag === 'screen-share';
            const isScreenShareAudio = appData && appData.mediaTag === 'screen-share-audio';

            if (isScreenShare || isScreenShareAudio) {
              // Handle screen share streams
              let screenShareStream = peerScreenShareStreams.current.get(socketId);
              if (!screenShareStream) {
                screenShareStream = new MediaStream();
                peerScreenShareStreams.current.set(socketId, screenShareStream);
                console.log(`Created new screen share stream for peer ${socketId}`);
              }

              screenShareStream.addTrack(track);
              console.log(`Added ${kind} track to screen share stream for peer ${socketId}`);

              // Update peer screen shares state
              setPeerScreenShares(prev => {
                const newScreenShares = new Map(prev);
                newScreenShares.set(socketId, screenShareStream);
                return newScreenShares;
              });
            } else {
              // Handle regular webcam streams
              // Ensure peer exists
              setPeers(prev => {
                const newPeers = new Map(prev);
                if (!newPeers.has(socketId)) {
                  newPeers.set(socketId, { 
                    userId: socketId, // fallback if userId not available
                    videoRef: React.createRef(),
                    audioStream: null,
                    videoStream: null
                  });
                }
                return newPeers;
              });

              // Get or create stream for this peer
              let peerStream = peerStreams.current.get(socketId);
              if (!peerStream) {
                peerStream = new MediaStream();
                peerStreams.current.set(socketId, peerStream);
                console.log(`Created new stream for peer ${socketId}`);
              }

              // Add track to peer stream
              peerStream.addTrack(track);
              console.log(`Added ${kind} track to peer ${socketId} stream. Total tracks: ${peerStream.getTracks().length}`);

              // Update peer data and force re-render
              setPeers(prev => {
                const newPeers = new Map(prev);
                const peer = newPeers.get(socketId);
                if (peer) {
                  peer.videoStream = peerStream;
                  peer.audioStream = peerStream;
                  newPeers.set(socketId, { ...peer });
                }
                return newPeers;
              });
            }

            // Resume consumer
            socket.emit('resume-consumer', {
              roomId: meetingId,
              consumerId
            });

            console.log(`Successfully set up consumer for ${kind} from ${socketId}`);
            socket.off('consumed', handleConsumed);
            resolve();
            
          } catch (error) {
            console.error('Error consuming media:', error);
            socket.off('consumed', handleConsumed);
            reject(error);
          }
        };

        socket.once('consumed', handleConsumed);
        
        // Set up timeout for consume request
        setTimeout(() => {
          socket.off('consumed', handleConsumed);
          reject(new Error('Consume request timeout'));
        }, 10000);
      });

      socket.emit('consume', {
        roomId: meetingId,
        transportId: consumerTransport.current.id,
        producerId,
        rtpCapabilities: device.rtpCapabilities
      });

      await consumePromise;
      
    } catch (error) {
      console.error('Error in consume function:', error);
    }
  };

  // Update peer video elements when streams change - ENHANCED
  useEffect(() => {
    console.log('Updating peer video elements, peers count:', peers.size);
    
    const updateVideoElements = () => {
      peers.forEach((peer, socketId) => {
        const peerStream = peerStreams.current.get(socketId);
        if (peerStream && peer.videoRef && peer.videoRef.current) {
          const tracks = peerStream.getTracks();
          console.log(`Setting stream for peer ${socketId}, stream has ${tracks.length} tracks:`, tracks.map(t => t.kind));
          
          if (tracks.length > 0) {
            // Only set if different stream
            if (peer.videoRef.current.srcObject !== peerStream) {
              peer.videoRef.current.srcObject = peerStream;
              
              // Add event listeners for debugging
              peer.videoRef.current.onloadedmetadata = () => {
                console.log(`Video metadata loaded for peer ${socketId}`);
              };
              
              peer.videoRef.current.onplay = () => {
                console.log(`Video started playing for peer ${socketId}`);
              };

              peer.videoRef.current.onerror = (e) => {
                console.error(`Video error for peer ${socketId}:`, e);
              };

              // Attempt to play
              peer.videoRef.current.play().catch(e => {
                console.error(`Error playing video for peer ${socketId}:`, e);
              });
            }
          }
        }
      });
    };

    // Update immediately and after a short delay
    updateVideoElements();
    const timeoutId = setTimeout(updateVideoElements, 500);
    
    return () => clearTimeout(timeoutId);
  }, [peers, peerStreams.current, device]);

  // Additional effect to ensure video streams are always visible during screen sharing
  useEffect(() => {
    const ensureVideoStreamsVisible = () => {
      peers.forEach((peer, socketId) => {
        const peerStream = peerStreams.current.get(socketId);
        if (peerStream && peer.videoRef && peer.videoRef.current) {
          const videoElement = peer.videoRef.current;
          const tracks = peerStream.getTracks();
          
          console.log(`Checking video stream for peer ${socketId}:`, {
            hasStream: !!peerStream,
            trackCount: tracks.length,
            trackTypes: tracks.map(t => t.kind),
            videoElementExists: !!videoElement,
            currentSrcObject: !!videoElement.srcObject,
            isPaused: videoElement.paused
          });
          
          // Ensure video element has the stream
          if (tracks.length > 0 && videoElement.srcObject !== peerStream) {
            console.log(`Re-assigning stream to peer ${socketId} video element`);
            videoElement.srcObject = peerStream;
            videoElement.play().catch(e => {
              console.error(`Error playing video for peer ${socketId}:`, e);
            });
          }
          
          // Ensure video is playing
          if (videoElement.paused && tracks.length > 0) {
            console.log(`Resuming video for peer ${socketId}`);
            videoElement.play().catch(e => {
              console.error(`Error resuming video for peer ${socketId}:`, e);
            });
          }
        }
      });
    };

    // Run this effect when screen sharing state changes
    if (isScreenSharingActive) {
      // Small delay to ensure DOM is updated
      const timeoutId = setTimeout(ensureVideoStreamsVisible, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [isScreenSharingActive, peers, peerStreams.current]);

  // Enhanced effect to maintain video streams during screen sharing
  useEffect(() => {
    const maintainVideoStreams = () => {
      console.log('Maintaining video streams during screen sharing...');
      
      peers.forEach((peer, socketId) => {
        const peerStream = peerStreams.current.get(socketId);
        if (peerStream && peer.videoRef && peer.videoRef.current) {
          const videoElement = peer.videoRef.current;
          const tracks = peerStream.getTracks();
          
          // Force stream assignment if needed
          if (tracks.length > 0) {
            if (videoElement.srcObject !== peerStream) {
              console.log(`Force assigning stream to peer ${socketId}`);
              videoElement.srcObject = peerStream;
            }
            
            // Ensure video is playing
            if (videoElement.paused) {
              console.log(`Force playing video for peer ${socketId}`);
              videoElement.play().catch(e => {
                console.error(`Error force playing video for peer ${socketId}:`, e);
              });
            }
          }
        }
      });
    };

    // Run this effect periodically when screen sharing is active
    let intervalId;
    if (isScreenSharingActive) {
      intervalId = setInterval(maintainVideoStreams, 2000); // Check every 2 seconds
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [isScreenSharingActive, peers, peerStreams.current]);

  // Update screen share video when stream is available
  useEffect(() => {
    if (screenShareStream && screenShareVideoRef.current) {
      screenShareVideoRef.current.srcObject = screenShareStream;
      screenShareVideoRef.current.play().catch(e => {
        console.error('Error playing screen share video:', e);
      });
    }
  }, [screenShareStream]);

  // Toggle audio
  const toggleAudio = () => {
    const audioProducer = producers.current.get('audio');
    if (audioProducer) {
      if (isAudioEnabled) {
        audioProducer.pause();
        console.log('Audio paused');
      } else {
        audioProducer.resume();
        console.log('Audio resumed');
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
        console.log('Video paused');
      } else {
        videoProducer.resume();
        console.log('Video resumed');
      }
      setIsVideoEnabled(!isVideoEnabled);
    }
  };

  // Toggle ScreenShare
  const startScreenShare = async () => {
    if (isScreenSharingActive && screenSharerId !== socket.id) {
      alert('Someone else is already sharing their screen.');
      return;
    }
    
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });
      
      setScreenShareStream(screenStream);
      setScreenShare(true);
      
      // Create a separate producer for screen sharing
      if (producerTransport.current) {
        const videoTrack = screenStream.getVideoTracks()[0];
        const audioTrack = screenStream.getAudioTracks()[0];
        
        // Create screen share video producer
        if (videoTrack) {
          console.log('Starting screen share video production');
          const screenVideoProducer = await producerTransport.current.produce({
            track: videoTrack,
            encodings: [
              { maxBitrate: 100000 },
              { maxBitrate: 300000 },
              { maxBitrate: 900000 }
            ],
            codecOptions: {
              videoGoogleStartBitrate: 1000
            },
            appData: { mediaTag: 'screen-share' }
          });
          setScreenShareProducer(screenVideoProducer);
          console.log('Screen share video producer created:', screenVideoProducer.id);
        }
        
        // Create screen share audio producer if audio track exists
        if (audioTrack) {
          console.log('Starting screen share audio production');
          const screenAudioProducer = await producerTransport.current.produce({
            track: audioTrack,
            appData: { mediaTag: 'screen-share-audio' }
          });
          producers.current.set('screen-audio', screenAudioProducer);
          console.log('Screen share audio producer created:', screenAudioProducer.id);
        }
      }
      
      // Ensure regular video and audio producers remain active
      const regularVideoProducer = producers.current.get('video');
      const regularAudioProducer = producers.current.get('audio');
      
      if (regularVideoProducer && regularVideoProducer.paused) {
        console.log('Resuming regular video producer after screen share start');
        regularVideoProducer.resume();
      }
      
      if (regularAudioProducer && regularAudioProducer.paused) {
        console.log('Resuming regular audio producer after screen share start');
        regularAudioProducer.resume();
      }
      
      // Notify server
      socket.emit('start-screen-share', { roomId: meetingId });
      
      // Listen for when user stops sharing via browser UI
      screenStream.getVideoTracks()[0].onended = () => {
        stopScreenShare();
        socket.emit('stop-screen-share', { roomId: meetingId });
      };
      
    } catch (err) {
      console.error('Failed to start screen sharing:', err);
      alert('Failed to start screen sharing: ' + err.message);
    }
  };

  const stopScreenShare = async () => {
    setScreenShare(false);
    
    // Close screen share producer
    if (screenShareProducer) {
      screenShareProducer.close();
      setScreenShareProducer(null);
    }
    
    // Close screen share audio producer
    const screenAudioProducer = producers.current.get('screen-audio');
    if (screenAudioProducer) {
      screenAudioProducer.close();
      producers.current.delete('screen-audio');
    }
    
    // Stop screen share stream
    if (screenShareStream) {
      screenShareStream.getTracks().forEach(track => track.stop());
      setScreenShareStream(null);
    }
    
    // Ensure regular video and audio producers remain active
    const regularVideoProducer = producers.current.get('video');
    const regularAudioProducer = producers.current.get('audio');
    
    if (regularVideoProducer && regularVideoProducer.paused) {
      console.log('Resuming regular video producer after screen share stop');
      regularVideoProducer.resume();
    }
    
    if (regularAudioProducer && regularAudioProducer.paused) {
      console.log('Resuming regular audio producer after screen share stop');
      regularAudioProducer.resume();
    }
    
    // Notify server
    socket.emit('stop-screen-share', { roomId: meetingId });
  };

  const toggleScreenShare = () => {
    if (screenShare) {
      stopScreenShare();
    } else {
      // Check if someone else is already sharing
      if (isScreenSharingActive && screenSharerId !== socket.id) {
        alert('Someone else is already sharing their screen. Please wait for them to stop.');
        return;
      }
      startScreenShare();
    }
  };

  // Leave meeting
  const leaveMeeting = () => {
    console.log('Leaving meeting');
    
    // Emit leave room
    socket.emit('leave-room', { roomId: meetingId });
    
    // Stop local stream
    if (localStream.current) {
      localStream.current.getTracks().forEach(track => track.stop());
    }

    // Close producers
    producers.current.forEach(producer => producer.close());

    // Close screen share producer
    if (screenShareProducer) {
      screenShareProducer.close();
    }

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
        <div className="flex items-center gap-4">
          {isScreenSharingActive && (
            <div className="flex items-center gap-2 bg-yellow-500 text-black px-3 py-1 rounded-full text-sm font-medium">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              {screenSharerId === authUser._id ? 'You are sharing' : 'Screen sharing active'}
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">
              {isJoined ? 'Connected' : 'Connecting...'}
            </span>
            <div className={`w-3 h-3 rounded-full ${isJoined ? 'bg-green-500' : 'bg-yellow-500'}`}></div>
          </div>
        </div>
      </div>

      {/* Screen Share Denied Notification */}
      {screenShareDenied && (
        <div className="mb-4 p-4 bg-red-500 text-white rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{screenShareDenied}</span>
          </div>
          <button
            onClick={() => setScreenShareDenied(null)}
            className="text-white hover:text-gray-200"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Video Layout - Movie Watching Optimized */}
      <div className="relative mb-6">
        {/* Main Screen Share Area - Large and Prominent */}
        {(screenShare && screenShareStream) || Array.from(peerScreenShares.entries()).length > 0 ? (
          <div className="relative mb-4">
            {/* Your Screen Share */}
            {screenShare && screenShareStream && (
              <div className="relative bg-black rounded-lg overflow-hidden aspect-video shadow-2xl">
                <video
                  ref={screenShareVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-contain bg-black"
                />
                <div className="absolute bottom-4 left-4 bg-black/70 backdrop-blur-sm text-white px-3 py-2 rounded-lg text-sm font-medium">
                  🎬 Your Screen
                </div>
                <div className="absolute top-4 right-4 bg-yellow-500 text-black px-3 py-2 rounded-lg text-sm font-bold">
                  SHARING
                </div>
              </div>
            )}

            {/* Peer Screen Shares */}
            {Array.from(peerScreenShares.entries()).map(([socketId, screenShareStream]) => {
              const peer = peers.get(socketId);
              const peerName = peer ? peer.userId : socketId;
              
              return (
                <div key={`screen-${socketId}`} className="relative bg-black rounded-lg overflow-hidden aspect-video shadow-2xl">
                  <video
                    className="w-full h-full object-contain bg-black"
                    autoPlay
                    playsInline
                    ref={(el) => {
                      if (el && el.srcObject !== screenShareStream) {
                        el.srcObject = screenShareStream;
                      }
                    }}
                  />
                  <div className="absolute bottom-4 left-4 bg-black/70 backdrop-blur-sm text-white px-3 py-2 rounded-lg text-sm font-medium">
                    🎬 {peerName}'s Screen
                  </div>
                  <div className="absolute top-4 right-4 bg-purple-500 text-white px-3 py-2 rounded-lg text-sm font-bold">
                    WATCHING
                  </div>
                </div>
              );
            })}

            {/* Video Call Participants - Floating Overlay */}
            <div className="absolute top-4 left-4 z-10">
              <div className="flex flex-col gap-3">
                {/* Local Video */}
                <div className="group relative">
                  <div className="w-32 h-20 rounded-lg overflow-hidden bg-gray-800 border-2 border-white/30 shadow-lg">
                    <video
                      ref={localVideoRef}
                      autoPlay
                      muted
                      playsInline
                      className="w-full h-full object-cover"
                    />
                    {!isVideoEnabled && (
                      <div className="absolute inset-0 bg-gray-700 flex items-center justify-center">
                        <div className="w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center">
                          <span className="text-white text-sm font-bold">
                            {authUser.username.charAt(0).toUpperCase()}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="absolute -bottom-1 -right-1 bg-black/70 text-white px-2 py-1 rounded text-xs">
                    You
                  </div>
                  {/* Audio indicator */}
                  <div className={`absolute -top-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center ${
                    isAudioEnabled ? 'bg-green-500' : 'bg-red-500'
                  }`}>
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      {isAudioEnabled ? (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-3a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                      )}
                    </svg>
                  </div>
                </div>

                {/* Peer Videos */}
                {Array.from(peers.entries()).map(([socketId, peer]) => {
                  const peerStream = peerStreams.current.get(socketId);
                  
                  return (
                    <div key={socketId} className="group relative">
                      <div className="w-32 h-20 rounded-lg overflow-hidden bg-gray-800 border-2 border-white/30 shadow-lg">
                        <video
                          ref={peer.videoRef}
                          className="w-full h-full object-cover"
                          autoPlay
                          playsInline
                          muted
                        />
                        {(!peerStream || peerStream.getTracks().length === 0) && (
                          <div className="absolute inset-0 bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center">
                            <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                              <span className="text-white text-sm font-bold">
                                {peer.userId.charAt(0).toUpperCase()}
                              </span>
                            </div>
                          </div>
                        )}
                        {/* Connection indicator overlay */}
                        {peerStream && peerStream.getTracks().length > 0 && (
                          <div className="absolute top-1 left-1 w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                        )}
                      </div>
                      <div className="absolute -bottom-1 -right-1 bg-black/70 text-white px-2 py-1 rounded text-xs">
                        {peer.userId}
                      </div>
                      <div className="absolute -top-1 -right-1 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                        <div className="w-2 h-2 bg-white rounded-full"></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Movie Theater Controls - Bottom Right */}
            <div className="absolute bottom-4 right-4 z-10">
              <div className="bg-black/70 backdrop-blur-sm rounded-lg p-3 text-white">
                <div className="text-xs text-gray-300 mb-1">🎬 Movie Night</div>
                <div className="text-sm font-medium">
                  {peers.size + 1} watching together
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Regular Video Call Layout - When No Screen Share */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
        )}
      </div>
      {/* Controls - Movie Theater Style */}
      <div className="flex flex-col items-center gap-4">
        {/* Main Controls */}
        <div className="flex justify-center gap-4 bg-black/20 backdrop-blur-sm rounded-full p-4">
          <button
            onClick={toggleAudio}
            className={`p-4 rounded-full transition-all duration-200 transform hover:scale-110 ${
              isAudioEnabled 
                ? 'bg-gray-700 hover:bg-gray-600 text-white' 
                : 'bg-red-500 hover:bg-red-600 text-white'
            }`}
            title={isAudioEnabled ? 'Mute Audio' : 'Unmute Audio'}
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
            className={`p-4 rounded-full transition-all duration-200 transform hover:scale-110 ${
              isVideoEnabled 
                ? 'bg-gray-700 hover:bg-gray-600 text-white' 
                : 'bg-red-500 hover:bg-red-600 text-white'
            }`}
            title={isVideoEnabled ? 'Turn Off Video' : 'Turn On Video'}
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
            onClick={toggleScreenShare}
            className={`p-4 rounded-full transition-all duration-200 transform hover:scale-110 ${
              screenShare
                ? 'bg-yellow-500 hover:bg-yellow-600 text-white'
                : isScreenSharingActive && screenSharerId !== authUser._id
                  ? 'bg-gray-500 text-white cursor-not-allowed opacity-50'
                  : 'bg-gray-700 hover:bg-gray-600 text-white'
            }`}
            disabled={isScreenSharingActive && screenSharerId !== authUser._id}
            title={
              isScreenSharingActive && screenSharerId !== authUser._id
                ? 'Someone else is sharing their screen'
                : screenShare
                ? 'Stop screen sharing'
                : 'Start screen sharing'
            }
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {screenShare ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L15 12.75M15 12.75L9.75 8.5M15 12.75H3" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              )}
            </svg>
          </button>

          <button
            onClick={leaveMeeting}
            className="p-4 rounded-full bg-red-500 hover:bg-red-600 text-white transition-all duration-200 transform hover:scale-110"
            title="Leave Meeting"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 21v-4a2 2 0 012-2h4l2-2h2a2 2 0 012 2v4a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            </svg>
          </button>
        </div>

        {/* Status and Info */}
        <div className="flex items-center gap-6 text-sm text-gray-300">
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${isJoined ? 'bg-green-500' : 'bg-yellow-500'}`}></div>
            <span>{isJoined ? 'Connected' : 'Connecting...'}</span>
          </div>
          
          {isScreenSharingActive && (
            <div className="flex items-center gap-2 bg-yellow-500/20 text-yellow-300 px-3 py-1 rounded-full">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <span>{screenSharerId === authUser._id ? 'You are sharing' : 'Screen sharing active'}</span>
            </div>
          )}
          
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            <span>{peers.size + 1} participants</span>
          </div>
        </div>

        {/* Movie Night Instructions */}
        {(screenShare && screenShareStream) || Array.from(peerScreenShares.entries()).length > 0 ? (
          <div className="bg-gradient-to-r from-purple-900/30 to-pink-900/30 rounded-lg p-4 text-center border border-purple-500/20 max-w-2xl">
            <div className="flex items-center justify-center gap-2 mb-2">
              <span className="text-2xl">🍿</span>
              <h3 className="text-lg font-bold text-purple-200">Movie Night Mode Active</h3>
              <span className="text-2xl">🎬</span>
            </div>
            <p className="text-sm text-purple-300 mb-2">
              Perfect for watching movies, shows, or videos together with friends!
            </p>
            <div className="text-xs text-purple-400">
              • Video calls are minimized to focus on the shared screen • Use the floating video panel to see friends • Audio controls for movie sound
            </div>
          </div>
        ) : (
          <div className="bg-gradient-to-r from-blue-900/30 to-purple-900/30 rounded-lg p-4 text-center border border-blue-500/20 max-w-2xl">
            <div className="flex items-center justify-center gap-2 mb-2">
              <span className="text-2xl">📹</span>
              <h3 className="text-lg font-bold text-blue-200">Video Call Mode</h3>
              <span className="text-2xl">👥</span>
            </div>
            <p className="text-sm text-blue-300 mb-2">
              Click the screen share button to start a movie night with friends!
            </p>
            <div className="text-xs text-blue-400">
              • Share your screen to watch movies together • Video calls become floating overlays • Perfect for group movie nights
            </div>
          </div>
        )}
      </div>
    </div>
  </div>
);

};

export default Meeting;   