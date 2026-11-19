import React, { useState, useEffect } from 'react';
import { useFormik } from 'formik';
import * as Yup from 'yup';
import { DropDown } from '../../common/input-components/dropDown';
import ListingMenu from './ListingMenu';
import showAlert from '../../../utils/alert';
import { PermissionGroup, getAllGroups, removeGroup } from '../../../services/BiServices';
import Checkbox from '../../common/input-components/checkbox';

const GroupAcess = (props) => {
  const { setshowAddModal, newReportId, setgroupsAssigned,
    groupsAssigned, isrls, rlsRoleList, isReload, setmodal } = props;
  const [groups, setgroups] = useState([]);
  const [newReportIdOne] = useState(newReportId);
  const [isChecked, setisChecked] = useState(false);
  const postPermissionGroup = (reportId, groupId, payload) => {
    PermissionGroup(reportId, groupId, payload)
      .then((data) => {
        if (data) {
          setgroupsAssigned(data?.assignedGroup);
          showAlert('Group added Successfully', 'success');
          isReload();
          setmodal(false);
        }
      });
  };

  const validationSchema = Yup.object({
    groupName: Yup.object().required('Field is Required').nullable(),
    // .test('groupName-exists', 'Already Exists', (item) => groupsAssigned.forEach((company) => {
    //   company.group === item.label
    // })),

    newisrls: Yup.boolean().nullable(),
    rls: !isChecked && Yup.array().when('newisrls', {
      is: true,
      then: Yup.array().min(1, 'Field is Required')
    })
  });

  const formik = useFormik({
    initialValues: {
      groupName: '',
      rls: []
    },
    validationSchema,
    onSubmit: async (values, { resetForm }) => {
      const groupId = values.groupName.value;
      const reportId = newReportIdOne;
      const roll = isrls && values.rls ? values?.rls?.map((item) => item.label) : null;
      const payload = {
        rolesSelected: roll,
        BypassRLS: isChecked

      };
      postPermissionGroup(reportId, groupId, payload);
      resetForm();
      formik.setFieldValue('newisrls', isrls);
    }
  });

  const fetchAllGroups = () => {
    getAllGroups().then((data) => {
      if (data) {
        const updategroupsData = data?.filter((item) => item.name !== 'System Admin');
        const groupsData = updategroupsData?.map(({ name, id }) => ({ label: name, value: id }));
        const newGroupsAssigned = groupsAssigned?.map((item) => item.group);
        const newGroupsData = groupsData?.filter(
          ({ label }) => !newGroupsAssigned?.includes(label)
        );
        setgroups(newGroupsData);
      }
    });
  };

  const deleteGroup = (id) => {
    const payload = {
      reportId: newReportIdOne,
      mappingGroupId: id
    };
    removeGroup({ data: payload })
      .then((response) => {
        if (response) {
          setgroupsAssigned(response?.assignedGroup);
          showAlert('Group Deleted', 'success');
        }
      });
  };

  useEffect(() => {
    fetchAllGroups();
  }, [groupsAssigned]);

  useEffect(() => {
    formik.setFieldValue('newisrls', isrls);
  }, [isrls]);

  return (
    <>
      <form className="modal-form">
        <DropDown
          placeholder="Select Group Name"
          name="groupName"
          options={groups}
          {...formik.getFieldProps('groupName')}
          onChange={(value) => {
            formik.setFieldValue('groupName', value);
          }}
          errormessage={formik.touched.groupName && formik.errors.groupName}
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
      <ListingMenu {...{ isrls, deleteGroup, tableHeadName: 'Group', data: groupsAssigned, keyName: 'group' }} />
    </>
  );
};

export default GroupAcess;
