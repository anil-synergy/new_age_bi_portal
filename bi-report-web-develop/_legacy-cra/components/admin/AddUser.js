import React, { useEffect, useRef, useState } from 'react';
import { Field, Form, Formik } from 'formik';
import * as Yup from 'yup';
import Checkbox from '../common/input-components/checkbox';
import InputText from '../common/input-components/textInput';
import SelectComponent from '../common/input-components/selectComponent';
import { getAllRoles, AddUserPost, EditUser } from '../../services/BiServices';
import showAlert from '../../utils/alert';

const AddUser = (props) => {
  const { currentUser, setusers, setcurrentPage, settotalPage, setpageSize, setSearch,
    setisPreviousDisabled, setisNextDisabled, settotalItems, setshowAddModal } = props;

  const [roles, setroles] = useState([]);
  const [disable, setDisable] = useState(false);

  const getRoles = () => {
    getAllRoles().then((data) => {
      if (data) {
        const parsedRoles = data?.map(({ name, id }) => ({ label: name, value: id }));
        setroles(parsedRoles);
      }
    });
  };

  const postAddUser = (payload) => {
    setDisable(true);
    AddUserPost(payload).then((data) => {
      if (data) {
        setSearch('');
        setusers(data?.items);
        settotalPage(data?.totalPages);
        setcurrentPage(data?.currentPage);
        setisPreviousDisabled(!data?.hasPrev);
        setisNextDisabled(!data?.hasNext);
        settotalItems(data?.totalItems);
        setpageSize({ value: data?.pageSize, label: `${data?.pageSize} rows` });
        showAlert('User added Successfully', 'success');
        setshowAddModal(false);
        setDisable(false);
      }
    });
  };
  const updateUser = (payload) => {
    setDisable(true);
    EditUser(currentUser?.id, payload).then((res) => {
      if (res?.data) {
        setSearch('');
        setusers(res?.data?.items);
        settotalPage(res?.data.totalPages);
        setcurrentPage(res?.data.currentPage);
        setisPreviousDisabled(!res?.data.hasPrev);
        setisNextDisabled(!res?.data.hasNext);
        settotalItems(res?.data.totalItems);
        setpageSize({ value: res?.data.pageSize, label: `${res?.data.pageSize} rows` });
        showAlert('User updated Successfully', 'success');
        setshowAddModal(false);
        setDisable(false);
      }
    });
  };

  useEffect(() => {
    getRoles();
  }, []);

  const formikRef = useRef();
  const newGroups = currentUser?.group?.map(({ name, id }) => ({ label: name, value: id }));
  useEffect(() => {
    if (currentUser) {
      formikRef.current.setFieldValue('fullName', currentUser?.name);
      formikRef.current.setFieldValue('email', currentUser?.email);
      formikRef.current.setFieldValue('role', newGroups);
    }
  }, [currentUser]);
  const handleChangeEmail = (e) => {
    const { value } = e.target;
    formikRef.current.setFieldValue('email', value);
    setDisable(false);
  };
  return (
    <Formik
      innerRef={formikRef}
      initialValues={{
        fullName: '',
        email: '',
        role: [],
        emailNotification: true
      }}
      validationSchema={Yup.object({
        fullName: Yup.string().required('Field is Required'),
        email: Yup.string().email('Invalid email address').required('Field is Required')
      })}
      onSubmit={(values) => {
        const data = { ...values };
        const payload = {
          name: data.fullName,
          emailAddress: data.email,
          group: data?.role ? data?.role.map((item) => item.value) : null
        };
        const updatePayload = {
          ...payload,
          id: currentUser?.id
        };
        const savePayload = {
          ...payload,
          sendMail: data.emailNotification
        };
        if (currentUser) {
          updateUser(updatePayload);
        } else {
          postAddUser(savePayload);
        }
      }}
    >
      {(formik) => (
        <Form id="myform">
          <div className="flex flex-column gap-1">
            <Field name="fullName" label="Name" component={InputText} />
            <Field name="email" label="Email" component={InputText} onChange={handleChangeEmail} />
            <Field name="role" label="Select the Group" isMulti component={SelectComponent} options={roles} />
            {!currentUser
              && (
                <Field
                  name="emailNotification"
                  checked={formik.values.emailNotification === true}
                  component={Checkbox}
                  label="Send an Email Notification"
                  className="align-self-start"
                />
              )}
          </div>
          <div className="modal-box__btn-wrap">
            <div className="modal-box__btn-group">
              <button
                onClick={() => {
                  setshowAddModal(false);
                  formik.resetForm();
                }}
                type="button"
                className="btn-secondary btn-md"
              >
                {currentUser ? 'Close' : 'Cancel'}
              </button>
              <button type="submit" disabled={disable} onClick={formik.handleSubmit} form="myform" className="btn-primary btn-md">
                {currentUser ? 'Update' : 'Add'}
              </button>
            </div>
          </div>
        </Form>
      )}
    </Formik>
  );
};

export default AddUser;
