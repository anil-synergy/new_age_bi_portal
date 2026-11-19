/* eslint-disable react/jsx-wrap-multilines */
/* eslint-disable react/react-in-jsx-scope */
/* eslint-disable jsx-a11y/alt-text */
export const RightColumns = [
  {
    Header: 'NAME',
    accessor: 'crewName',
    sortType: 'basic'
  },
  {
    Header: 'RANK',
    accessor: 'rank',
    sortType: 'basic'
  },
  {
    Header: 'VESSEL',
    accessor: 'vesselName',
    sortType: 'basic'
  },
  {
    Header: 'TYPE',
    accessor: 'surveyType',
    sortType: 'basic'
  },
  {
    Header: 'SIGN-ON',
    accessor: 'signOnDate',
    sortType: 'basic'
  },
  {
    Header: 'SIGN-OFF',
    accessor: 'signOffDate',
    sortType: 'basic'
  },
  {
    Header: 'TAG',
    accessor: 'feedbackTag',
    sortType: 'basic'
  },
  {
    Header: 'MOBILE',
    accessor: 'phoneNo',
    sortType: 'basic'
  },
  {
    Header: 'RESPONDED',
    accessor: 'responseAt',
    sortType: 'basic'
  },
  {
    Header: 'STATUS',
    accessor: 'status',
    sortType: 'basic'
  }
];

export const LeftColumns = [
  {
    Header: 'NAME',
    accessor: 'crewName',
    sortType: 'basic'
  },
  {
    Header: 'RANK',
    accessor: 'rank',
    sortType: 'basic'
  },
  {
    Header: 'VESSEL',
    accessor: 'vesselName',
    sortType: 'basic'
  },
  {
    Header: 'TYPE',
    accessor: 'surveyType',
    sortType: 'basic'
  },
  {
    Header: 'RESPONDED',
    accessor: 'responseAt',
    sortType: 'basic'
  },
  {
    Header: 'STATUS',
    accessor: 'status',
    sortType: 'basic'
  }
];

export const MinimumColumns = [
  {
    Header: 'Name',
    accessor: 'crewName',
    sortType: 'basic'
  },
  {
    Header: 'RANK',
    accessor: 'rank',
    sortType: 'basic'
  },
  {
    Header: 'TYPE',
    accessor: 'surveyType',
    sortType: 'basic'
  },
  {
    Header: 'STATUS',
    accessor: 'status',
    sortType: 'basic'
  }
];
export const dropdownStyle = {
  menuList: (base) => ({
    ...base,
    '::-webkit-scrollbar': {
      width: '4px',
      height: '0px'
    },
    '::-webkit-scrollbar-track': {
      background: '#f1f1f1'
    },
    '::-webkit-scrollbar-thumb': {
      background: '#888'
    },
    '::-webkit-scrollbar-thumb:hover': {
      background: '#555'
    }
  })
};
