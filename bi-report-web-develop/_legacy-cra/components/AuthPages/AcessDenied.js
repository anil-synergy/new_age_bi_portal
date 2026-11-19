import React from 'react';
import { Link } from 'react-router-dom';
import graphics403 from '../../img/graphics403.svg';

const AcessDenied = () => {
  return (
    <div className="error-wrap error-403">
      <img src={graphics403} alt="" />
      <div className=" title font-xl f-bold ">Access Denied!</div>
      <span className="link f-semi font-md">
        <Link className="link" to="/dashboard">
          Go to Dashboard
        </Link>
      </span>
    </div>
  );
};

export default AcessDenied;
