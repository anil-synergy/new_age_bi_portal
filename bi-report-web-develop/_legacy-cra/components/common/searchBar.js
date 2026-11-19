import React from 'react';
import chevronLeft from '../../img/chevron-left.svg';
import synergyWhite from '../../img/synergy-emblem-white.svg';
import iconSearch from '../../img/search.svg';
import iconClose from '../../img/ico-close.svg';

const SearchBar = ({ handleSideBar, searchClose, handleSearchToggle,
  handleSearch, searchString, searchBar, sidebarTitle }) => {
  return (
    <div className="sidebar__head">
      <div className="sidebar__sub-head">
        <a href="/dashboard" className="sidebar__logo">
          <img src={synergyWhite} alt="" />
        </a>
        <div className="sidebar__title font-lg f-bold text-secondary-400">{sidebarTitle}</div>
        {searchBar && (
          <button type="button" onClick={handleSearchToggle} className="sidebar__search-toggle search-toggle">
            {searchClose
              ? <img src={iconSearch} alt="" />
              : <img src={iconClose} alt="" />}
          </button>
        )}
      </div>

      {/* this search bar should come when you click on the search-toggle button */}
      {!searchClose && searchBar && (
        <div className="sidebar__search">
          <input value={searchString} onChange={handleSearch} className="sidebar__search-input" placeholder="Search" />
        </div>
      )}

      <div className="sidebar__control">
        <div className="hr" />
        <button type="button" onClick={handleSideBar} className="collapseBtn">
          <img src={chevronLeft} alt="" />
        </button>
      </div>
    </div>
  );
};

export default SearchBar;
