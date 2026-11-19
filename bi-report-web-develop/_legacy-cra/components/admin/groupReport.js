import React, { useState, useEffect } from 'react';

const GroupReport = (props) => {
  const { setShowReport, currentReports } = props;

  const [data, setData] = useState();

  const getItem = (x, i, arr) => {
    if (i < (arr?.length) - 1) {
      return `${x}, `;
    }
    return x;
  };

  useEffect(() => {
    currentReports?.map((item) => {
      return item?.assignedRlsRoles?.map((itemTwo) => {
        return setData(itemTwo);
      });
    });
  }, [currentReports]);

  return (
    <>
      <form className="modal-form">
        {currentReports?.length
          ? (
            <div className="modal-listing">
              <div className="access-table">
                <div className="access-table__head">
                  <div className="access-table__row">
                    <div className="access-table__cell">Report Name</div>
                    {data?.length && <div className="access-table__cell">RLS Roles</div>}
                    <div className="access-table__cell" />
                  </div>
                </div>
                <div className="access-table__body">
                  {currentReports?.map((item) => (
                    <div className="access-table__row">
                      <div className="access-table__cell">{item?.reportName}</div>
                      <div className="access-table__cell">
                        {item?.assignedRlsRoles
                          && item?.assignedRlsRoles.map((x, i, arr) => {
                            return (
                              <span>
                                {getItem(x, i, arr)}
                              </span>
                            );
                          })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <span className="center-message">No Reports Found</span>
          )}
        <div className="modal-box__btn-wrap">
          <div className="modal-box__btn-group">
            <button onClick={() => setShowReport(false)} type="button" className="btn-secondary btn-md">
              Close
            </button>
          </div>
        </div>
      </form>
    </>
  );
};

export default GroupReport;
