import React from 'react';
import { Link } from 'react-router-dom';

const PostLogout = () => {
  return (
    <div className="page-404" data-testid="postlogout-indicator">
      <div className="error-block">
        <p className="text-xl text-primary-100 mb-8">
          You have been logged out of the application
        </p>
        <Link to="/">
          <button className="btn-primary" type="button">
            Login
          </button>
        </Link>
      </div>
    </div>
  );
};
export default PostLogout;
