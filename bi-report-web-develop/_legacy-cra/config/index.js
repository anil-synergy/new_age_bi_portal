import { apiurl } from './apiUrl';

const all = {
  routes: apiurl,
  redirectUrl: '/dashboard',
  apibaseurl: process.env.REACT_APP_API_BASE_URL
};

const env = {
  gql_uri: process.env.REACT_APP_GQL_URI,
  master_uri: process.env.REACT_APP_MASTER_URI,
  vessel_uri: process.env.REACT_APP_VESSEL_ENDPOINT,
  feedback: process.env.REACT_APP_FEEDBACK,
  learning_endpoint: process.env.REACT_APP_LEARNING_ENDPOINT,
  domain_app: process.env.REACT_APP_DOMAIN_APP
};
export default {
  ...all,
  ...env
};
