/* eslint-disable react/destructuring-assignment */

import React from 'react';

const Checkbox = ({
  field, // { name, value, onChange, onBlur }
  form, // also values, setXXXX, handleXXXX, dirty, isValid, status, etc.
  ...props
}) => {
  const { touched, errors } = form || {};

  return (
    <>
      <label className={`checkbox ${props?.className}`}>
        <input type="checkbox" {...props} {...field} />
        <span className="checkbox-box" />
        <span className="checkbox-label font-sm">{props?.label}</span>
        {touched?.[field?.name] && errors?.[field?.name] && <span className="help-text font-xs text-red-600">{errors?.[field?.name]}</span>}
      </label>
    </>
  );
};

export default Checkbox;
