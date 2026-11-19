import { isCheifOfficer, isMaster, isShoreSuperindentant } from '../components/stowageLanding/roleIdentification';

export const cleanObject = (obj) => {
  const cleaned = { ...obj };
  Object.keys(cleaned).forEach((key) => {
    if (!cleaned[key]) delete cleaned[key];
  });
  return cleaned;
};

export const getStatus = (status) => {
  if (status === 'Completed') return 'green';
  if (status === 'InProgress') return 'amber';
  return 'red';
};

export const getStatusColor = (status) => {
  let color = 'red';
  if (status === 'Pending') color = 'amber';
  else if (status === 'Complete') color = 'green';
  return color;
};

export const getRandomNumber = () => {
  return Math.floor(100000 + Math.random() * 900000);
};

const foo = (p) => {
  return p.toString() === '[object SafariRemoteNotification]';
};

export const isSafari = () => {
  return /constructor/i.test(window.HTMLElement) || foo(!window.safari || (typeof safari !== 'undefined' && window.safari.pushNotification));
};
export const downloadFile = (fileUrl, filename) => {
  const element = document.createElement('a');
  if (typeof element.download !== 'undefined') {
    element.setAttribute('href', fileUrl);
    element.setAttribute('download', filename);
    element.setAttribute('target', '_blank');
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
  } else {
    // browser not support download attribute

    window.location.assign(
      window.location.href.split(window.location.hash)[0] + fileUrl
    );
  }
  document.body.removeChild(element);
};
export const replaceJSX = (str = '', find, replace) => {
  const parts = str.split(find);
  const result = [];
  for (let i = 0; i < parts.length; i += 1) {
    result.push(parts[i]);
    result.push(replace);
  }
  return result;
};
export const getcargoStatus = (item) => {
  if (item.completionStatus === 0) return 'red';
  if (item.completionStatus === 1) return 'amber';
  if (item.completionStatus === 2) return 'green';
  return null;
};

export const getSessionData = (key) => {
  return sessionStorage.getItem(key) && sessionStorage.getItem(key) !== 'undefined' ? JSON.parse(sessionStorage.getItem(key)) : {};
};

export const makeFirstLetterSmall = (string) => {
  return string.charAt(0).toLowerCase() + string.slice(1);
};
export const trimObjValues = (obj) => {
  return Object.keys(obj).reduce((acc, curr) => {
    const formattedData = obj[curr] !== null && obj[curr] !== undefined
      ? obj[curr].toString().trim() : obj[curr];
    acc[curr] = formattedData === '' ? null : formattedData;
    return acc;
  }, {});
};

export const deepReplaceEmptySpaceWithNull = (objectOrArray) => {
  if (Array.isArray(objectOrArray)) {
    objectOrArray.forEach((item) => {
      if ((typeof item === 'object' && item !== null) || Array.isArray(item)) {
        deepReplaceEmptySpaceWithNull(item);
      }
    });
  } else {
    Object.keys(objectOrArray).forEach((key) => {
      if (Array.isArray(objectOrArray[key])
        || (typeof objectOrArray[key] === 'object' && objectOrArray[key] !== null)) {
        deepReplaceEmptySpaceWithNull(objectOrArray[key]);
      } else if (objectOrArray[key] === '' || objectOrArray === 'undefined') {
        // eslint-disable-next-line
        objectOrArray[key] = null;
      }
    });
  }
};
export const isNumeric = (n) => {
  // eslint-disable-next-line no-restricted-globals
  return !isNaN(parseFloat(n)) && isFinite(n);
};

export const enableCargoComments = (status, bar) => {
  if (
    (isMaster() && status?.vesselStatus === 1)
    || (isShoreSuperindentant() && status?.shoreStatus === 1)
  ) {
    return true;
  }
  if (isCheifOfficer() && status?.vesselStatus > 1) {
    return bar?.hasComments;
  }
  return false;
};

export const isCargoPlanEditable = (status) => {
  if (isCheifOfficer()) {
    if (status
      && status.isAmended
      && !(
        (status?.vesselStatus === 0 && status?.shoreStatus === 0)
        || (status?.vesselStatus === 2 && status?.shoreStatus === 0)
        || (status?.vesselStatus === 3 && status?.shoreStatus === 2)
      )
    ) {
      return false;
    }
    if (status
      && !(status?.vesselStatus === 1 || status?.shoreStatus === 1)
    ) {
      return true;
    }
  }
  return false;
};

export const cargoPlanHasComments = (status, parcelId, section) => {
  let flag = {};
  if (status?.length) {
    const commentStatus = status.find((item) => item.parcelId === parcelId);
    if (commentStatus) {
      flag = commentStatus[section];
    }
  }
  return flag;
};
export const getFileName = (path = '') => {
  // eslint-disable-next-line no-useless-escape
  return path.replace(/^.*[\\\/]/, '');
};
