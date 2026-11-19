import React, { useState, useEffect } from 'react';
import { useFormik } from 'formik';
import * as Yup from 'yup';
import InputText from '../common/input-components/textInput';
import { DropDown } from '../common/input-components/dropDown';
import showAlert from '../../utils/alert';
import { addCategories, editCategories, getAllCategories, getAllUsers } from '../../services/BiServices';

const AddCategory = (props) => {
  const { setshowAddModal, currentCategory, settotalPage, setcurrentPage, setSearch,
    setisPreviousDisabled, setisNextDisabled, setpageSize, setCategories } = props;

  const [userData, setAllUsers] = useState([]);
  const [allCategories, setAllCategories] = useState([]);
  const [disable, setDisable] = useState(false);

  const duplicateNameCheck = (value) => {
    const newreport = currentCategory
      ? allCategories?.filter((item) => item.value !== currentCategory.id)
      : allCategories;
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
      .test('Unique', 'Category Name already exists', (values) => {
        return duplicateNameCheck(values);
      }),
    description: Yup.string().nullable()
  });

  const formik = useFormik({
    initialValues: {
      id: '',
      name: '',
      description: '',
      admin: [],
      parentId: '',
      parentCategoryName: ''
    },
    validationSchema,
    onSubmit: async (values, { resetForm }) => {
      setDisable(true);
      const data = { ...values };
      const newAdmin = data.admin.map((item) => ({ id: item.value, name: item.label }));
      const payload = {
        departmentAdmin: newAdmin,
        description: data?.description,
        name: data?.name,
        parentId: data?.parentCategoryName?.value || null,
        parentCategoryName: null
      };
      if (currentCategory) {
        editCategories(currentCategory?.id, payload)
          .then((res) => {
            if (res?.data) {
              setSearch('');
              setCategories(res?.data?.items);
              settotalPage(res?.data?.totalPages);
              setcurrentPage(res?.data?.currentPage);
              setisPreviousDisabled(!res?.data?.hasPrev);
              setisNextDisabled(!res?.data?.hasNext);
              setpageSize({ value: res?.data?.pageSize, label: `${res?.data?.pageSize} rows` });
              showAlert('Category updated Successfully', 'success');
              setshowAddModal(false);
              setDisable(false);
            }
          }).finally(() => {
            setshowAddModal(false);
            setDisable(false);
          });
      } else {
        addCategories(payload)
          .then((resdata) => {
            if (resdata) {
              setSearch('');
              setCategories(resdata?.items);
              settotalPage(resdata?.totalPages);
              setcurrentPage(resdata?.currentPage);
              setisPreviousDisabled(!resdata?.hasPrev);
              setisNextDisabled(!resdata?.hasNext);
              setpageSize({ value: resdata?.pageSize, label: `${resdata?.pageSize} rows` });
              showAlert('Category added Successfully', 'success');
              resetForm();
              setshowAddModal(false);
              setDisable(false);
            }
          }).finally(() => {
            setshowAddModal(false);
            setDisable(false);
          });
      }
    }
  });

  useEffect(() => {
    if (currentCategory) {
      const departmentAdmin = currentCategory?.departmentAdmin.map(({ id, email }) => (
        { value: id, label: email }
      ));
      const { parentId, parentCategoryName } = currentCategory;
      formik.setFieldValue('name', currentCategory?.name);
      formik.setFieldValue('description', currentCategory?.description);
      formik.setFieldValue('admin', departmentAdmin);
      formik.setFieldValue('parentCategoryName', { value: parentId, label: parentCategoryName });
    }
  }, [currentCategory]);

  useEffect(() => {
    getAllCategories().then((data) => {
      if (data) {
        const newdata = data?.map(({ name, id }) => ({ label: name, value: id }));
        setAllCategories(newdata);
      }
    });
    getAllUsers().then((data) => {
      if (data) {
        const newData = data?.map(({ email, id }) => ({ label: email, value: id }));
        setAllUsers(newData);
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
          name="name"
          label="Parent Category"
          options={allCategories}
          {...formik.getFieldProps('parentCategoryName')}
          onChange={(value) => {
            formik.setFieldValue('parentCategoryName', value);
          }}
        />

        <DropDown
          name="admin"
          label="Admin"
          allowMultiple
          options={userData}
          {...formik.getFieldProps('admin')}
          onChange={(value) => {
            formik.setFieldValue('admin', value);
          }}
        />
        <div className="modal-box__btn-wrap">
          <div className="modal-box__btn-group">
            <button onClick={() => { setshowAddModal(false); formik.resetForm(); }} type="button" className="btn-secondary btn-md">
              {currentCategory ? 'Close' : 'Cancel'}
            </button>
            <button type="submit" disabled={disable} onClick={formik.handleSubmit} form="myform" className="btn-primary btn-md">
              {currentCategory ? 'Update' : 'Add'}
            </button>
          </div>
        </div>
      </form>
    </>
  );
};

export default AddCategory;
