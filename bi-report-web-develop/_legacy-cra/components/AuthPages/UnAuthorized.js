import React from 'react';
import { Link } from 'react-router-dom';
import errorUnauthorised from '../../img/unauthorised.svg';

const UnAuthorized = () => {
  return (
    <div className="error-wrap" data-testid="unauthorized-indicator">
      <img src={errorUnauthorised} alt="" />
      <div className="error-wrap__title font-xl f-bold">You do not have permission to access the requested page!</div>
      <p className="font-lg">
        To get access please contact the site administrator or
        {' '}
        <Link to="/logout" className="link f-bold font-md">
          Login as different user
        </Link>
      </p>
    </div>
  );
};
export default UnAuthorized;
