import React, { useState, useEffect } from 'react';
import { useSocketContext } from '../context/Socket';
import { useAuthContext } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

const IncomingCall = () => {
  const [incomingCall, setIncomingCall] = useState(null);
  const [callerInfo, setCallerInfo] = useState(null);
  const { socket } = useSocketContext();
  const { authUser } = useAuthContext();
  const navigate = useNavigate();

  useEffect(() => {
    if (!socket) return;

    const handleIncomingCall = async ({ meetingId, participants }) => {
      // Find the caller (the participant who is not the current user)
      const callerId = participants.find(id => id !== authUser._id);
      const UserName =
      // You might want to fetch caller info from your API
      // For now, we'll just use the ID
      setCallerInfo({ id: callerId, username: `User ${callerId}` });
      setIncomingCall({ meetingId, participants });
    };

    socket.on('incoming-call', handleIncomingCall);

    return () => {
      socket.off('incoming-call', handleIncomingCall);
    };
  }, [socket, authUser]);

  const acceptCall = () => {
    if (incomingCall && socket) {
      socket.emit('accept-meeting', {
        meetingId: incomingCall.meetingId,
        participants: incomingCall.participants
      });
      
      // Navigate to meeting page
      navigate(`/meeting/${incomingCall.meetingId}`);
      
      // Clear the incoming call state
      setIncomingCall(null);
      setCallerInfo(null);
    }
  };

  const rejectCall = () => {
    if (incomingCall && socket) {
      socket.emit('reject-meeting', {
        meetingId: incomingCall.meetingId,
        participants: incomingCall.participants
      });
      
      // Clear the incoming call state
      setIncomingCall(null);
      setCallerInfo(null);
    }
  };

  // Don't render anything if there's no incoming call
  if (!incomingCall) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 max-w-sm w-full mx-4 text-center">
        <div className="mb-4">
          <div className="w-20 h-20 bg-gray-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-white text-2xl font-bold">
              {callerInfo?.username?.charAt(0)?.toUpperCase() || 'U'}
            </span>
          </div>
          <h2 className="text-white text-xl font-semibold mb-2">
            Incoming Video Call
          </h2>
          <p className="text-gray-300">
            {callerInfo?.username || 'Unknown User'} is calling you
          </p>
        </div>
        
        <div className="flex gap-4 justify-center">
          <button
            onClick={rejectCall}
            className="bg-red-500 hover:bg-red-600 text-white px-6 py-3 rounded-full transition-colors duration-200 flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Decline
          </button>
          
          <button
            onClick={acceptCall}
            className="bg-green-500 hover:bg-green-600 text-white px-6 py-3 rounded-full transition-colors duration-200 flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Accept
          </button>
        </div>
      </div>
    </div>
  );
};

export default IncomingCall;