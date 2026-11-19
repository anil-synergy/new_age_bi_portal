import axios from 'axios';

/**
 * This performRequest function is used to call the service using axios
 * @param {*} method - The HTTP Request Methods
 * @param {*} url - The endpoint url
 * @param {*} headers - The  HTTP headers
 * @param {*} params - The Parameters to be passed for the request
 * @returns - Response of the axios request
 */
export const performRequest = (method, url, params) => {
  const body = method === 'get' ? 'params' : 'data';
  const accessToken = localStorage.getItem('access_token');

  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    Authorization: `Bearer ${accessToken}`
  };

  const config = {
    method,
    url,
    baseURL: process.env.REACT_APP_API_BASE_URL,
    headers,
    [body]: params || {}
  };

  return axios.request(config);
};
