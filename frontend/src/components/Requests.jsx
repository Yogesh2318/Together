import React, { useState, useEffect } from "react";
import axios from "axios";
import { useAuthContext } from "../context/AuthContext";

function Requests() {
    const { authUser} = useAuthContext(); // Assume token is available in context
    const [requests, setRequests] = useState([]);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const token = authUser.token;
    useEffect(() => {
        if (!authUser) return;

        let isMounted = true; 
        
        const fetchRequests = async () => {
            try {
                setLoading(true);
                setError(null); // Reset error before fetching

                const res = await axios.get('http://localhost:5000/api/friend/request', {
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`, // Include auth token if needed
                    },
                    withCredentials: true 
                });

                 setRequests(res.data.request);
                
            } catch (err) {
                if (isMounted) setError(err.response?.data?.message || "Something went wrong");
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        fetchRequests();

        return () => {
            isMounted = false;
        };
    }, [authUser, token]);

    // setRequests(authUser.Requests);

    const handleAccept = async (id) => {
        try {
            await axios.get(`http://localhost:5000/api/friend/accept-request/${id}`, {
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`, // Include auth token if needed
                },
                withCredentials: true,
            });
            setRequests((prev) => prev.filter((req) => req._id !== id));
        } catch (err) {
            alert(err.response?.data?.message || "Failed to accept request");
        }
    };

    const handleReject = async (id) => {
        try {
            await axios.get(`http://localhost:5000/api/friend/remove-request/${id}`, {
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`, // Include auth token if needed
                },
                withCredentials: true,
            });
            setRequests((prev) => prev.filter((req) => req._id !== id));
        } catch (err) {
            alert(err.response?.data?.message || "Failed to reject request");
        }
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen">
            <h1>Friend Requests</h1>
            {loading && <p>Loading...</p>}
            {error && <p style={{ color: "red" }}>Error: {error}</p>}
            
            {!loading && requests.length === 0 && <p>No requests found</p>}
            
            {requests.map((request) => (
                <div key={request._id} style={{ border: "1px solid #ddd", padding: "10px", margin: "10px 0" }}>
                    <p><strong>{request.username}</strong></p>
                    <button onClick={() => handleAccept(request._id)} style={{ marginRight: "10px", background: "green", color: "white" }}>
                        Accept
                    </button>
                    <button onClick={() => handleReject(request._id)} style={{ background: "red", color: "white" }}>
                        Reject
                    </button>
                </div>
            ))}
        </div>
    );
}

export default Requests;
