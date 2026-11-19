import React, { useState, useEffect, useContext } from 'react';
import { useFormik } from 'formik';
import * as Yup from 'yup';
import { DropDown } from '../common/input-components/dropDown';
import showAlert from '../../utils/alert';
import iconDelete from '../../images/icons/delete.svg';
import { getAllUsers, addGroupUsers, deleteGroupUser } from '../../services/BiServices';
import { myContext } from '../myContext';

const AddGroupUser = (props) => {
  const { setShowUser, currentUser, groups, setgroups, settotalPage, setcurrentPage, pageSize,
    setisPreviousDisabled, setisNextDisabled, setDisable, disable, currentPage, search } = props;

  const { allPermissionList } = useContext(myContext);

  const [userData, setAllUsers] = useState([]);
  const [mappedUsers, setMappedUsers] = useState([]);

  const validationSchema = Yup.object({
    email: Yup.array().min(1, 'Field is Required')
  });

  const formik = useFormik({
    initialValues: {
      email: []
    },
    validationSchema,
    onSubmit: async (values, { resetForm }) => {
      setDisable(true);
      const newdata = values?.email.map((item) => item.value);
      const payload = {
        pageSize: pageSize?.value,
        page: currentPage,
        search,
        userId: newdata
      };
      addGroupUsers(currentUser, payload).then((data) => {
        if (data) {
          setgroups(data?.items);
          settotalPage(data?.totalPages);
          setcurrentPage(data?.currentPage);
          setisPreviousDisabled(!data?.hasPrev);
          setisNextDisabled(!data?.hasNext);
          showAlert('User Added Successfully', 'success');
          setDisable(false);
        } else {
          showAlert('Error While Adding User', 'error');
          setDisable(false);
        }
      });
      resetForm();
    }
  });

  const removeGroupUser = (id) => {
    const payload = {
      pageSize: pageSize?.value,
      page: currentPage,
      search,
      userId: [id]
    };
    deleteGroupUser(currentUser, { data: payload })
      .then((response) => {
        if (response?.data) {
          setgroups(response?.data?.items);
          settotalPage(response?.data?.totalPages);
          setcurrentPage(response?.data?.currentPage);
          setisPreviousDisabled(!response?.data?.hasPrev);
          setisNextDisabled(!response?.data?.hasNext);
          showAlert('User Deleted Successfully', 'success');
        }
      });
  };

  useEffect(() => {
    setMappedUsers(groups.filter((item) => item.id === currentUser));
  }, [groups]);

  useEffect(() => {
    getAllUsers().then((data) => {
      if (data && mappedUsers) {
        const newData = data?.map(({ email, id }) => ({ label: email, value: id }));
        const mappeduserId = mappedUsers[0]?.mappedUsers?.map((item) => item.userId);
        const newuserData = newData?.filter(
          ({ value }) => !mappeduserId.includes(value)
        );
        setAllUsers(newuserData);
      }
    });
  }, [mappedUsers]);

  return (
    <>
      <form className="modal-form">
        <DropDown
          name="email"
          placeholder="Select Users"
          allowMultiple
          options={userData}
          {...formik.getFieldProps('email')}
          onChange={(value) => {
            formik.setFieldValue('email', value);
          }}
          errormessage={formik.touched.email && formik.errors?.email}
        />
        <div className="modal-listing">
          <div className="access-table">
            <div className="access-table__head">
              <div className="access-table__row">
                <div className="access-table__cell">Email</div>
                <div className="access-table__cell">Name</div>
                <div className="access-table__cell" />
              </div>
            </div>
            <div className="access-table__body">
              {mappedUsers[0]?.mappedUsers.map((item) => (
                <div className="access-table__row">
                  <div className="access-table__cell">{item?.userEmail}</div>
                  <div className="access-table__cell wordbreak">{item?.userName}</div>
                  <div className="access-table__cell">
                    {allPermissionList?.id !== item?.userId
                      && (
                        <button
                          className="delete-btn"
                          type="button"
                          onClick={() => removeGroupUser(item?.userId)}
                        >
                          <img src={iconDelete} alt="" />
                        </button>
                      )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="modal-box__btn-wrap">
          <div className="modal-box__btn-group">
            <button onClick={() => { setShowUser(false); formik.resetForm(); }} type="button" className="btn-secondary btn-md">
              Close
            </button>
            <button type="submit" onClick={!disable && formik.handleSubmit} form="myform" className="btn-primary btn-md">
              Update
            </button>
          </div>
        </div>
      </form>
    </>
  );
};

export default AddGroupUser;
