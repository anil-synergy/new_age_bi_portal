import React, { useContext } from 'react';
import SynergyLogo from '../../images/icons/synergy-logo.png';
import synergyEmblem from '../../images/icons/synergy-emblem.svg';
import { AuthContext } from '../providers/AuthProvider';
import config from '../../config';
import { ProvideName } from '../auth/authConstants';

const LoginHome = (props) => {
  const authService = useContext(AuthContext);

  const setAuthenticatedUser = async () => {
    const authenticatedUser = await authService.signinSilent();
    if (!authenticatedUser || localStorage.getItem('access_token') == null) {
      authService.signinRedirect();
    }
  };

  const redirectLogin = () => {
    if (!localStorage.getItem('access_token')) {
      setAuthenticatedUser();
    }
    const { redirectUrl } = config;
    // eslint-disable-next-line react/destructuring-assignment
    const sessionStorageData = sessionStorage.getItem('feedback-reportId');
    const { history } = props;
    history.push(sessionStorageData || redirectUrl);
  };

  const loginHandler = (type) => {
    localStorage.setItem('AuthenticationProvide', type);
    authService.updateUserManagerConfig(type);
    redirectLogin();
  };

  return (
    <div className="login">
      <div className="login__left">
        <img src={SynergyLogo} alt="" />
        <h1>Synergy BI Portal</h1>
        <h4>View all Power BI reports from one place</h4>
      </div>
      <div className="login__right">
        <h1>Welcome</h1>

        <button
          className="btn-outline btn-lg"
          id="officeloginbtn"
          type="button"
          onClick={async () => {
            loginHandler(ProvideName.AzureAD);
          }}
        >
          <img src={synergyEmblem} alt="" />
          Login
        </button>
        {/* <div className="login__separate">or</div>
        <button
          className="btn-primary btn-lg"
          id="officeloginbtn"
          type="button"
          onClick={async () => {
            loginHandler(ProvideName.SynergySSO);
          }}
        >
          Login with SAC account
        </button> */}
      </div>
    </div>
  );
};
export default LoginHome;
