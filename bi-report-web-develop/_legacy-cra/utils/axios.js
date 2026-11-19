import axios from 'axios';
import jwtDecode from 'jwt-decode';
import { UserManager, WebStorageStateStore } from 'oidc-client';
import { AzureADConfigConstants } from '../components/auth/authConstants';
import showAlert from './alert';
import configs from '../config';

axios.defaults.baseURL = configs.apibaseurl;

const isTokenExpired = (token) => {
  if (!token) return true;
  try {
    const decoded = jwtDecode(token);
    // exp is in seconds, Date.now() is in ms. Buffer of 5 seconds.
    return (decoded.exp * 1000) < (Date.now() + 5000);
  } catch (e) {
    return true;
  }
};

let refreshTokenPromise = null;

const getSilentUserManager = () => new UserManager({
  ...AzureADConfigConstants,
  userStore: new WebStorageStateStore({ store: window.localStorage }),
});

axios.interceptors.request.use(
  async (config) => {
    let token = localStorage.getItem('access_token');

    // Check expiration before sending request
    if (token && isTokenExpired(token)) {
      if (!refreshTokenPromise) {
        const mgr = getSilentUserManager();
        refreshTokenPromise = mgr.signinSilent().then((user) => {
          refreshTokenPromise = null;
          return user;
        }).catch((e) => {
          refreshTokenPromise = null;
          throw e;
        });
      }

      try {
        const user = await refreshTokenPromise;
        token = user.access_token;
        localStorage.setItem('access_token', token);
        if (user.id_token) localStorage.setItem('id_token', user.id_token);
      } catch (e) {
        localStorage.removeItem('access_token');
        window.location.replace('/login');
        return Promise.reject(new Error('Token is expired and refresh failed. Redirecting to login.'));
      }
    }

    const auth = { headers: {} };
    auth.headers.Authorization = `Bearer ${token}` || null;
    return { ...config, ...auth };
  },
  (error) => {
    return error;
  }
);

axios.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    if (error.response) {
      switch (error.response.status) {
        case 500:
          showAlert('Internal Server Error', 'error');
          break;
        case 402:
          showAlert(error.response.data);
          break;
        case 401:
          if (localStorage.getItem('access_token')) {
            window.location.replace('/redirecting');
          } else {
            window.location.replace('/login');
          }
          break;
        case 404:
          showAlert('Something went wrong.', 'error');
          break;
        case 400: {
          window.location.replace('/access-denied');
          break;
        }
        case 422:
          showAlert(`${error.response.data.Message} ${error.response.data.ReferenceCode ? `(# ${error.response.data.ReferenceCode})` : ''}`, 'error');
          break;
        case 403: {
          window.location.replace('/access-denied');
          break;
        }
        case 200: {
          break;
        }
        case 201: {
          break;
        }
        case 202: {
          break;
        }
        default:
          showAlert('Something went wrong, Please check your network connectivity', 'error');
          break;
      }
    }

    return Promise.reject(error);
  }
);

export default {
  get: axios.get,
  post: axios.post,
  put: axios.put,
  patch: axios.patch,
  delete: axios.delete,
  all: axios.all,
  spread: axios.spread
};
