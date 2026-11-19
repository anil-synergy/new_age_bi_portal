import React, { useState, useEffect } from 'react';
import { useFormik } from 'formik';
import * as Yup from 'yup';
import InputText from '../common/input-components/textInput';
import { DropDown } from '../common/input-components/dropDown';
import showAlert from '../../utils/alert';
import { addGroupPost, editGroup, getAllGroups } from '../../services/BiServices';

const AddGroup = (props) => {
  const { setshowAddModal, currentGroup, settotalPage, setcurrentPage, setSearch,
    setisPreviousDisabled, setisNextDisabled, setpageSize, setgroups, categories } = props;

  const [groups, setCheckgroups] = useState([]);
  const [disable, setDisable] = useState(false);

  const duplicateNameCheck = (value) => {
    const newreport = currentGroup
      ? groups?.filter((item) => item.value !== currentGroup.id)
      : groups;
    const duplicate = newreport?.map((item) => {
      if ((item.label?.toLowerCase()) === (value?.toLowerCase())) {
        return false;
      }
      return true;
    });
    const result = duplicate?.indexOf(false);
    if (result === -1) {
      return true;
    }
    return false;
  };

  const validationSchema = Yup.object({
    name: Yup.string().trim().required('Field is Required')
      .test('Unique', 'Group Name already exists', (values) => {
        return duplicateNameCheck(values);
      }),
    description: Yup.string().required('Field is Required').nullable(),
    reportCategory: Yup.object().required('Field is Required').nullable()
  });

  const formik = useFormik({
    initialValues: {
      name: '',
      description: '',
      reportCategory: ''
    },
    validationSchema,
    onSubmit: async (values, { resetForm }) => {
      setDisable(true);
      const data = {
        description: values.description,
        name: values.name,
        reportCategory: values.reportCategory.value
      };

      if (currentGroup) {
        editGroup(currentGroup?.id, data)
          .then((res) => {
            if (res?.data) {
              setSearch('');
              setgroups(res?.data?.items);
              settotalPage(res?.data?.totalPages);
              setcurrentPage(res?.data?.currentPage);
              setisPreviousDisabled(!res?.data?.hasPrev);
              setisNextDisabled(!res?.data?.hasNext);
              setpageSize({ value: res?.data?.pageSize, label: `${res?.data?.pageSize} rows` });
              showAlert('Group updated Successfully', 'success');
              setshowAddModal(false);
              setDisable(false);
            }
          });
      } else {
        addGroupPost(data)
          .then((resdata) => {
            if (resdata) {
              setSearch('');
              setgroups(resdata?.items);
              settotalPage(resdata?.totalPages);
              setcurrentPage(resdata?.currentPage);
              setisPreviousDisabled(!resdata?.hasPrev);
              setisNextDisabled(!resdata?.hasNext);
              setpageSize({ value: resdata?.pageSize, label: `${resdata?.pageSize} rows` });
              showAlert('Group added Successfully', 'success');
              resetForm();
              setshowAddModal(false);
              setDisable(false);
            }
          });
      }
    }
  });

  useEffect(() => {
    if (currentGroup) {
      const category = {
        label: currentGroup?.reportCategoryName,
        value: currentGroup?.reportCategory
      };
      formik.setFieldValue('name', currentGroup?.name);
      formik.setFieldValue('description', currentGroup?.description);
      formik.setFieldValue('reportCategory', category);
    }
  }, [currentGroup]);

  useEffect(() => {
    getAllGroups().then((data) => {
      if (data) {
        const groupsData = data?.map(({ name, id }) => ({ label: name, value: id }));
        setCheckgroups(groupsData);
      }
    });
  }, []);

  return (
    <>
      <form className="modal-form">
        <InputText
          name="name"
          label="Name"
          onChange={(value) => {
            formik.setFieldValue('name', value);
          }}
          {...formik.getFieldProps('name')}
          errormessage={formik.touched.name && formik.errors?.name}
        />
        <InputText
          name="description"
          label="Description"
          onChange={(value) => {
            formik.setFieldValue('description', value);
          }}
          {...formik.getFieldProps('description')}
          errormessage={formik.touched.description && formik.errors.description}
        />
        <DropDown
          label="Department or Category"
          name="reportCategory"
          options={categories}
          {...formik.getFieldProps('reportCategory')}
          onChange={(value) => {
            formik.setFieldValue('reportCategory', value);
          }}
          errormessage={formik.touched.reportCategory && formik.errors.reportCategory}
        />
        <div className="modal-box__btn-wrap">
          <div className="modal-box__btn-group">
            <button onClick={() => { setshowAddModal(false); formik.resetForm(); }} type="button" className="btn-secondary btn-md">
              {currentGroup ? 'Close' : 'Cancel'}
            </button>
            <button type="submit" disabled={disable} onClick={formik.handleSubmit} form="myform" className="btn-primary btn-md">
              {currentGroup ? 'Update' : 'Add'}
            </button>
          </div>
        </div>
      </form>
    </>
  );
};

export default AddGroup;
