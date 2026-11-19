import React, { useState, useEffect } from 'react';
import { useFormik } from 'formik';
import * as Yup from 'yup';
import { DropDown } from '../../common/input-components/dropDown';
import ListingMenu from './ListingMenu';
import showAlert from '../../../utils/alert';
import { PermissionUser, getAllEmails, removeUser } from '../../../services/BiServices';
import Checkbox from '../../common/input-components/checkbox';

const UserAcess = (props) => {
  const { usersAssigned, isrls, newReportId, rlsRoleList,
    setshowAddModal, setusersAssigned, isReload, setmodal } = props;

  const [emailList, setemailList] = useState([]);
  const [newReportIdOne] = useState(newReportId);
  const [isChecked, setisChecked] = useState(false);
  const postPermissionUser = (reportId, userId, payload) => {
    PermissionUser(reportId, userId, payload)
      .then((data) => {
        if (data) {
          setusersAssigned(data?.assignedUsers);
          showAlert('User added Successfully', 'success');
          setmodal(false);
          isReload();
        }
      });
  };

  const validationSchema = Yup.object({
    email: Yup.object().required('Field is Required').nullable(),
    newisrls: Yup.boolean().nullable(),
    rls: !isChecked && Yup.array().when('newisrls', {
      is: true,
      then: Yup.array().min(1, 'Field is Required')
    })
  });

  const formik = useFormik({
    initialValues: {
      email: '',
      rls: []
    },
    validationSchema,
    onSubmit: async (values, { resetForm }) => {
      const userId = values.email.value;
      const reportId = newReportIdOne;
      const roll = values.rls ? values?.rls.map((item) => item.label) : null;
      const payload = {
        rolesSelected: roll,
        BypassRLS: isChecked
      };
      postPermissionUser(reportId, userId, payload);
      resetForm();
      formik.setFieldValue('newisrls', isrls);
    }
  });

  const getEmails = () => {
    getAllEmails()
      .then((data) => {
        if (data) {
          const emails = data?.map(({ id, email }) => ({ value: id, label: email }));
          const newusersAssigned = usersAssigned?.map((item) => item?.userEmail);
          const newemails = emails?.filter(
            ({ label }) => !newusersAssigned?.includes(label)
          );
          setemailList(newemails);
        }
      });
  };

  const deleteUser = (id) => {
    const payload = {
      reportId: newReportIdOne,
      mappingUserId: id
    };
    removeUser({ data: payload })
      .then((response) => {
        if (response) {
          setusersAssigned(response?.assignedUsers);
          showAlert('User Deleted', 'success');
        }
      });
  };

  useEffect(() => {
    getEmails();
  }, [usersAssigned]);

  useEffect(() => {
    formik.setFieldValue('newisrls', isrls);
  }, [isrls]);

  return (
    <>
      <form className="modal-form">
        <DropDown
          placeholder="Select Email"
          name="email"
          options={emailList}
          {...formik.getFieldProps('email')}
          onChange={(value) => {
            formik.setFieldValue('email', value);
          }}
          errormessage={formik.touched.email && formik.errors.email}
        />
        {
          isrls && (
            <Checkbox label="Bypass RLS" checked={isChecked} onChange={() => { setisChecked(!isChecked); }} className="mb-1" />
          )
        }
        {!isChecked && isrls && (
          <DropDown
            name="rls"
            placeholder="Select RLS"
            allowMultiple
            options={rlsRoleList}
            {...formik.getFieldProps('rls')}
            onChange={(value) => {
              formik.setFieldValue('rls', value);
            }}
            errormessage={formik.touched.rls && formik.errors?.rls}
          />
        )}
        <div className="modal-form__btn-wrap">
          <button onClick={() => setshowAddModal(false)} type="button" className="btn-secondary btn-md flex-1">
            Cancel
          </button>
          <button type="submit" onClick={formik.handleSubmit} form="myform" className="btn-primary btn-md flex-1">
            Add
          </button>
        </div>
      </form>
      <ListingMenu {...{ isrls, deleteUser, tableHeadName: 'Users', data: usersAssigned, keyName: 'user' }} />
    </>
  );
};

export default UserAcess;
