import React from 'react';
import Select from 'react-select';
// import InputText from './input-components/textInput';

const Pagination = ({ currentPage, totalPage,
  handleCurrentPage, isNextDisabled, isPreviousDisabled, pageSize, setpageSize, options }) => {
  const handleChange = (event) => {
    setpageSize(event);
  };

  return (
    <div className="table-pagination">
      <button type="button" disabled={isPreviousDisabled} className="btn-blue btn-sm" onClick={() => handleCurrentPage(currentPage - 1)}>
        Previous
      </button>
      {/* <InputText value={currentPage} type="text"
      wrapperClassName="pagination-number" size="small" /> */}
      <span className="f-bold font-sm">
        {currentPage}
        {' '}
        of
        {' '}
        {totalPage}
        {' '}
      </span>

      <div className="pagination-select">
        <div className="input-item">
          <Select
            className="react-select-wrapper"
            classNamePrefix="react-select"
            {...{ options, pageSize, setpageSize, onChange: handleChange, value: pageSize, menuPlacement: 'top', menuPosition: 'fixed' }}
          />
        </div>
      </div>

      <button type="button" className="btn-blue btn-sm" onClick={() => handleCurrentPage(currentPage + 1)} disabled={isNextDisabled}>
        Next
      </button>
    </div>
  );
};

export default Pagination;
