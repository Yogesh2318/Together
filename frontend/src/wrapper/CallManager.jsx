import React from 'react';
import IncomingCall from '../components/IncomingCall';
import { useAuthContext } from '../context/AuthContext';

const CallManager = ({ children }) => {
  const { authUser } = useAuthContext();

  return (
    <>
      {children}
      {/* Only show incoming call component if user is authenticated */}
      {authUser && <IncomingCall />}
    </>
  );
};

export default CallManager;