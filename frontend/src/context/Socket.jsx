import { createContext, useState, useEffect, useContext } from "react";
import { io } from "socket.io-client";
import { useAuthContext } from "./AuthContext";

const SocketContext = createContext();

export const useSocketContext = () => {
  return useContext(SocketContext);
};

export const SocketContextProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
 const { authUser } = useAuthContext();
  const [onlineUsers, setOnlineUsers] = useState([]);

  useEffect(() => {
    if (authUser && authUser._id) {
      // Create socket connection with userId
      const newSocket = io("http://localhost:5000", {
        query: { 
          userId: authUser._id, // Pass user ID as query parameter
        },
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
      });

      setSocket(newSocket);

      // Connection event handlers
      newSocket.on("connect", () => {
        console.log("Connected to socket server with ID:", newSocket.id);
      });

      newSocket.on("connect_error", (error) => {
        console.error("Socket connection error:", error);
      });

      newSocket.on("disconnect", (reason) => {
        console.log("Disconnected from socket server:", reason);
      });

      // Listen for online users updates
      newSocket.on("onlineUsers", (authUser) => {
        console.log("Online users updated:",authUser );
        setOnlineUsers(authUser);
      });

      // Cleanup function
      return () => {
        console.log("Cleaning up socket connection");
        newSocket.close();
        setSocket(null);
      };
    } else {
      // If no user, cleanup existing socket
      if (socket) {
        socket.close();
        setSocket(null);
        setOnlineUsers([]);
      }
    }
  }, [authUser]);

  return (
    <SocketContext.Provider 
      value={{ 
        socket, 
        onlineUsers,
        isConnected: socket?.connected || false 
      }}
    >
      {children}
    </SocketContext.Provider>
  );
};