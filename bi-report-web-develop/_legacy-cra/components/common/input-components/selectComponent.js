/* eslint-disable import/no-unresolved */
/* eslint-disable react/destructuring-assignment */

import React from 'react';
import Select from 'react-select';

const SelectComponent = ({
  field, // { name, value, onChange, onBlur }
  form, // also values, setXXXX, handleXXXX, dirty, isValid, status, etc.
  ...props
}) => {
  const { errors, setFieldValue } = form || {};

  const handleChange = (event) => {
    setFieldValue(field?.name, event);
  };

  return (
    <>
      <div className={props?.wrapperClassName}>
        <div className="input-item">
          {props.label && <label>{props?.label}</label>}
          <Select
            {...props}
            {...field}
            onChange={handleChange}
            className="react-select-wrapper"
            // menuPosition="fixed"
            // menuIsOpen
            menuPlacement="auto"
            menuPortalTarget={document.body}
            classNamePrefix="react-select"
          />
          {errors?.[field?.name] && <div className="error">{errors?.[field?.name]}</div>}
        </div>
      </div>
    </>
  );
};

export default SelectComponent;
