import React, { useEffect, useState, useMemo } from "react";
import { useAuthContext } from "../context/AuthContext";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { useSocketContext } from "../context/Socket";

function Friends() {
  const { authUser } = useAuthContext();
  const [friends, setFriends] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { onlineUsers, socket } = useSocketContext();

  // Fetch friends effect
  useEffect(() => {
    if (!authUser) return;
    
    const fetchFriends = async () => {
      try {
        const res = await axios.get("http://localhost:5000/api/users/getfriends", {
          headers: {
            "Content-Type": "application/json",
          },
          withCredentials: true,
        });
        setFriends(res.data.friends || []);
      } catch (err) {
        setError(err.response?.data?.message || err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchFriends();
  }, [authUser]);

  // Set up socket event listeners
  useEffect(() => {
    if (!socket) return;

    const handleCallRejected = ({ meetingId, rejectedBy }) => {
      alert(`Call was rejected`);
      console.log(`Meeting ${meetingId} was rejected by ${rejectedBy}`);
    };

    const handleMeetingAccepted = ({ meetingId, participants, acceptedBy }) => {
      console.log(`Meeting ${meetingId} accepted by ${acceptedBy}`);
      // Navigate both caller and receiver to meeting
      navigate(`/meeting/${meetingId}`);
    };

    // Add event listeners with correct event names
    socket.on("call-rejected", handleCallRejected);
    socket.on("meeting-accepted", handleMeetingAccepted); // Fixed event name

    // Debug: Log when listeners are added
    console.log("Socket event listeners added");

    // Cleanup listeners on unmount
    return () => {
      socket.off("call-rejected", handleCallRejected);
      socket.off("meeting-accepted", handleMeetingAccepted);
      console.log("Socket event listeners removed");
    };
  }, [socket, navigate]);

  // Calculate online friends using useMemo for better performance
  const onlineFriends = useMemo(() => {
    if (!friends.length || !onlineUsers.length) return [];
    
    return friends.filter((friend) => 
      onlineUsers.some((user) => user === friend._id)
    );
  }, [friends, onlineUsers]);

  // Function to check if a friend is online
  const isOnline = (friendId) => {
    return onlineUsers.some((user) => user === friendId);
  };

  // Function to start a video call
  const startCall = (friendId) => {
    if (!socket) {
      console.error("Socket not available");
      return;
    }
    
    const meetingId = `${authUser._id}-${friendId}-${Date.now()}`;

    socket.emit("meeting-request", { 
      meetingId, 
      participants: [authUser._id, friendId]
    });

    console.log(`Call initiated to ${friendId}`);
  };

  // Debug logs
  console.log("Friends fetched:", friends);
  console.log("Online users:", onlineUsers);
  console.log("Online friends:", onlineFriends);

  if (!authUser) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <p className="text-white text-xl">Please log in to view friends</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start justify-start min-h-screen">
      <h1 className="m-4 text-4xl text-white">Friends</h1>
      
      {loading && <p className="text-white m-4">Loading...</p>}
      {error && <p className="text-red-500 m-4">Error: {error}</p>}
      
      {!loading && (
        <>
          {/* Online Friends Section */}
          <div className="m-4 w-full max-w-4xl">
            <h2 className="text-2xl text-white mb-4 flex items-center">
              Online Friends 
              <span className="ml-2 bg-green-500 text-white text-sm px-2 py-1 rounded-full">
                {onlineFriends.length}
              </span>
            </h2>
            
            {onlineFriends.length > 0 ? (
              <div className="space-y-3">
                {onlineFriends.map((friend) => (
                  <div 
                    key={`online-${friend._id}`} 
                    className="friend-item p-4 bg-gray-800 rounded-lg border border-green-500/20"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <div className="relative">
                          <div className="w-10 h-10 bg-gray-600 rounded-full flex items-center justify-center">
                            <span className="text-white font-semibold text-lg">
                              {friend.username.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-gray-800"></div>
                        </div>
                        <div className="ml-3">
                          <p className="text-white text-lg font-medium">{friend.username}</p>
                          <p className="text-green-400 text-sm">Online</p>
                        </div>
                      </div>
                      <button
                        onClick={() => startCall(friend._id)}
                        className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg transition-colors duration-200 font-medium"
                      >
                        Start Video Call
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 bg-gray-800 rounded-lg text-center">
                <p className="text-gray-400 text-lg">No friends are currently online</p>
                <p className="text-gray-500 text-sm mt-1">
                  Friends will appear here when they come online
                </p>
              </div>
            )}
          </div>

          {/* All Friends Section */}
          <div className="m-4 w-full max-w-4xl">
            <h2 className="text-2xl text-white mb-4 flex items-center">
              All Friends 
              <span className="ml-2 bg-gray-600 text-white text-sm px-2 py-1 rounded-full">
                {friends.length}
              </span>
            </h2>
            
            {friends.length > 0 ? (
              <div className="space-y-2">
                {friends.map((friend) => {
                  const friendIsOnline = isOnline(friend._id);
                  return (
                    <div 
                      key={`all-${friend._id}`} 
                      className={`friend-item p-3 rounded-lg transition-colors duration-200 ${
                        friendIsOnline 
                          ? 'bg-gray-700 border border-green-500/10' 
                          : 'bg-gray-800'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center">
                          <div className="relative">
                            <div className="w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center">
                              <span className="text-white text-sm font-medium">
                                {friend.username.charAt(0).toUpperCase()}
                              </span>
                            </div>
                            <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-gray-800 ${
                              friendIsOnline ? 'bg-green-500' : 'bg-gray-500'
                            }`}></div>
                          </div>
                          <div className="ml-3">
                            <p className="text-white font-medium">{friend.username}</p>
                            <span className={`text-xs ${
                              friendIsOnline ? 'text-green-400' : 'text-gray-500'
                            }`}>
                              {friendIsOnline ? 'Online' : 'Offline'}
                            </span>
                          </div>
                        </div>
                        
                        {friendIsOnline && (
                          <button
                            onClick={() => startCall(friend._id)}
                            className="bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded-md text-sm transition-colors duration-200 font-medium"
                          >
                            Call
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-6 bg-gray-800 rounded-lg text-center">
                <p className="text-gray-400 text-lg">No friends found</p>
                <p className="text-gray-500 text-sm mt-1">
                  Add some friends to start video calling
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default Friends;