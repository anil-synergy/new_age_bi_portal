import React from 'react';
// import InputText from '../../common/input-components/textInput';
import iconDelete from '../../../images/icons/delete.svg';

const ListingMenu = ({ tableHeadName, deleteGroup, deleteUser, data, isrls, keyName }) => {
  // const [search, setSearch] = useState("");

  // useEffect(() => {
  //   const hello = data.filter((item) => item.user?.toLowerCase().includes(search))
  // }, [search]);
  const getItem = (x, i, arr) => {
    if (i < (arr?.length) - 1) {
      return `${x}, `;
    }
    return x;
  };
  return (
    <div className="modal-listing">
      {/* <InputText placeholder="Search" wrapperClassName="secondary-text"
      onChange={(e) => setSearch(e.target.value)} /> */}
      <div className="access-table">
        <div className="access-table__head">
          <div className="access-table__row">
            <div className="access-table__cell">{tableHeadName}</div>
            {isrls && <div className="access-table__cell">RLS Roles</div>}
            {/* <div className="access-table__cell">RLS Roles</div> */}
            {/* <div className="access-table__cell">Access</div> */}
            <div className="access-table__cell" />
          </div>
        </div>
        <div className="access-table__body">
          {data?.map((item) => (
            <div className="access-table__row">
              <div className="access-table__cell">{item?.[keyName]}</div>
              <div className="access-table__cell">
                {isrls
                  && item?.rlsRoleAssigned.length
                  ? item?.rlsRoleAssigned.map((x, i, arr) => {
                    return (
                      <span>
                        {getItem(x, i, arr)}
                      </span>
                    );
                  }) : 'Bypass RLS'}
              </div>
              <div className="access-table__cell">
                <button
                  className="delete-btn"
                  type="button"
                  onClick={() => (item.mappingGroupId
                    ? deleteGroup(item.mappingGroupId)
                    : deleteUser(item.mappingUserId))}
                >
                  <img src={iconDelete} alt="" />
                </button>
              </div>

              {/* <div className="w-1/12">
                <button
                  onClick={() => (item.mappingGroupId
                    ? deleteGroup(item.mappingGroupId)
                    : deleteUser(item.mappingUserId))}
                  type="button"
                  title="More"
                  className="pt-4 focus:outline-none"
                >
                  <img src={Delete} alt="" />
                </button>
              </div> */}
              {/* <div className="access-table__cell">
                <SelectComponent
                value={{ label: 'Viewer', value: 'Viewer' }}
                wrapperClassName="secondary-select"
                options={[{ label: 'Viewer', value: 'Viewer' }]}
                />
              </div> */}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ListingMenu;
