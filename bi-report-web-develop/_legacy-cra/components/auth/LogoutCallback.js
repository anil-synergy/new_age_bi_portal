import React, { useEffect, useContext } from 'react';
import { ClipLoader } from 'react-spinners';
import { AuthContext } from '../providers/AuthProvider';

const LogoutCallback = () => {
  const authService = useContext(AuthContext);
  useEffect(() => {
    function setAuthenticatedUser() {
      authService.signoutRedirectCallback();
    }
    setAuthenticatedUser();
  }, [authService]);
  return <ClipLoader label="Clearing Session" />;
};
export default LogoutCallback;
