import * as React from 'react';
import Select, { components } from 'react-select';
import Caret from '../../../images/icons/dropdown-icon.svg';

const DropdownIndicator = (props) => {
  return (
    <components.DropdownIndicator {...props}>
      <img src={Caret} alt="" />
    </components.DropdownIndicator>
  );
};

const ClearIndicator = (props) => {
  return <components.ClearIndicator {...props} className="cursor-pointer" />;
};

const Menu = (props) => {
  const { children, className, ...rest } = props;
  return <components.Menu {...rest}>{children}</components.Menu>;
};

export const DropDown = (props) => {
  const { id, label, allowMultiple, allowClearValues, size, className, haserror,
    isDisabled, required, isBoldLable, errormessage, ...rest } = props;

  const getLabelColor = () => {
    if (isDisabled) return 'text-gray-100 ';
    return haserror ? 'text-red-600 ' : ' text-gray-500 ';
  };

  const getRequiredSymbolColor = () => {
    return isDisabled ? 'text-gray-100' : 'text-red-600';
  };

  return (
    //  toggle "required/disabled" along with input-item to have the error class and disabled state
    <div className={`input-item ${errormessage ? 'required' : ''}`}>
      {label && (
        <label htmlFor={id} className={`${getLabelColor()}`}>
          {label}
          {required ? <span className={`${getRequiredSymbolColor()}`}>*</span> : null}
        </label>
      )}
      <Select
        aria-label={label}
        {...rest}
        isMulti={allowMultiple}
        isClearable={allowClearValues}
        isDisabled={isDisabled}
        className="react-select-wrapper"
        classNamePrefix="react-select"
        menuPortalTarget={document.body}
        components={{
          DropdownIndicator,
          ClearIndicator,
          Menu
        }}
      />
      {errormessage && <span className="help-text text-red-600">{errormessage}</span>}
    </div>
  );
};
export default DropDown;
