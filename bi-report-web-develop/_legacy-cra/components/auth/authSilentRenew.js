import React, { useEffect, useContext } from 'react';
import { ClipLoader } from 'react-spinners';
import { AuthContext } from '../providers/AuthProvider';

const AuthSilentRenew = () => {
  const authService = useContext(AuthContext);
  useEffect(() => {
    function signinSilentCallback() {
      authService.signinSilentCallback();
    }
    signinSilentCallback();
  }, [authService]);
  return (
    <div className="loader">
      <ClipLoader label="Logging you out" />
    </div>
  );
};
export default AuthSilentRenew;
