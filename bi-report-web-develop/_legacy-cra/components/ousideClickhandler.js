import { useEffect } from 'react';

const useOutsideAlerter = (ref, state, setState) => {
  useEffect(() => {
    /**
     * changes state if clicked on outside of element
     */
    function handleClickOutside(event) {
      if (state) {
        if (ref.current && !ref.current.contains(event.target)) {
          setState(false);
        }
      }
    }
    // Bind the event listener
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      // Unbind the event listener on clean up
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [ref, state, setState]);
};

export default useOutsideAlerter;
