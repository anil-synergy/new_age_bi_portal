/* eslint-disable import/no-cycle */
import React, { useContext, useEffect, useMemo, useState } from 'react';
import { useHistory, useParams } from 'react-router-dom';
import star from '../../img/star.svg';
import iconUsers from '../../img/ico-users.svg';
import iconReports from '../../img/ico-reports.svg';
import iconGroup from '../../img/ico-group.svg';
import iconCategory from '../../img/ico-category.svg';
import SearchBar from './searchBar';
import MenuListItem from '../dashboard/menuListItem';
import MenuGroup from './menuGroup';
import { myContext } from '../myContext';
import axios from '../../utils/axios';
import Settings from './header';
import { filterMenuTree, filterStarredReports } from '../../utils/menuSearch';

const SideBar = () => {
  const [starred, setStarred] = useState([]);
  const [menuInitialized, setMenuInitialized] = useState(false);
  const [showSideBar, setshowSideBar] = useState(true);
  const [searchString, searchStringState] = useState('');
  const [isAdmin, setisAdmin] = useState(false);
  const [searchClose, setsearchClose] = useState(true);
  const [expandedMenus, setExpandedMenus] = useState([]);
  const { getReport, originalMenuData, reportId, fetchMenuData
  } = useContext(myContext);

  const params = useParams();
  const history = useHistory();
  const handleSideBar = () => {
    setshowSideBar(!showSideBar);
  };

  const sidebarBorder = (window.location.href.includes('/dashboard') && !params?.reportId);

  const handleFavourite = async (Id) => {
    const data = await axios.put(`/bi-report-api/v1/report/favoriteReport?reportId=${Id}`);
    if (data?.data) {
      const favoriteData = data?.data.filter((item) => item.favorite);
      setStarred(favoriteData);
      fetchMenuData();
    }
  };
    // const setDefaultId = (arr = []) => {
  //   if (arr?.length && history?.location?.pathname?.includes('dashboard')) {
  //     getReport(arr[0]?.id);
  //     setreportName(arr[0]?.title);
  //   }
  // };

  useEffect(() => {
    if (history?.location?.pathname?.includes('admin')) {
      setisAdmin(true);
    } else {
      setisAdmin(false);
    }
  }, [history]);

  const getStarredReports = (categories) => {
    return categories.flatMap((category) => [
      ...(category.reports?.filter((r) => r.favorite) || []),
      ...(category.children?.length
        ? getStarredReports(category.children)
        : [])
    ]);
  };
  const findReportPath = (categories, Id, path = []) => {
    const result = categories
      .map((category) => {
        const newPath = [...path, category.categoryId];
        const hasReport = category.reports?.some(
          (r) => r.id === Id
        );

        if (hasReport) return newPath;
        if (category.children?.length) {
          return findReportPath(category.children, Id, newPath);
        }
        return null;
      })
      .find(Boolean);

    return result || null;
  };

  useEffect(() => {
    if (originalMenuData?.length > 0 && !menuInitialized) {
      const hasStarred = getStarredReports(originalMenuData);
      if (params?.reportId) {
        const path = findReportPath(originalMenuData, params.reportId);
        if (path) {
          setExpandedMenus(path);
        }
        getReport(params?.reportId);
      }
      setStarred(hasStarred);
      setMenuInitialized(true);
    }
  }, [originalMenuData, params?.reportId, menuInitialized]);

  const handleSearch = (e) => {
    searchStringState(e.target.value);
  };

  const handleSearchToggle = () => {
    if (searchClose) {
      setsearchClose(false);
    } else {
      searchStringState('');
      setsearchClose(true);
    }
  };

  const filteredMenuData = useMemo(
    () => filterMenuTree(originalMenuData, searchString),
    [originalMenuData, searchString]
  );

  const displayedStarred = useMemo(
    () => filterStarredReports(starred, searchString),
    [starred, searchString]
  );

  const menusToExpand = useMemo(() => {
    if (searchString.trim()) {
      return [];
    }
    return expandedMenus;
  }, [searchString, expandedMenus]);

  const handleManageUsers = () => {
    history.push('/admin/users');
  };

  const handleManageReports = () => {
    history.push('/admin/reports');
  };

  const handleGroups = () => {
    history.push('/admin/groups');
  };

  const handleCategories = () => {
    history.push('/admin/categories');
  };

  const getClassName = (item) => {
    const { pathname } = history?.location || {};
    if (pathname === '/admin/users' && item === 'users') {
      return 'menu__list-item active';
    }
    if (pathname === '/admin/reports' && item === 'reports') {
      return 'menu__list-item active';
    }
    if (pathname === '/admin/groups' && item === 'groups') {
      return 'menu__list-item active';
    }
    if (pathname === '/admin/categories' && item === 'categories') {
      return 'menu__list-item active';
    }
    return 'menu__list-item';
  };
  return (
    <div className={`${showSideBar ? sidebarBorder ? 'sidebar border-0' : 'sidebar' : 'sidebar collapsed'}`}>
      {history?.location?.pathname?.includes('admin') ? (
        <SearchBar sidebarTitle="Admin Portal" sidebarHeading {...{ handleSideBar }} />
      ) : (
        <SearchBar sidebarTitle="BI Portal" searchBar {...{ searchClose, handleSearchToggle, handleSideBar, handleSearch, searchString }} />
      )}
      <div className="menu custom-scroll ">
        {isAdmin ? (
          <div className="menu__group">
            <div className="menu__list">
              <MenuListItem {...{ icon: iconUsers, title: 'Manage Users', className: getClassName('users'), handleClick: handleManageUsers }} />
            </div>
            <div className="menu__list">
              <MenuListItem
                {...{ icon: iconReports, title: 'Manage Reports', className: getClassName('reports'), handleClick: handleManageReports }}
              />
            </div>
            <div className="menu__list">
              <MenuListItem {...{ icon: iconGroup, title: 'User Groups', className: getClassName('groups'), handleClick: handleGroups }} />
            </div>
            <div className="menu__list">
              <MenuListItem {...{ icon: iconCategory, title: 'Department / Categories', className: getClassName('categories'), handleClick: handleCategories }} />
            </div>
          </div>
        ) : (
          <>
            {displayedStarred.length > 0 && (
              <div className="menu__group">
                <div className="menu__group-head">Starred</div>
                {displayedStarred.map((item) => (
                  <MenuListItem {...{ ...item, className: item?.id === params?.reportId ? 'menu__list-item active' : 'menu__list-item', handleClick: getReport }}>
                    <button onClick={() => handleFavourite(item?.id)} type="button" className="menu__star-icon">
                      <img src={star} alt="" srcSet="" />
                    </button>
                  </MenuListItem>
                ))}
              </div>
            )}
            <div className="menu__group">
              {filteredMenuData.length > 0 && <div className="menu__group-head">Reports</div>}
              <div className="menu__list">
                <MenuGroup
                  originalMenuData={filteredMenuData}
                  getReport={getReport}
                  reportId={reportId}
                  handleFavourite={handleFavourite}
                  expandedMenus={menusToExpand}
                />
              </div>
            </div>
          </>
        )}
      </div>

      <Settings />
    </div>
  );
};

export default SideBar;
