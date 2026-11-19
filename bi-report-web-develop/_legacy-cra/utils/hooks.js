import { useState, useEffect } from 'react';
import configProp from '../config';

export const useWindowSize = () => {
  const [windowSize, setWindowSize] = useState({
    width: undefined,
    height: undefined
  });

  useEffect(() => {
    function handleResize() {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight
      });
    }
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return windowSize;
};

export const useConfig = () => {
  const vesselId = localStorage.getItem('vesselId');
  const redirectUrl = localStorage.getItem('isVessel') === 'true' ? '/voyage-landing' : '/shore-home';

  const [config, setConfig] = useState({
    ...configProp,
    vesselId,
    redirectUrl
  });

  useEffect(() => {
    window.onstorage = () => {
      setConfig({
        ...configProp,
        vesselId: localStorage.getItem('vesselId'),
        redirectUrl: localStorage.getItem('isVessel') === 'true' ? '/voyage-landing' : '/shore-home'
      });
    };
    if (!vesselId && localStorage.getItem('isVessel') === 'true') {
      getVessel();
    }
    return () => {
      window.onstorage = null;
    };
  }, []);

  return config;
};
