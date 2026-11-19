/* eslint-disable spaced-comment */
import React from 'react';
import { useHistory } from 'react-router-dom';
import config from '../../config';
import graphics404 from '../../img/error-graphics.svg';

const NoPageFound = () => {
  const history = useHistory();

  const goHome = () => {
    const token = localStorage.getItem('access_token');
    if (token) {
      const { redirectUrl } = config;
      history.push(redirectUrl);
    } else {
      history.push('/login');
      sessionStorage.clear();
      localStorage.clear();
    }
  };

  return (
    <div className="error-wrap">
      <img src={graphics404} alt="" />
      <div className="error-wrap__title font-xl f-bold">Oops! Page not found</div>
      <p className="font-lg">The page you&#39;re looking for doesn&#39;t exist</p>
      <button type="button" className="f-semi link" onClick={goHome} data-testid="goHome">
        Take me Home
      </button>
    </div>
  );
};
export default NoPageFound;
