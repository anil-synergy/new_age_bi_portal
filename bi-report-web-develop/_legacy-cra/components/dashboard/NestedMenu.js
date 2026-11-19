import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import chevronDown from '../../img/chevron-down.svg';
import star from '../../img/star.svg';
import mainGroupIcon from '../../images/icons/main_group_icon.svg';
import subGroupIcon from '../../images/icons/sub group_icon.svg';
import reportIcon from '../../images/icons/report_icon.svg';

const INDENT_REM = 1.25;

const getHierarchyIndentStyle = (depthSteps) => ({
  '--menu-indent': depthSteps > 0 ? `${depthSteps * INDENT_REM}rem` : '0'
});

const NestedMenuItem = ({ item, handleClick, depth = 0,
  handleFavourite, expandedMenus }) => {
  const isMainCategory = depth === 0;
  const categoryIcon = isMainCategory ? mainGroupIcon : subGroupIcon;
  const [open, setOpen] = useState(false);
  const params = useParams();
  const hasChildren = (item?.children && item?.children?.length > 0)
    || (item?.reports && item?.reports?.length > 0);

  const hasReports = item?.reports && item?.reports?.length > 0;
  const isOpen = expandedMenus?.includes(item?.categoryId);
  const onItemClick = (e) => {
    e.stopPropagation();

    if (hasChildren) {
      setOpen((prev) => !prev);
    }
  };

  useEffect(() => {
    setOpen(isOpen);
  }, [isOpen]);

  const getStarClass = (report) => {
    return `menu__star-icon${report && report.favorite ? ' starred' : ''}`;
  };
  const hierarchyIconClass = 'menu__item-icon menu__item-icon--hierarchy';
  const categoryIndentStyle = getHierarchyIndentStyle(depth);
  const reportIndentStyle = getHierarchyIndentStyle(depth + 1);
  return (
    <>
      <div
        onClick={onItemClick}
        className={open ? 'menu__list-item active' : 'menu__list-item'}
      >
        <div
          className={hierarchyIconClass}
          style={categoryIndentStyle}
        >
          <img src={categoryIcon} alt="" className="menu__hierarchy-img" />
        </div>

        <span className="menu__item-name">
          {item?.categoryName}
        </span>

        <div className="menu__item-control">
          {hasChildren && (
            <img
              src={chevronDown}
              alt=""
              className={open ? 'menu-chev-toggle' : ''}
            />
          )}
        </div>
      </div>

      {open && (
        <div>
          {hasChildren
            && item?.children?.map((child) => (
              <NestedMenuItem
                key={child.categoryId}
                item={child}
                handleClick={handleClick}
                depth={depth + 1}
                handleFavourite={handleFavourite}
                expandedMenus={expandedMenus}
              />
            ))}

          {hasReports
            && item?.reports?.map((report) => {
              const starClass = getStarClass(report);
              return (
                <div
                  key={report?.id}
                  className={
                    report?.id === params?.reportId
                      ? 'menu__list-item active'
                      : 'menu__list-item'
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClick(report?.id, report?.title);
                  }}
                >
                  <div
                    className={hierarchyIconClass}
                    style={reportIndentStyle}
                  >
                    <img src={reportIcon} alt="" className="menu__hierarchy-img" />
                  </div>
                  <span className="menu__item-name">
                    {report?.title}
                  </span>
                  <div className="menu__item-control">
                    <button
                      onClick={() => handleFavourite?.(report.id)}
                      type="button"
                      className={starClass}
                    >
                      <img src={star} className="menu__star-icon-image" alt="star" />
                    </button>
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </>
  );
};

export default NestedMenuItem;
