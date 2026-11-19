import React, { useState, useEffect } from 'react';
import { ClipLoader } from 'react-spinners';

const Redirecting = () => {
  const [timer, setTimer] = useState(false);

  const geturl = () => {
    window.location.replace('/unauthorized');
  };

  useEffect(() => {
    setTimeout(() => setTimer(true), 3000);
  }, [timer]);

  return (
    <>
      {timer
        ? (
          geturl()
        ) : (
          <div className="loader">
            <ClipLoader loading color="#333869" />
          </div>
        )}
    </>
  );
};
export default Redirecting;
