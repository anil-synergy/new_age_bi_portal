import axios from './axios';

export const serviceHandler = ({ url, payload, methordType = 'get' }) => {
  return axios[methordType](`${url}`, payload)
    .then((response) => {
      if (response.status === 200) return { success: true, data: response.data };
      return { success: false };
    })
    .catch((errors) => {
      return { success: false, errors };
    });
};
