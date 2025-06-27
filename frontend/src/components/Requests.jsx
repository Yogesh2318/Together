import React, { useState, useEffect } from "react";
import axios from "axios";
import { useAuthContext } from "../context/AuthContext";
import { toast } from 'react-hot-toast';

function Requests() {
    const { authUser } = useAuthContext();
    const [requests, setRequests] = useState([]);
    const [allUsers, setAllUsers] = useState([]); // Store all available users
    const [filteredUsers, setFilteredUsers] = useState([]);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [userLoading, setUserLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [processingRequest, setProcessingRequest] = useState(null);
    
    const token = authUser?.token;

    // Helper function to filter users based on friend status and requests
    const filterAvailableUsers = (users) => {
        if (!authUser) return [];
        
        return users.filter(user => {
            // Exclude current user
            if (user._id === authUser._id) return false;
            // Exclude users where authUser is already a friend
            if (user.friends && user.friends.includes(authUser._id)) return false;
            // Exclude users where authUser has already sent or received a request
            if (user.requests && user.requests.includes(authUser._id)) return false;
            return true;
        });
    };

    useEffect(() => {
        if (!authUser || !token) return;

        let isMounted = true;
        
        const fetchRequests = async () => {
            try {
                setLoading(true);
                setError(null);

                const res = await axios.get('http://localhost:5000/api/friend/request', {
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    withCredentials: true 
                });

                if (isMounted) {
                    setRequests(res.data.request || []);
                }
                
            } catch (err) {
                if (isMounted) {
                    console.error("Error fetching requests:", err);
                    const errorMessage = err.response?.data?.message || "Failed to fetch requests";
                    setError(errorMessage);
                    toast.error(errorMessage);
                }
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        const fetchUsers = async () => {
            try {
                setUserLoading(true);
                const res = await axios.get('http://localhost:5000/api/users/users', {
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    withCredentials: true 
                });
                
                if (isMounted) {
                    // Filter out current user, friends, and users who already have pending requests
                    console.log("Fetched users:", res.data);
                    const availableUsers = filterAvailableUsers(res.data);
                    setAllUsers(availableUsers);
                    setFilteredUsers(availableUsers);
                }
            } catch (err) {
                if (isMounted) {
                    console.error("Error fetching users:", err);
                    const errorMessage = err.response?.data?.message || "Failed to fetch users";
                    setError(errorMessage);
                    toast.error(errorMessage);
                }
            } finally {
                if (isMounted) setUserLoading(false);
            }
        };

        fetchRequests();
        fetchUsers();

        return () => {
            isMounted = false;
        };
    }, [authUser, token]);

    // Handle search functionality
    useEffect(() => {
        if (!searchTerm.trim()) {
            setFilteredUsers(allUsers);
        } else {
            const filtered = allUsers.filter(user =>
                user.username.toLowerCase().includes(searchTerm.toLowerCase())
            );
            setFilteredUsers(filtered);
        }
    }, [searchTerm, allUsers]);

    const handleAccept = async (id) => {
        try {
            setProcessingRequest(id);
            await axios.get(`http://localhost:5000/api/friend/accept-request/${id}`, {
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                withCredentials: true,
            });
            
            // Remove the accepted request from the list
            setRequests((prev) => prev.filter((req) => req._id !== id));
            toast.success('Friend request accepted!');
            
        } catch (err) {
            const errorMessage = err.response?.data?.message || "Failed to accept request";
            setError(errorMessage);
            toast.error(errorMessage);
        } finally {
            setProcessingRequest(null);
        }
    };

    const handleReject = async (id) => {
        try {
            setProcessingRequest(id);
            await axios.get(`http://localhost:5000/api/friend/remove-request/${id}`, {
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                withCredentials: true,
            });
            
            // Remove the rejected request from the list
            setRequests((prev) => prev.filter((req) => req._id !== id));
            toast.success('Friend request rejected');
            
        } catch (err) {
            const errorMessage = err.response?.data?.message || "Failed to reject request";
            setError(errorMessage);
            toast.error(errorMessage);
        } finally {
            setProcessingRequest(null);
        }
    };
   
    const handleSendRequest = async (id) => {
        try {
            setProcessingRequest(id);
            await axios.post(`http://localhost:5000/api/friend/send-request/${id}`, 
                {}, // empty body since we're just sending the request
                {
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    withCredentials: true,
                }
            );
            
            // Remove the user from available users list
            const updatedUsers = allUsers.filter((user) => user._id !== id);
            setAllUsers(updatedUsers);
            setFilteredUsers(updatedUsers.filter(user =>
                user.username.toLowerCase().includes(searchTerm.toLowerCase())
            ));
            
            toast.success('Friend request sent!');
            
        } catch (err) {
            const errorMessage = err.response?.data?.message || "Failed to send request";
            setError(errorMessage);
            toast.error(errorMessage);
        } finally {
            setProcessingRequest(null);
        }
    };

    // Loading skeleton component
    const LoadingSkeleton = () => (
        <div className="animate-pulse">
            <div className="h-12 bg-gray-200 rounded mb-4"></div>
            <div className="h-12 bg-gray-200 rounded mb-4"></div>
            <div className="h-12 bg-gray-200 rounded"></div>
        </div>
    );

    if (!authUser) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-50">
                <div className="text-center p-8 bg-white rounded-lg shadow-md">
                    <h2 className="text-xl font-semibold text-gray-700 mb-2">Authentication Required</h2>
                    <p className="text-gray-500">Please log in to view friend requests.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen py-8 px-4 sm:px-6 lg:px-8">
            <div className="max-w-4xl mx-auto">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Friend Requests Section */}
                    <div className="bg-white rounded-lg shadow-md p-6">
                        <h1 className="text-2xl font-bold mb-6 text-gray-800 border-b pb-4">Friend Requests</h1>
                        
                        {loading ? (
                            <LoadingSkeleton />
                        ) : error ? (
                            <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded relative" role="alert">
                                <span className="block sm:inline">{error}</span>
                            </div>
                        ) : requests.length === 0 ? (
                            <div className="text-center py-8">
                                <div className="text-gray-400 mb-2">
                                    <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                                    </svg>
                                </div>
                                <p className="text-gray-500">No pending requests</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {requests.map((request) => (
                                    <div key={request._id} 
                                         className="bg-gray-50 rounded-lg p-4 transition-all duration-200 hover:shadow-md">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center space-x-3">
                                                <div className="h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center">
                                                    <span className="text-gray-600 font-medium">
                                                        {request.username.charAt(0).toUpperCase()}
                                                    </span>
                                                </div>
                                                <div>
                                                    <p className="font-medium text-gray-800">{request.username}</p>
                                                    <p className="text-sm text-gray-500">Sent you a friend request</p>
                                                </div>
                                            </div>
                                            <div className="flex space-x-2">
                                                <button 
                                                    onClick={() => handleAccept(request._id)}
                                                    disabled={processingRequest === request._id}
                                                    className={`px-4 py-2 rounded-md text-sm font-medium text-white 
                                                        ${processingRequest === request._id 
                                                            ? 'bg-green-400 cursor-not-allowed' 
                                                            : 'bg-green-500 hover:bg-green-600'} 
                                                        transition-colors duration-200`}
                                                >
                                                    {processingRequest === request._id ? 'Accepting...' : 'Accept'}
                                                </button>
                                                <button 
                                                    onClick={() => handleReject(request._id)}
                                                    disabled={processingRequest === request._id}
                                                    className={`px-4 py-2 rounded-md text-sm font-medium text-white 
                                                        ${processingRequest === request._id 
                                                            ? 'bg-red-400 cursor-not-allowed' 
                                                            : 'bg-red-500 hover:bg-red-600'} 
                                                        transition-colors duration-200`}
                                                >
                                                    {processingRequest === request._id ? 'Rejecting...' : 'Reject'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Add Friends Section */}
                    <div className="bg-white rounded-lg shadow-md p-6">
                        <h2 className="text-2xl font-bold mb-6 text-gray-800 border-b pb-4">Add Friends</h2>
                        
                        <div className="mb-6">
                            <div className="relative">
                                <input
                                    type="text"
                                    placeholder="Search users..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="w-full p-3 pl-10 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                                />
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                    </svg>
                                </div>
                            </div>
                        </div>
                        
                        {userLoading ? (
                            <LoadingSkeleton />
                        ) : filteredUsers.length === 0 ? (
                            <div className="text-center py-8">
                                <div className="text-gray-400 mb-2">
                                    <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                                    </svg>
                                </div>
                                <p className="text-gray-500">
                                    {searchTerm ? "No users found matching your search" : "No users available to add"}
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {filteredUsers.map((user) => (
                                    <div key={user._id} 
                                         className="bg-gray-50 rounded-lg p-4 transition-all duration-200 hover:shadow-md">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center space-x-3">
                                                <div className="h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center">
                                                    <span className="text-gray-600 font-medium">
                                                        {user.username.charAt(0).toUpperCase()}
                                                    </span>
                                                </div>
                                                <div>
                                                    <p className="font-medium text-gray-800">{user.username}</p>
                                                    <p className="text-sm text-gray-500">Available to add as friend</p>
                                                </div>
                                            </div>
                                            <button 
                                                onClick={() => handleSendRequest(user._id)}
                                                disabled={processingRequest === user._id}
                                                className={`px-4 py-2 rounded-md text-sm font-medium text-white 
                                                    ${processingRequest === user._id 
                                                        ? 'bg-blue-400 cursor-not-allowed' 
                                                        : 'bg-blue-500 hover:bg-blue-600'} 
                                                    transition-colors duration-200`}
                                            >
                                                {processingRequest === user._id ? 'Sending...' : 'Send Request'}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default Requests;