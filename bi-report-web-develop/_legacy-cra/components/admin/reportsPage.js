/* eslint-disable max-len */
/* eslint-disable no-unused-vars */
import React, { useContext, useEffect, useState, useRef } from 'react';
import { cloneDeep } from 'lodash';
import { ClipLoader } from 'react-spinners';
import { DropDown } from '../common/input-components/dropDown';
import iconPlus from '../../img/ico-plus.svg';
import axios from '../../utils/axios';
import iconEllipsis from '../../img/ico-ellipsis.svg';
import icoSearchFilled from '../../img/ico-search-filled.svg';
import Pagination from '../common/pagination';
import Modal from '../common/modal';
import SetPermissions from './SetPermissions';
import AddNewReport from './addReport';
import showAlert from '../../utils/alert';
import { getReport, deleteReport, getAllCategories } from '../../services/BiServices';
import icoClose from '../../img/ico-close.svg';
import ConfirmModal from '../common/confirmModal';
import { myContext } from '../myContext';

const options = [
  { value: 20, label: '20 rows' },
  { value: 40, label: '40 rows' },
  { value: 100, label: '100 rows' }
];

const ReportsPage = () => {
  const [showAddModal, setshowAddModal] = useState(false);
  const [department, setDepartment] = useState(null);
  const [categories, setCategories] = useState([]);
  const [reports, setreports] = useState([]);
  const [currentPage, setcurrentPage] = useState(1);
  const [totalPage, settotalPage] = useState(10);
  const [isPreviousDisabled, setisPreviousDisabled] = useState(null);
  const [isNextDisabled, setisNextDisabled] = useState(null);
  const [pageSize, setpageSize] = useState(options[0]);
  const [descriptionId, setdescriptionId] = useState(null);
  const [permissionId, setpermissionId] = useState(null);
  const [modal, setmodal] = useState(false);
  const [currentReport, setCurrentReport] = useState({});
  const [currentgetReport, setgetReport] = useState({});
  const [search, setSearch] = useState('');
  const [searchChange, setSearchChange] = useState(false);
  const modalref = useRef(null);
  const [loading, setLoading] = useState(false);
  const [isReload, setisReload] = useState(false);

  const { isSuperAdmin } = useContext(myContext);

  const handleModal = () => {
    setmodal((prevState) => !prevState);
  };

  const handleCurrentPage = (page) => {
    if (page <= 1) {
      setcurrentPage(1);
    } else {
      setcurrentPage(page);
    }
  };

  const fetchAllReports = async (req) => {
    setLoading(true);
    const data = await axios.post('/bi-report-api/v1/admin/getAllReports', req);
    if (data?.data) {
      const { items, totalPages, currentPage: currentPageData, hasNext, hasPrev } = data?.data;
      setreports(items);
      settotalPage(totalPages);
      setcurrentPage(currentPageData);
      setisPreviousDisabled(!hasPrev);
      setisNextDisabled(!hasNext);
      setLoading(false);
    }
  };

  const getallReport = (id) => {
    getReport(id).then((data) => {
      if (data) {
        const newdata = cloneDeep(data);
        const updateddata = cloneDeep(data);
        setCurrentReport(newdata);
        setgetReport(updateddata?.powerBiRlsRole);
      }
    });
  };

  const editUser = (item) => {
    getallReport(item.id);
  };

  const removeReport = async (id) => {
    try {
      await modalref.current.open('Are you sure to delete?');
    } catch {
      return;
    }
    deleteReport(id).then((res) => {
      setLoading(true);
      if (res?.data) {
        setreports(res?.data.items);
        settotalPage(res?.data.totalPages);
        setcurrentPage(res?.data.currentPage);
        setisPreviousDisabled(!res?.data.hasPrev);
        setisNextDisabled(!res?.data.hasNext);
        showAlert('Report Deleted Successfully', 'success');
        setLoading(false);
      } else {
        showAlert('Problem while Deleting Report', 'error');
        setLoading(false);
      }
    });
  };
  useEffect(() => {
    fetchAllReports({
      page: currentPage,
      pageSize: pageSize.value,
      search: searchChange ? search : '',
      filterValue: department?.value
    });
  }, [currentPage, pageSize, isReload]);

  const onSearchChange = (event) => {
    setSearch(event.target.value);
  };

  const onSearchDown = (event) => {
    if (event.key === 'Enter') {
      setSearchChange(true);
      fetchAllReports({
        page: 1,
        pageSize: 20,
        search,
        filterValue: department?.value
      });
    } else {
      setSearchChange(false);
    }
  };

  const onSearchClose = () => {
    setSearch('');
    setSearchChange(false);
    fetchAllReports({
      page: 1,
      pageSize: 20,
      search: '',
      filterValue: department?.value
    });
  };

  useEffect(() => {
    if (showAddModal === false) {
      setCurrentReport(null);
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

  useEffect(() => {
    if (showAddModal === true || modal === true) {
      setpermissionId(null);
    }
  }, [showAddModal, modal]);
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
                  <h4 className="reports__title f-bold">Manage Reports</h4>
                </div>
                <div className="reports__control">
                  <div className="searchBar">
                    <div className="searchBar__search">
                      <img
                        src={icoSearchFilled}
                        alt=""
                        className="searchBar__search-icon"
                        data-testid="search-btn"
                      />
                      <input
                        className="searchBar__search-input"
                        name="search"
                        value={search}
                        aria-label="search"
                        type="text"
                        placeholder="Search by Report Name"
                        onChange={onSearchChange}
                        onKeyDown={onSearchDown}
                      />
                      {search !== ''
                        && (
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
                            fetchAllReports({
                              page: 1,
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
                  {isSuperAdmin && (
                    <button onClick={() => { setCurrentReport(null); setshowAddModal(true); }} className="btn-primary btn-md" type="button">
                      <img src={iconPlus} alt="" />
                      Add New
                    </button>
                  )}
                </div>
                <div className="reports-table">
                  <div className="reports-table__head">
                    <div className="reports-table__row reports-table__row--head">
                      <div className="reports-table__cell">SN</div>
                      <div className="reports-table__cell">Report Name</div>
                      {/* <div className="reports-table__cell">Report ID</div> */}
                      {/* <div className="reports-table__cell">Workspace ID</div> */}
                      <div className="reports-table__cell">Department/Category</div>
                      <div className="reports-table__cell justify-center">RLS</div>
                      <div className="reports-table__cell justify-center">Pagination</div>
                      <div className="reports-table__cell " />
                    </div>
                  </div>

                  <div className="reports-table__body custom-scroll">
                    {reports.length
                      ? (
                        reports.map((item, index) => (
                          <div key={item?.id} className="reports-table__row">
                            <div className="reports-table__cell">{index + 1}</div>
                            <div className="reports-table__cell">
                              {item?.title}
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
                            <div className="reports-table__cell">{item?.categoryName}</div>
                            <div className="reports-table__cell justify-center">
                              {item?.rlsEnabled ? (
                                <i className="fa fa-check-circle font-md text-green-600 " />
                              ) : (
                                <i className="fa fa-times-circle font-md text-red-600" />
                              )}
                            </div>
                            <div className="reports-table__cell justify-center">
                              {item?.enablePagination ? (
                                <i className="fa fa-check-circle font-md text-green-600 " />
                              ) : (
                                <i className="fa fa-times-circle font-md text-red-600" />
                              )}
                            </div>
                            <div className="reports-table__cell justify-end">
                              <div className="context-menu-wrap relative">
                                <button onClick={() => setpermissionId(item?.id)} type="button" title="More">
                                  <img src={iconEllipsis} alt="" />
                                </button>
                                {permissionId === item?.id && (
                                  <div onMouseLeave={() => setpermissionId(null)} className="context-menu">
                                    <button onClick={handleModal} type="button" className="z-10 context-menu__link">
                                      Permissions
                                    </button>
                                    {isSuperAdmin && (
                                      <button
                                        type="button"
                                        className="context-menu__link"
                                        onClick={() => {
                                          editUser(item);
                                          setshowAddModal(true);
                                        }}
                                      >
                                        Edit
                                      </button>
                                    )}
                                    {isSuperAdmin && (
                                      <button onClick={() => removeReport(item?.id)} type="button" className="context-menu__link">
                                        Delete
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <span className="center-message">No Data Found</span>
                      )}
                  </div>
                  {reports.length ? <Pagination {...{ currentPage, totalPage, handleCurrentPage, isPreviousDisabled, isNextDisabled, pageSize, setpageSize, options }} /> : ''}
                </div>
              </div>
              {modal && (
                <Modal title="PERMISSIONS" showAddModal={modal}>
                  <SetPermissions
                    {...{ permissionId, setshowAddModal: handleModal }}
                    handleReload={() => setisReload(!isReload)}
                    setmodal={setmodal}
                  />
                </Modal>
              )}
              {showAddModal && (
                <Modal title={currentReport ? 'Update Report' : 'Add New Report'} showAddModal={showAddModal}>
                  <AddNewReport
                    categories={categories}
                    setCategories={setCategories}
                    setpageSize={setpageSize}
                    currentReport={currentReport}
                    reports={reports}
                    setSearch={setSearch}
                    currentgetReport={currentgetReport}
                    setcurrentPage={setcurrentPage}
                    getallReport={getallReport}
                    setreports={setreports}
                    setshowAddModal={setshowAddModal}
                    settotalPage={settotalPage}
                    setisPreviousDisabled={setisPreviousDisabled}
                    setisNextDisabled={setisNextDisabled}
                  />
                </Modal>
              )}
            </div>
          </>
        )}
    </>
  );
};

export default ReportsPage;
