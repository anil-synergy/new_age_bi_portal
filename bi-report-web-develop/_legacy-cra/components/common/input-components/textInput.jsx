/* eslint-disable no-unused-vars */
/* eslint-disable react/destructuring-assignment */

import React from 'react';

const InputText = ({
  field, // { name, value, onChange, onBlur }
  form, // also values, setXXXX, handleXXXX, dirty, isValid, status, etc.
  errormessage,
  ...props
}) => {
  const { touched, errors } = form || {};
  return (
    <div className={props?.wrapperClassName}>
      <div className="input-item input-textfield required">
        {props.label && <label>{props?.label}</label>}

        {/* <input  value={value} type={`${type || 'text'}`}
        placeholder={placeholder} data-size={size || null} readOnly={readonly} /> */}

        <input type="text" {...field} {...props} />
        {errormessage
          ? (<span className="help-text text-red-600">{errormessage}</span>)
          : touched?.[field?.name] && errors?.[field?.name] && <div className="help-text text-red-600 font-xs">{errors?.[field?.name]}</div>}
      </div>
    </div>
  );
};

export default InputText;
