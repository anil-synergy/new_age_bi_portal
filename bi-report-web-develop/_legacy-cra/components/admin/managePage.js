/* eslint-disable no-debugger */
/* eslint-disable max-len */
/* eslint-disable jsx-a11y/control-has-associated-label */
/* eslint-disable no-unused-vars */
import React, { useEffect, useRef, useState, useContext } from 'react';
import { ClipLoader } from 'react-spinners';
import iconPlus from '../../img/ico-plus.svg';
import iconEdit from '../../img/ico-edit.svg';
import iconTrash from '../../img/ico-trash.svg';
import icoSearchFilled from '../../img/ico-search-filled.svg';
import Modal from '../common/modal';
import AddReport from './AddUser';
import showAlert from '../../utils/alert';
import axios from '../../utils/axios';
import { deleteUser } from '../../services/BiServices';
import Pagination from '../common/pagination';
import TrucateComponent from './trucateComponent';
import icoClose from '../../img/ico-close.svg';
import ConfirmModal from '../common/confirmModal';
import { myContext } from '../myContext';

// eslint-disable-next-line import/no-cycle

const options = [
  { value: 20, label: '20 rows' },
  { value: 40, label: '40 rows' },
  { value: 100, label: '100 rows' }
];

const AdminPage = () => {
  const [showAddModal, setshowAddModal] = useState(false);
  const [users, setusers] = useState([]);
  const [currentPage, setcurrentPage] = useState(1);
  const [totalPage, settotalPage] = useState(10);
  const [isPreviousDisabled, setisPreviousDisabled] = useState(null);
  const [isNextDisabled, setisNextDisabled] = useState(null);
  const [pageSize, setpageSize] = useState(options[0]);
  const [expandReportIndex, setExpandReportIndex] = useState(null);
  const [totalItems, settotalItems] = useState(null);
  const [currentUser, setCurrentUser] = useState({});
  const [search, setSearch] = useState('');
  const [searchChange, setSearchChange] = useState(false);
  const modalref = useRef(null);
  const [loading, setLoading] = useState(false);

  const { allPermissionList, isSuperAdmin, isDepAdmin } = useContext(myContext);
  const handleCurrentPage = (page) => {
    if (page <= 1) {
      setcurrentPage(1);
    } else {
      setcurrentPage(page);
    }
  };

  const editUser = (item) => {
    setCurrentUser(item);
  };

  const removeUser = async (id) => {
    try {
      await modalref.current.open('Are you sure to delete?');
    } catch {
      return;
    }
    deleteUser(id).then((res) => {
      setLoading(true);
      if (res?.data) {
        setusers(res?.data.items);
        settotalPage(res?.data.totalPages);
        setcurrentPage(res?.data.currentPage);
        setisPreviousDisabled(!res?.data.hasPrev);
        setisNextDisabled(!res?.data.hasNext);
        settotalItems(res?.data.totalItems);
        showAlert('User Deleted Successfully', 'success');
        setLoading(false);
      } else {
        showAlert('Problem while Deleting User', 'error');
        setLoading(false);
      }
    });
  };

  const getUsers = async (req) => {
    setLoading(true);
    setisPreviousDisabled(true);
    setisNextDisabled(true);
    const data = await axios.post('/bi-report-api/v1/admin/users', req);
    if (data?.data) {
      const { items, totalPages, currentPage: currentPageData, hasNext, hasPrev, totalItems: total } = data?.data;
      setusers(items);
      settotalPage(totalPages);
      setcurrentPage(currentPageData);
      setisPreviousDisabled(!hasPrev);
      setisNextDisabled(!hasNext);
      settotalItems(total);
      setLoading(false);
    }
  };

  useEffect(() => {
    const limitValue = totalItems / pageSize.value;
    if (totalItems && currentPage > Math.ceil(limitValue)) {
      setcurrentPage(
        1,
        getUsers({
          page: 1,
          pageSize: pageSize.value,
          search: searchChange ? search : ''
        })
      );
      return;
    }
    getUsers({
      page: currentPage,
      pageSize: pageSize.value,
      search: searchChange ? search : ''
    });
  }, [currentPage, pageSize]);

  const handleExpandReport = (id) => {
    if (
      id
      // && !expandReportRef?.current?.contains(e.target)
    ) {
      setExpandReportIndex(id);
      return;
    }
    setExpandReportIndex(null);
  };

  const onSearchChange = (event) => {
    setSearch(event.target.value);
  };

  const onSearchDown = (event) => {
    if (event.key === 'Enter') {
      setSearchChange(true);
      getUsers({
        page: 1,
        pageSize: 20,
        search
      });
    } else {
      setSearchChange(false);
    }
  };

  const onSearchClose = () => {
    setSearch('');
    setSearchChange(false);
    getUsers({
      page: 1,
      pageSize: 20,
      search: ''
    });
  };

  useEffect(() => {
    if (showAddModal === false) {
      setCurrentUser(null);
    }
  }, [showAddModal]);

  return (
    <>
      {loading
        ? (
          <div className="loader">
            <ClipLoader loading color="#333869" />
          </div>
        ) : (
          <>
            <ConfirmModal
              ref={modalref}
            />
            <div className="report-wrap">
              <div className="reports report-layout-one manage relative">
                <div className="reports__header">
                  <h4 className="reports__title f-bold">Manage Users</h4>
                </div>
                {/* new wrapper introduced "reports__control"; the searchbar and the button should be placed inside this wrapper = */}
                <div className="reports__control">
                  <div className="searchBar">
                    <div className="searchBar__search">
                      <img src={icoSearchFilled} alt="" className="searchBar__search-icon" data-testid="search-btn" />
                      <input
                        className="searchBar__search-input"
                        name="search"
                        value={search}
                        aria-label="search"
                        type="text"
                        placeholder="Search by User Name/Email"
                        onChange={onSearchChange}
                        onKeyDown={onSearchDown}
                      />
                      {search !== '' && (
                        <button onClick={() => onSearchClose()} className="searchBar__close" type="button">
                          <img src={icoClose} alt="" />
                        </button>
                      )}
                    </div>
                    <button onClick={() => onSearchDown({ key: 'Enter' })} className="btn-secondary" type="button">
                      Search
                    </button>
                  </div>
                  {
                    (!isDepAdmin || isSuperAdmin) && (
                      <button onClick={() => setshowAddModal(true)} className="btn-primary btn-md" type="button">
                        <img src={iconPlus} alt="" />
                        Add User
                      </button>
                    )
                  }

                </div>
                <div className="reports-table user-table">
                  <div className="reports-table__head">
                    <div className="reports-table__row reports-table__row--head">
                      <div className="reports-table__cell">SN</div>
                      <div className="reports-table__cell">Name</div>
                      <div className="reports-table__cell">Email</div>
                      {/* <div className="reports-table__cell">Groups</div> */}
                      <div className="reports-table__cell">Groups</div>
                      <div className="reports-table__cell text-center" />
                    </div>
                  </div>

                  <div className="reports-table__body custom-scroll">
                    {users.length ? (
                      users?.map((item, index) => (
                        <div key={item.id} className="reports-table__row">
                          <div className="reports-table__cell">{index + 1}</div>
                          <div className="reports-table__cell breakword capitalize">{item.name}</div>
                          <div className="reports-table__cell">
                            <span className="overflow-h ellipsis lowercase">{item.email}</span>
                          </div>
                          <div className="reports-table__cell overflow-visible">
                            <div className="context-menu-wrap relative">
                              <button type="button" onClick={(e) => handleExpandReport(item.id)} className="flex flex-wrap gap-025">
                                {item.reports.length > 0 ? <TrucateComponent items={item.reports} /> : <TrucateComponent items={item.group} />}
                              </button>
                              {expandReportIndex === item.id && (
                                // eslint-disable-next-line jsx-a11y/mouse-events-have-key-events
                                <div className="context-menu table-info" onMouseLeave={() => handleExpandReport(null)}>
                                  {item.group?.length > 0 && (
                                    <div className="table-info-set">
                                      <h4 className="font-sm f-bold">Groups</h4>
                                      {item.group?.map(({ name: groupName, rlsRoleAssigned: grouprlsRoles }) => (
                                        <span className="table-info-item">
                                          {groupName}
                                          {grouprlsRoles?.length > 0 && (
                                            <span title="RLS" className="text-secondary-600">
                                              (
                                              {grouprlsRoles?.map((grpRls) => (
                                                <span className="table-info-item">{grpRls}</span>
                                              ))}
                                              )
                                            </span>
                                          )}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                  {item.reports?.length > 0 && (
                                    <div className="table-info-set">
                                      <h4 className="font-sm f-bold">Individual Reports</h4>
                                      {item.reports?.map(({ name: reportName, rlsRoleAssigned: reportrlsRoles }) => (
                                        <span className="table-info-item">
                                          {reportName}
                                          {reportrlsRoles?.length > 0 && (
                                            <span title="RLS" className="text-secondary-600">
                                              (
                                              {reportrlsRoles?.map((reportrls) => (
                                                <span className="table-info-item ">{reportrls}</span>
                                              ))}
                                              )
                                            </span>
                                          )}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                          {isSuperAdmin && (
                            <div className="reports-table__cell table-action">
                              <button
                                className="table-action__button"
                                type="button"
                                title="Update"
                                onClick={() => {
                                  editUser(item);
                                  setshowAddModal(true);
                                }}
                              >
                                <img src={iconEdit} alt="" />
                              </button>
                              {allPermissionList?.id !== item?.id
                                && (
                                  <button onClick={() => removeUser(item?.id)} className="table-action__button" type="button" title="Delete">
                                    <img src={iconTrash} alt="" />
                                  </button>
                                )}
                            </div>
                          )}
                        </div>
                      ))
                    ) : (
                      <span className="center-message">No Data Found</span>
                    )}
                  </div>
                </div>
                {users.length ? <Pagination {...{ currentPage, totalPage, handleCurrentPage, isPreviousDisabled, isNextDisabled, pageSize, setpageSize, options }} /> : ''}
              </div>
            </div>
            {/* as a different component */}
            {showAddModal && (
              <Modal title={currentUser ? 'Update User' : 'Add New User'} showAddModal={showAddModal}>
                <AddReport
                  setpageSize={setpageSize}
                  currentUser={currentUser}
                  setusers={setusers}
                  setSearch={setSearch}
                  settotalPage={settotalPage}
                  setcurrentPage={setcurrentPage}
                  setisPreviousDisabled={setisPreviousDisabled}
                  setisNextDisabled={setisNextDisabled}
                  settotalItems={settotalItems}
                  setshowAddModal={setshowAddModal}
                />
              </Modal>
            )}
          </>
        )}
    </>
  );
};

export default AdminPage;
