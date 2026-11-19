import React, { useEffect, useState } from 'react';
import NestedMenuItem from '../dashboard/NestedMenu';

const MenuGroup = ({ originalMenuData, getReport, reportId, handleFavourite, expandedMenus }) => {
  const handleClick = (id, title) => {
    getReport(id, title);
  };
  const [data, setData] = useState([]);
  useEffect(() => {
    setData(originalMenuData);
  }, [originalMenuData]);
  return (
    <>
      <div>
        {data.map((item) => (
          <NestedMenuItem
            key={item.categoryId}
            item={item}
            handleClick={handleClick}
            reportId={reportId}
            handleFavourite={handleFavourite}
            expandedMenus={expandedMenus}
          />
        ))}
      </div>
    </>
  );
};

export default MenuGroup;
