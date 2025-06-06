import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthContext } from "../../context/AuthContext";
import { useSocketContext } from "../../context/Socket";
import axios from "axios";
import Navbar from "../../components/Navbar";

const Home = () => {
  const { authUser } = useAuthContext();
  const { socket, onlineUsers } = useSocketContext(); // ✅ Access socket from context
  const [meetingCode, setMeetingCode] = useState("");
  const [incomingCall, setIncomingCall] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (authUser) {
     
      console.log("Registered user:", authUser._id);
      // Here you can set up socket listeners if needed
    console.log("Socket connection established:", socket);
    console.log("Online users:", onlineUsers);
      if (socket) {
        console.log("Socket is available:", socket.id);
       }

    }

  },[authUser]);

  // ✅ Function to start a new meeting
  const generateMeetingLink = () => {
    const meetingId = crypto.randomUUID();
    navigate(`/meeting/${meetingId}`);
  };

  // ✅ Function to join a meeting
  const joinMeeting = () => {
    if (meetingCode.trim()) {
      navigate(`/meeting/${meetingCode}`);
    }
  };

   socket?.on("incoming-call", (data) => {
    console.log("Incoming call data:", data);
    setIncomingCall(data);
  });

  const handleLogout = async () => {
    try {
      localStorage.removeItem("Together-user");
      await axios.post("http://localhost:5000/api/auth/logout");
      navigate("/login");
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  return (

    <div className="flex flex-col justify-center items-center h-screen">
      <Navbar />

      {/* Main Controls */}
      <div className="mt-6 flex flex-col space-y-4 p-5">
        <button
          className="px-6 py-3 bg-blue-600 text-white rounded-lg shadow-md hover:bg-blue-800 transition"
          onClick={generateMeetingLink}
        >
          Start Meeting
        </button>

        {/* Input for Meeting Code */}
        <input
          type="text"
          placeholder="Enter Meeting Code"
          value={meetingCode}
          onChange={(e) => setMeetingCode(e.target.value)}
          className="px-4 py-2 border rounded-lg shadow-md"
        />
        <button
          className="px-6 py-3 bg-green-600 text-white rounded-lg shadow-md hover:bg-green-800 transition"
          onClick={joinMeeting}
        >
          Join Meeting
        </button>

        <button
          onClick={handleLogout}
          className="px-6 py-3 bg-red-600 text-white rounded-lg shadow-md hover:bg-red-800 transition"
        >
          Logout
        </button>
      </div>
    </div>
  
  );
};

export default Home;
