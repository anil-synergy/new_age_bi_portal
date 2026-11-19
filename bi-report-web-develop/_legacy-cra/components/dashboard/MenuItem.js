import React, { useState } from "react";
import chevronDown from "../../img/chevron-down.svg";

const NestedMenuItem = ({ item, handleClick, icon }) => {
  const [open, setOpen] = useState(false);
  const hasChildren = item?.children && item.children.length > 0;
  const hasReports = item?.reports && item.reports.length > 0;

  const onItemClick = (e) => {
    e.stopPropagation();
    handleClick(item?.categoryId, item?.categoryName);
    if (hasChildren) {
      setOpen((prev) => !prev);
    }
  };

  return (
    <div>
      <div onClick={onItemClick} className="menu__list-item">
        {icon && (
          <div className="menu__item-icon">
            <img src={icon} alt="" />
          </div>
        )}
        <span className="menu__item-name">
          {item?.categoryName}
        </span>
        <div className="menu__item-control">
          {hasChildren && (
            <img
              src={chevronDown}
              alt=""
              className={open ? "menu-chev-toggle" : ""}
            />
          )}
        </div>
      </div>
      {open && (
        <div style={{ paddingLeft: "20px" }}>
          {hasChildren &&
            item.children.map((child) => (
              <NestedMenuItem
                key={child.categoryId}
                item={child}
                handleClick={handleClick}
              />
            ))}
          {hasReports &&
            item.reports.map((report) => (
              <div
                key={report.id}
                className="menu__list-item"
                style={{ paddingLeft: "10px" }}
                onClick={(e) => {
                  e.stopPropagation();
                  handleClick(report.reportId, report.title);
                }}
              >
                <span className="menu__item-name">{report.title}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
};

export default NestedMenuItem;