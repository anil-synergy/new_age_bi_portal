import React from 'react';

const MenuListItem = ({ id, icon, title, children, handleClick, className }) => {
  return (
    // eslint-disable-next-line jsx-a11y/anchor-is-valid
    <div onClick={() => handleClick(id, title)} className={className}>
      {icon && (
        <div className="menu__item-icon">
          <img src={icon} alt="" />
        </div>
      )}
      <span className="menu__item-name">{title}</span>
      {/* <button type="button"
      onClick={() => handleClick(id, title)} className="menu__item-name">{title}</button> */}
      <div className="menu__item-control">
        {children}
      </div>
    </div>
  );
};

export default MenuListItem;
