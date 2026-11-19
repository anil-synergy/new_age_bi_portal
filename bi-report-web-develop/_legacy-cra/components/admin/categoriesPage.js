/* eslint-disable max-len */
/* eslint-disable no-unused-vars */
import React, { useContext, useEffect, useState, useRef } from 'react';
import { ClipLoader } from 'react-spinners';
import iconPlus from '../../img/ico-plus.svg';
import axios from '../../utils/axios';
import iconEllipsis from '../../img/ico-ellipsis.svg';
import Pagination from '../common/pagination';
import Modal from '../common/modal';
import AddCategory from './addCategory';
import showAlert from '../../utils/alert';
import { deleteCategory } from '../../services/BiServices';
import icoSearchFilled from '../../img/ico-search-filled.svg';
import icoClose from '../../img/ico-close.svg';
import ConfirmModal from '../common/confirmModal';
import { myContext } from '../myContext';

const options = [
  { value: 20, label: '20 rows' },
  { value: 40, label: '40 rows' },
  { value: 100, label: '100 rows' }
];

const CategoriesPage = () => {
  const [showAddModal, setshowAddModal] = useState(false);
  const [categories, setCategories] = useState([]);
  const [currentPage, setcurrentPage] = useState(1);
  const [totalPage, settotalPage] = useState(10);
  const [isPreviousDisabled, setisPreviousDisabled] = useState(null);
  const [isNextDisabled, setisNextDisabled] = useState(null);
  const [pageSize, setpageSize] = useState(options[0]);
  const [descriptionId, setdescriptionId] = useState(null);
  const [updateId, setUpdateId] = useState(null);
  const [currentCategory, setCurrentCategory] = useState({});
  const [search, setSearch] = useState('');
  const [searchChange, setSearchChange] = useState(false);
  const modalref = useRef(null);
  const [loading, setLoading] = useState(false);

  const { isSuperAdmin } = useContext(myContext);

  const handleCurrentPage = (page) => {
    if (page <= 1) {
      setcurrentPage(1);
    } else {
      setcurrentPage(page);
    }
  };

  const fetchAllCategories = async (req) => {
    setLoading(true);
    const data = await axios.get(`/bi-report-api/v1/admin/report/category?Page=${req.page}&PageSize=${req.pageSize}&Search=${req.search}`);
    if (data?.data) {
      const { items, totalPages, currentPage: currentPageData, hasNext, hasPrev } = data?.data;
      setCategories(items);
      settotalPage(totalPages);
      setcurrentPage(currentPageData);
      setisPreviousDisabled(!hasPrev);
      setisNextDisabled(!hasNext);
      setLoading(false);
    }
  };

  const editUser = (item) => {
    setCurrentCategory(item);
  };

  const removeCategory = async (id) => {
    try {
      await modalref.current.open('Are you sure to delete?');
    } catch {
      return;
    }
    deleteCategory(id).then((res) => {
      setLoading(true);
      if (res?.data) {
        setCategories(res?.data.items);
        settotalPage(res?.data.totalPages);
        setcurrentPage(res?.data.currentPage);
        setisPreviousDisabled(!res?.data.hasPrev);
        setisNextDisabled(!res?.data.hasNext);
        showAlert('Category Deleted Successfully', 'success');
        setLoading(false);
      } else {
        showAlert('Problem while Deleting Category', 'error');
        setLoading(false);
      }
    });
  };

  useEffect(() => {
    fetchAllCategories({
      page: currentPage,
      pageSize: pageSize.value,
      search: searchChange ? search : ''
    });
  }, [currentPage, pageSize]);

  const onSearchChange = (event) => {
    setSearch(event.target.value);
  };

  const onSearchDown = (event) => {
    if (event.key === 'Enter') {
      setSearchChange(true);
      fetchAllCategories({
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
    fetchAllCategories({
      page: 1,
      pageSize: 20,
      search: ''
    });
  };

  const getItem = (x, i, arr) => {
    if (i < (arr?.length) - 1) {
      return `${x.name}, `;
    }
    return x.name;
  };

  useEffect(() => {
    if (showAddModal === false) {
      setCurrentCategory(null);
    }
  }, [showAddModal]);

  useEffect(() => {
    if (showAddModal === true) {
      setUpdateId(null);
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
                  <h4 className="reports__title f-bold">Department or Report Categories</h4>
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
                        placeholder="Search by Department/Category"
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
                    <button onClick={() => onSearchDown({ key: 'Enter' })} className="btn-secondary" type="button">
                      Search
                    </button>
                  </div>
                  {isSuperAdmin && (
                    <button onClick={() => setshowAddModal(true)} className="btn-primary btn-md" type="button">
                      <img src={iconPlus} alt="" />
                      Add Category
                    </button>
                  )}
                </div>
                <div className="reports-table">
                  <div className="reports-table__head">
                    <div className="reports-table__row reports-table__row--head">
                      <div className="reports-table__cell">SN</div>
                      <div className="reports-table__cell">Department/Category</div>
                      <div className="reports-table__cell">Parent Category</div>
                      <div className="reports-table__cell">Admin</div>
                    </div>
                  </div>

                  <div className="reports-table__body custom-scroll">
                    {categories.length
                      ? (
                        categories.map((item, index) => (
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
                            <div className="reports-table__cell">
                              {item?.parentCategoryName || '-'}
                            </div>
                            <div className="breakword w-1/3">
                              {item?.departmentAdmin
                                && item?.departmentAdmin.map((x, i, arr) => {
                                  return (
                                    <span>
                                      {getItem(x, i, arr)}
                                    </span>
                                  );
                                })}
                            </div>
                            <div className="reports-table__cell" />
                            <div className="reports-table__cell justify-end">
                              {isSuperAdmin && (
                                <div className="context-menu-wrap relative">
                                  <button onClick={() => setUpdateId(item?.id)} type="button" title="More">
                                    <img src={iconEllipsis} alt="" />
                                  </button>
                                  {updateId === item?.id && (
                                    <div onMouseLeave={() => setUpdateId(null)} className="context-menu">
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
                                      <button onClick={() => removeCategory(item?.id)} type="button" className="context-menu__link">
                                        Delete
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        ))
                      ) : (
                        <span className="center-message">No Data Found</span>
                      )}
                  </div>
                  {categories.length ? <Pagination {...{ currentPage, totalPage, handleCurrentPage, isPreviousDisabled, isNextDisabled, pageSize, setpageSize, options }} /> : ''}
                </div>
              </div>
              {showAddModal && (
                <Modal title={currentCategory ? 'Update Category' : 'Add New Category'} showAddModal={showAddModal}>
                  <AddCategory
                    setpageSize={setpageSize}
                    setSearch={setSearch}
                    currentCategory={currentCategory}
                    setcurrentPage={setcurrentPage}
                    setCategories={setCategories}
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

export default CategoriesPage;
