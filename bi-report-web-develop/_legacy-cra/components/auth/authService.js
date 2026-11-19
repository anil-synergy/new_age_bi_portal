/* eslint-disable space-in-parens */
/* eslint-disable lines-between-class-members */
/* eslint-disable comma-dangle */
/* eslint-disable max-len */
import { UserManager, WebStorageStateStore } from 'oidc-client';
import jwtDecode from 'jwt-decode';
import { AzureADConfigConstants } from './authConstants';
import config from '../../config';

const { redirectUrl } = config;

export default class AuthService {
  UserManager;
  IDENTITY_CONFIG;
  accessToken;

  constructor() {
    // this.IDENTITY_CONFIG = localStorage.getItem('AuthenticationProvide') === ProvideName.AzureAD ? AzureADConfigConstants : SynergySSOConfigConstants;
    this.IDENTITY_CONFIG = AzureADConfigConstants;

    this.UserManager = new UserManager({
      ...this.IDENTITY_CONFIG,
      userStore: new WebStorageStateStore({ store: window.localStorage }),
    });

    this.UserManager.events.addUserSignedOut(async () => {
      try {
        await this.UserManager.signinSilent();
      } catch (error) {
        // Test
      }
    });
    this.UserManager.events.addUserLoaded(async (user) => {
      this.accessToken = user.access_token;
      localStorage.setItem('access_token', user.access_token);
      localStorage.setItem('id_token', user.id_token);
      this.setUserInfo({
        accessToken: this.accessToken,
        idToken: user.id_token,
      });
      if (window.location.href.indexOf('authentication/callback') !== -1) {
        this.navigateToScreen();
      }
    });

    // Token is about to expire → redirect login flow
    this.UserManager.events.addAccessTokenExpiring(async () => {
      localStorage.setItem('redirectUri', window.location.pathname);
      this.UserManager.signinRedirect().catch((error) => {
        console.error('Signin redirect failed after token expiry', error);
      });
    });

    this.UserManager.events.addSilentRenewError((error) => {
      console.error('Silent renew error', error);
    });

    // Token expired → do a redirect login flow
    this.UserManager.events.addAccessTokenExpired(() => {
      localStorage.setItem('redirectUri', window.location.pathname);
      this.UserManager.signinRedirect().catch((error) => {
        console.error('Signin redirect failed after token expiry', error);
      });
    });
  }

  updateUserManagerConfig = () => {
    this.UserManager = new UserManager({
      ...AzureADConfigConstants,
      userStore: new WebStorageStateStore({ store: window.localStorage }),
      automaticSilentRenew: true,
    });
    this.IDENTITY_CONFIG = { ...AzureADConfigConstants };
  };

  signinRedirectCallback = () => {
    this.UserManager.signinRedirectCallback()
      .then(() => {})
      .catch(() => {
        window.location.replace(redirectUrl);
      });
  };

  getUser = async () => {
    const user = await this.UserManager.getUser();
    if (!user) {
      return this.UserManager.signinRedirectCallback();
    }
    return user;
  };

  setUserInfo = (authResult) => {
    const data = jwtDecode(this.accessToken);
    this.setSessionInfo(authResult);
    this.setUser(data);
  };

  signinRedirect = () => {
    localStorage.setItem('redirectUri', window.location.pathname);
    this.UserManager.signinRedirect({});
  };

  setUser = (data) => {
    localStorage.setItem('userId', data.sub);
  };

  navigateToScreen = () => {
    const redirectUri = localStorage.getItem('redirectUri') || '/';
    const token = localStorage.getItem('access_token');
    if (redirectUri === '/login' && token) {
      window.location.replace('/dashboard');
    } else {
      window.location.replace(redirectUri);
    }
  };

  setSessionInfo = (authResult) => {
    localStorage.setItem('access_token', authResult.accessToken);
    localStorage.setItem('id_token', authResult.idToken);
  };

  isAuthenticated = () => {
    const accessToken = localStorage.getItem('access_token');
    return accessToken;
  };

  signinSilent = async () => {
    try {
      let user = await this.UserManager.getUser();
      if (!user) {
        user = await this.UserManager.signinSilent();
      }
      return user;
    } catch (error) {
      return false;
    }
  };

  signinSilentCallback = () => {
    this.UserManager.signinSilentCallback();
  };

  createSigninRequest = () => {
    return this.UserManager.createSigninRequest();
  };

  logout = () => {
    localStorage.setItem('logoutActionBy', 'logout');
    this.UserManager.signoutRedirect({
      id_token_hint: localStorage.getItem('id_token'),
    });
  };

  signoutRedirectCallback = () => {
    this.UserManager.signoutRedirectCallback()
      .then(() => {
        const logoutActionBy = localStorage.getItem('logoutActionBy');

        this.UserManager.clearStaleState();
        localStorage.clear();

        if (logoutActionBy && logoutActionBy === 'unauthorized') {
          window.location.replace('/unauthorized');
        } else {
          window.location.replace('/login');
        }
      })
      .catch(() => {});
  };
}
