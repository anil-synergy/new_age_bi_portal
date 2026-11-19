import React, { createContext } from 'react';
import styles from './index.module.scss';

export const AppContext = createContext({});

const NavLayout = (props) => {
  const { children } = props;

  return (
    <div className="min-h-screen" data-testid="layout-indicator">
      {/* <a
        href="/logout"
        // key="logout"
        className="block text-white normal-case
         font-medium text-sm text-left leading-normal px-3 py-1"
      >
        Logout
      </a> */}
      <main className={`${styles.main_transition} flex-grow flex-1 text-2xl`}>
        <AppContext.Provider>{children}</AppContext.Provider>
      </main>
    </div>
  );
};
export default NavLayout;
