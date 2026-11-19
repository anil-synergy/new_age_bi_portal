import React from 'react';
import ReactDOM from 'react-dom';
// import './styles/tailwind.css';
import { ToastContainer } from 'react-toastify';
import reportWebVitals from './reportWebVitals';
import App from './App';
import { AuthProvider } from './components/providers/AuthProvider';
import 'react-toastify/dist/ReactToastify.css';
// import './styles/index.css';
// import './styles/common.scss';
// import './index.css';

// comment

import './scss/styles/scss/main.scss';

ReactDOM.render(
  <AuthProvider>
    <ToastContainer />
    <App />
  </AuthProvider>,
  document.getElementById('root')
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
