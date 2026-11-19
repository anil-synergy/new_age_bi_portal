import React, { useEffect, useContext } from 'react';
import { ClipLoader } from 'react-spinners';
import { AuthContext } from '../providers/AuthProvider';
import config from '../../config';

const { redirectUrl } = config;
const Logout = () => {
  const authService = useContext(AuthContext);
  useEffect(() => {
    localStorage.setItem('redirectUri', redirectUrl);
    sessionStorage.clear();
    function logout() {
      authService.logout();
    }
    logout();
  }, [authService]);
  return (
    <div className="loader">
      <ClipLoader label="Logging you out" />
    </div>
  );
};
export default Logout;
