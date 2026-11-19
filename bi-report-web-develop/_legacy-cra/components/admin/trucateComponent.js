import React, { useEffect, useState } from 'react';

const limit = 1;

const TrucateComponent = ({ items }) => {
  const [visibleList, setvisibleList] = useState([]);

  const [leftover, setleftover] = useState(null);

  useEffect(() => {
    if (items?.length > limit) {
      setvisibleList(items?.slice()?.splice(0, limit));
      setleftover(items?.slice()?.splice(-limit));
    } else {
      setvisibleList(items);
    }
  }, [items]);

  return (
    <>
      {visibleList
        && visibleList.map(({ id, name }) => (
          <span key={id} className="text-grey-800">
            {name}
            {leftover && (
              <>
                <>&#8230;</>
                <span className="font-xs f-bold">{' More'}</span>
              </>
            )}
          </span>
        ))}
    </>
  );
};

export default TrucateComponent;
