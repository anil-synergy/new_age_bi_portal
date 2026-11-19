import React, { useEffect, useContext } from 'react';
import { ClipLoader } from 'react-spinners';
import { AuthContext } from '../providers/AuthProvider';

const AuthCallback = () => {
  const authService = useContext(AuthContext);
  useEffect(() => {
    function signinRedirectCallback() {
      authService.signinRedirectCallback();
    }
    signinRedirectCallback();
  }, [authService]);
  return (
    <div className="loader">
      <ClipLoader label="Signing you back in" />
    </div>
  );
};
export default AuthCallback;
