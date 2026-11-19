/* eslint-disable no-unused-vars */
import React, { useState, useEffect, useRef, useContext } from 'react';
import { ClipLoader } from 'react-spinners';
import { DropDown } from '../common/input-components/dropDown';
import axios from '../../utils/axios';
import Pagination from '../common/pagination';
import Modal from '../common/modal';
import AddGroup from './createGroup';
import { deleteGroup, getAllCategories } from '../../services/BiServices';
import showAlert from '../../utils/alert';
import iconPlus from '../../img/ico-plus.svg';
import iconEllipsis from '../../img/ico-ellipsis.svg';
import icoSearchFilled from '../../img/ico-search-filled.svg';
import icoClose from '../../img/ico-close.svg';
import ConfirmModal from '../common/confirmModal';
import AddGroupUser from './addGroupUser';
import GroupReport from './groupReport';
import { myContext } from '../myContext';

const options = [
  { value: 20, label: '20 rows' },
  { value: 40, label: '40 rows' },
  { value: 100, label: '100 rows' }
];

const Groups = () => {
  const [showAddModal, setshowAddModal] = useState(false);
  const [department, setDepartment] = useState(null);
  const [categories, setCategories] = useState([]);
  const [groups, setgroups] = useState([]);
  const [currentPage, setcurrentPage] = useState(1);
  const [totalPage, settotalPage] = useState(10);
  const [isPreviousDisabled, setisPreviousDisabled] = useState(null);
  const [isNextDisabled, setisNextDisabled] = useState(null);
  const [pageSize, setpageSize] = useState(options[0]);
  const [descriptionId, setdescriptionId] = useState(null);
  const [currentGroup, setCurrentGroup] = useState({});
  const [badgeId, setbadgeId] = useState();
  const [search, setSearch] = useState('');
  const [searchChange, setSearchChange] = useState(false);
  const modalref = useRef(null);
  const [loading, setLoading] = useState(false);
  const [showuser, setShowUser] = useState(false);
  const [showreport, setShowReport] = useState(false);
  const [currentUsers, setCurrentUsers] = useState([]);
  const [currentReports, setCurrentReports] = useState([]);
  const [userdisable, setUserDisable] = useState(false);

  const { isSuperAdmin } = useContext(myContext);

  const handleCurrentPage = (page) => {
    if (page <= 1) {
      setcurrentPage(1);
    } else {
      setcurrentPage(page);
    }
  };

  const fetchAllGroups = async (req) => {
    const category = req?.FilterValue ? `&FilterValue=${req?.FilterValue}` : '';
    setLoading(true);
    const data = await axios.get(`/bi-report-api/v1/admin/user/group?Page=${req.currentPage}&PageSize=${req.pageSize}&Search=${req.search}${category}`);
    if (data?.data) {
      const { items, totalPages, currentPage: currentPageData, hasNext, hasPrev } = data?.data;
      setgroups(items);
      settotalPage(totalPages);
      setcurrentPage(currentPageData);
      setisPreviousDisabled(!hasPrev);
      setisNextDisabled(!hasNext);
      setLoading(false);
    }
  };

  const editGroup = (item) => {
    setCurrentGroup(item);
  };

  const removeGroup = async (id) => {
    try {
      await modalref.current.open('Are you sure to delete?');
    } catch {
      return;
    }
    deleteGroup(id).then((res) => {
      setLoading(true);
      if (res?.data) {
        setgroups(res?.data.items);
        settotalPage(res?.data.totalPages);
        setcurrentPage(res?.data.currentPage);
        setisPreviousDisabled(!res?.data.hasPrev);
        setisNextDisabled(!res?.data.hasNext);
        showAlert('Group Deleted Successfully', 'success');
        setLoading(false);
      } else {
        showAlert('Problem while Deleting Group', 'error');
        setLoading(false);
      }
    });
  };

  useEffect(() => {
    fetchAllGroups({
      currentPage,
      pageSize: pageSize.value,
      search: searchChange ? search : '',
      FilterValue: department?.value
    });
  }, [currentPage, pageSize]);

  const onSearchChange = (event) => {
    setSearch(event.target.value);
  };

  const onSearchDown = (event) => {
    if (event.key === 'Enter') {
      setSearchChange(true);
      fetchAllGroups({
        currentPage: 1,
        pageSize: 20,
        search,
        FilterValue: department?.value
      });
    } else {
      setSearchChange(false);
    }
  };

  const onSearchClose = () => {
    setSearch('');
    setSearchChange(false);
    fetchAllGroups({
      currentPage: 1,
      pageSize: 20,
      search: '',
      FilterValue: department?.value
    });
  };

  useEffect(() => {
    if (showAddModal === false) {
      setCurrentGroup(null);
    }
  }, [showAddModal]);

  useEffect(() => {
    if (showAddModal === true) {
      setbadgeId(null);
    }
  }, [showAddModal]);

  useEffect(() => {
    getAllCategories().then((data) => {
      if (data) {
        const newdata = data?.map(({ name, id }) => ({ label: name, value: id }));
        setCategories(newdata);
      }
    });
  }, []);

  return (
    <>
      {loading ? (
        <div className="loader">
          <ClipLoader loading color="#333869" />
        </div>
      ) : (
        <>
          <ConfirmModal ref={modalref} />
          <div className="report-wrap">
            <div className="reports report-layout-one manage relative">
              <div className="reports__header">
                <h4 className="reports__title f-bold">User Groups</h4>
              </div>
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
                      placeholder="Search by Group Name"
                      onChange={onSearchChange}
                      onKeyDown={onSearchDown}
                    />
                    {search !== '' && (
                      <button onClick={() => onSearchClose()} className="searchBar__close" type="button">
                        <img src={icoClose} alt="" />
                      </button>
                    )}
                  </div>
                  <div>
                    <DropDown
                      name="department"
                      allowClearValues
                      placeholder="Search by Department / Category"
                      options={categories}
                      onChange={(value) => {
                        setDepartment(value);
                        if (value === null) {
                          fetchAllGroups({
                            currentPage: 1,
                            pageSize: 20,
                            search: ''
                          });
                        }
                      }}
                      value={department}
                    />
                  </div>
                  <button onClick={() => onSearchDown({ key: 'Enter' })} className="btn-secondary" type="button">
                    Search
                  </button>
                </div>
                <button onClick={() => setshowAddModal(true)} className="btn-primary btn-md" type="button">
                  <img src={iconPlus} alt="" />
                  Add Group
                </button>
              </div>
              <div className="reports-table user-groups-table">
                <div className="reports-table__head">
                  <div className="reports-table__row reports-table__row--head">
                    <div className="reports-table__cell">SN</div>
                    <div className="reports-table__cell">Group Name</div>
                    <div className="reports-table__cell ">Department/Category</div>
                  </div>
                </div>
                <div className="reports-table__body custom-scroll">
                  {groups.length ? (
                    groups.map((item, index) => (
                      <div key={item?.id} className="reports-table__row">
                        <div className="reports-table__cell">{index + 1}</div>
                        <div className="reports-table__cell">
                          {item?.name}
                          <div className="context-menu-wrap relative">
                            {item?.description && (
                              <i
                                onMouseEnter={() => setdescriptionId(item?.id)}
                                onMouseLeave={() => setdescriptionId(null)}
                                className="fa fa-info-circle info-circle font-sm"
                              />
                            )}
                            {descriptionId === item?.id && <div className="context-menu context-menu-description">{item?.description}</div>}
                          </div>
                        </div>
                        <div className="reports-table__cell">{item.reportCategoryName}</div>
                        <div className="reports-table__cell">
                          <span
                            className="link"
                            onClick={() => {
                              setCurrentUsers(item?.id);
                              setShowUser(true);
                            }}
                          >
                            View Users
                          </span>
                        </div>
                        <div className="reports-table__cell">
                          <span
                            className="link"
                            onClick={() => {
                              setCurrentReports(item?.mappedReports);
                              setShowReport(true);
                            }}
                          >
                            View Reports
                          </span>
                        </div>
                        {item?.name !== 'System Admin' && (
                          <div className="reports-table__cell justify-end">
                            <div className="context-menu-wrap relative">
                              <button onClick={() => setbadgeId(item?.id)} type="button" title="More">
                                <img src={iconEllipsis} alt="" />
                              </button>
                              {badgeId === item?.id && (
                                <div onMouseLeave={() => setbadgeId(null)} className="context-menu">
                                  <button
                                    type="button"
                                    className="context-menu__link"
                                    onClick={() => {
                                      editGroup(item);
                                      setshowAddModal(true);
                                    }}
                                  >
                                    Edit
                                  </button>
                                  {isSuperAdmin && (
                                    <button onClick={() => removeGroup(item?.id)} type="button" className="context-menu__link">
                                      Delete
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <span className="center-message">No Data Found</span>
                  )}
                </div>
                {groups.length ? (
                  <Pagination
                    {...{
                      currentPage,
                      totalPage,
                      handleCurrentPage,
                      isPreviousDisabled,
                      isNextDisabled,
                      pageSize,
                      setpageSize,
                      options
                    }}
                  />
                ) : (
                  ''
                )}
              </div>
            </div>
            {showAddModal && (
              <Modal title={currentGroup ? 'Update Group' : 'Create Group'} showAddModal={showAddModal}>
                <AddGroup
                  categories={categories}
                  setpageSize={setpageSize}
                  setgroups={setgroups}
                  setSearch={setSearch}
                  settotalPage={settotalPage}
                  setcurrentPage={setcurrentPage}
                  setisPreviousDisabled={setisPreviousDisabled}
                  setisNextDisabled={setisNextDisabled}
                  currentGroup={currentGroup}
                  setshowAddModal={setshowAddModal}
                />
              </Modal>
            )}
            {showuser && (
              <Modal title="Users" showAddModal={showuser}>
                <AddGroupUser
                  setShowUser={setShowUser}
                  currentUser={currentUsers}
                  groups={groups}
                  setgroups={setgroups}
                  settotalPage={settotalPage}
                  setcurrentPage={setcurrentPage}
                  setisPreviousDisabled={setisPreviousDisabled}
                  setisNextDisabled={setisNextDisabled}
                  disable={userdisable}
                  setDisable={setUserDisable}
                  currentPage={currentPage}
                  pageSize={pageSize}
                  search={search}
                />
              </Modal>
            )}
            {showreport && (
              <Modal title="Reports" showAddModal={showreport}>
                <GroupReport setShowReport={setShowReport} currentReports={currentReports} />
              </Modal>
            )}
          </div>
        </>
      )}
    </>
  );
};

export default Groups;
