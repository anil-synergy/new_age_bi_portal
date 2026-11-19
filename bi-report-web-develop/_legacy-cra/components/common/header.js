/* eslint-disable import/no-cycle */
/* eslint-disable no-unused-vars */
/* eslint-disable no-unneeded-ternary */
import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import jwtDecode from 'jwt-decode';
import { Link } from 'react-router-dom';
import Logo from '../../img/Logo.png';
import cog from '../../img/cog.svg';
import settingsIcon from '../../img/settings-blue.svg';
import { myContext } from '../myContext';

const adminKey = 'System Admin';

const Header = () => {
  const [showMenu, setShowMenu] = useState(false);
  const [character, setCharacter] = useState('');
  const [userName, setuserName] = useState('');
  const buttonRef = useRef('');

  const { isDepAdmin, isSuperAdmin } = useContext(myContext);

  const token = localStorage.getItem('access_token');
  const { first_name: firstName,
    last_name: lastName, name: fullname,
    given_name: ifirstName,
    family_name: ilastName } = jwtDecode(token) || {};

  const handleLogout = (e) => {
    if (buttonRef.current && !buttonRef.current.contains(e.target)) {
      setShowMenu(false);
    } else {
      setShowMenu(true);
    }
  };

  useEffect(() => {
    document.addEventListener('click', handleLogout, false);
    return () => {
      document.removeEventListener('click', handleLogout, false);
    };
  }, []);

  useEffect(() => {
    let string = '';
    if (firstName) {
      string = `${firstName?.charAt(0)}${lastName?.charAt(0)}`;
      setCharacter(string);
      setuserName(`${firstName} ${lastName}`);
    } else if (fullname) {
      const nameArray = fullname.split(' ');
      string = nameArray.map((item) => item?.charAt(0));
      // string = `${nameArray?.[0]?.charAt(0)}${nameArray?.[1]?.charAt(0)}`;
      setCharacter(string?.slice(0, 2)?.join(''));
      setuserName(fullname);
    } else if (ifirstName) {
      string = `${ifirstName?.charAt(0)}${ilastName?.charAt(0)}`;
      setCharacter(string);
      setuserName(`${ifirstName} ${ilastName}`);
    }
  }, [firstName, lastName, fullname, ifirstName, ilastName]);

  return (
    <>
      {/*
      <header className="header">
        <div className="header__left">
          <div className="header__logo">
            <img src={Logo} alt="synergy-emblem" srcSet="" />
            <h3 className="uppercase">
              {reportName || 'BI Reports'}
              {' '}
            </h3>
          </div>
        </div>
        <div className="header__right">
          <button type="button" className="header__settings">
            <img src={cog} alt="" />
          </button>
          <div className="header__vLine vLine" />

          <button ref={buttonRef} onClick={handleLogout}
           type="button" className="header__user relative context-menu-wrap">
            <div className="header__user-name">
              {fullname ? fullname : `${firstName} ${lastName}`}
            </div>
            <div className="header__user-initials uppercase">
              {character}
            </div>
            {showMenu && (
              <div className="context-menu">
                <a
                  href="/logout"
                  // key="logout"
                  className="context-menu__link"
                >
                  Logout
                </a>
              </div>
            )}
          </button>

        </div>
      </header> */}

      <div className="sidebar__user">
        <div title={userName} className="user-dp">
          {character}
        </div>
        <button type="button" ref={buttonRef} onClick={handleLogout} className="user-settings context-menu-wrap relative">
          <img alt="settingsIcon" src={settingsIcon} />
          {showMenu && (
            <div className="context-menu">
              {((isDepAdmin && isSuperAdmin) || isSuperAdmin || isDepAdmin) && (
                <>
                  <Link to="/admin/users" className="context-menu__link">
                    Admin
                  </Link>

                  <Link to="/dashboard" className="context-menu__link">
                    Reports
                  </Link>
                </>
              )}
              <a
                href="/logout"
                // key="logout"
                className="context-menu__link"
              >
                Logout
              </a>
            </div>
          )}
        </button>
      </div>
    </>
  );
};

export default Header;
