/* eslint no-use-before-define: ["error", { "variables": false }] */
import React, { useState, useRef, useEffect } from 'react';
import { useFormik } from 'formik';
import * as Yup from 'yup';
import { DropDown } from '../common/input-components/dropDown';
import Checkbox from '../common/input-components/checkbox';
import showAlert from '../../utils/alert';
import { addReportPost, editReports } from '../../services/BiServices';
import InputText from '../common/input-components/textInput';
import ConfirmModal from '../common/confirmModal';
import axios from '../../utils/axios';
import plus from '../../images/icons/plus_icon.svg';
import iconTrash from '../../img/ico-trash.svg';

const AddNewReport = (props) => {
  const { setshowAddModal, setreports, settotalPage, setSearch,
    currentgetReport, setcurrentPage, setisPreviousDisabled, categories,
    setisNextDisabled, setpageSize, currentReport, getallReport } = props;

  const zeroId = '00000000-0000-0000-0000-000000000000';

  const biRlsRole = {
    rlsRole: '',
    id: zeroId
  };

  const modalref = useRef(null);

  const [biRole, setBiRole] = useState([biRlsRole]);
  const [isChanged, setIsChanged] = useState(false);
  const [disable, setDisable] = useState(false);
  const [originalMenuData, setoriginalMenuData] = useState([]);

  const fetchMenuData = async () => {
    const data = await axios.get('/bi-report-api/v1/report/reports');
    if (data?.data) {
      const arrayAscending = data?.data
        .sort((a, b) => a.categoryName - b.categoryName);
      setoriginalMenuData(arrayAscending);
    }
  };

  const duplicateNameCheck = (value) => {
    const newreport = currentReport
      ? originalMenuData?.filter((item) => item.id !== currentReport.id)
      : originalMenuData;
    const duplicate = newreport?.map((item) => {
      if ((item.title?.toLowerCase() === value?.toLowerCase())
        && (item.categoryName === formik.values.category.label)) {
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
    reportName: Yup.string()
      .trim()
      .required('Field is Required')
      .test('Unique', 'Report Name already exists', (values) => {
        return duplicateNameCheck(values);
      }),
    reportId: Yup.string().uuid('Invalid Report ID').required('Field is Required').nullable(),
    workspaceId: Yup.string().uuid('Invalid Workspace ID').required('Field is Required').nullable(),
    category: Yup.object().required('Field is Required').nullable(),
    rls: Yup.boolean().nullable(),
    powerBiRlsRole: Yup.array().when('rls', {
      is: true,
      then: Yup.array().of(
        Yup.object({
          rlsRole: Yup.string().required('Field is Required')
        })
      )
    })
  });

  const formik = useFormik({
    initialValues: {
      reportName: '',
      reportId: '',
      category: '',
      workspaceId: '',
      description: '',
      reportpagination: true,
      rls: false,
      powerBiRlsRole: [biRlsRole]
    },
    validationSchema,
    onSubmit: async (values, { resetForm }) => {
      setDisable(true);
      const data = { values };
      const savePayload = {
        name: data?.values.reportName,
        description: data?.values.description,
        reportCategory: data?.values.category.value,
        powerBiReportId: data?.values.reportId,
        powerWorkSpaceId: data?.values.workspaceId,
        rlsEnabled: data?.values.rls,
        enablePagination: data?.values.reportpagination,
        powerBiRlsRole: formik.values.rls === true ? data?.values?.powerBiRlsRole : [{}]
      };
      const updatePayload = {
        ...savePayload,
        id: currentReport?.id
      };
      if (currentReport) {
        try {
          if (isChanged) {
            await modalref.current.open('There are changes in RLS, this will modify the existing permission mapping, do you still want to continue?');
          }
        } catch {
          return;
        }
        editReports(currentReport?.id, updatePayload).then((res) => {
          if (res?.data) {
            setSearch('');
            setreports(res?.data?.items);
            settotalPage(res?.data?.totalPages);
            setcurrentPage(res?.data?.currentPage);
            setisPreviousDisabled(!res?.data?.hasPrev);
            setisNextDisabled(!res?.data?.hasNext);
            setpageSize({ value: res?.data?.pageSize, label: `${res?.data?.pageSize} rows` });
            showAlert('Report updated Successfully', 'success');
            setshowAddModal(false);
            setIsChanged(false);
            getallReport(currentReport.id);
            setDisable(false);
          }
        });
      } else {
        addReportPost(savePayload).then((resdata) => {
          if (resdata) {
            setSearch('');
            setreports(resdata?.items);
            settotalPage(resdata?.totalPages);
            setcurrentPage(resdata?.currentPage);
            setisPreviousDisabled(!resdata?.hasPrev);
            setisNextDisabled(!resdata?.hasNext);
            setpageSize({ value: resdata?.pageSize, label: `${resdata?.pageSize} rows` });
            showAlert('Report added Successfully', 'success');
            resetForm();
            setshowAddModal(false);
            setDisable(false);
          }
        });
      }
    }
  });

  const addBiRlsRoleRow = () => {
    const newPowerBiRlsRole = formik.values.powerBiRlsRole;
    newPowerBiRlsRole.splice(0, 0, biRlsRole);
    setBiRole(newPowerBiRlsRole);
    formik.setFieldValue('powerBiRlsRole', newPowerBiRlsRole);
  };
  const removeBiRlsRoleRow = async (index) => {
    if (biRole.length > 1) {
      const newPowerBiRlsRole = formik.values.powerBiRlsRole;
      newPowerBiRlsRole.splice(index, 1);
      setBiRole(newPowerBiRlsRole);
      formik.setFieldValue('powerBiRlsRole', newPowerBiRlsRole);
    } else {
      showAlert('Minimum one RLS Role is required', 'error');
    }
  };

  const newCategory = {
    label: currentReport?.reportCategory?.name,
    value: currentReport?.reportCategory?.id
  };
  const powerBiRlsRole = currentReport?.powerBiRlsRole
    ? currentReport?.powerBiRlsRole
    : [biRlsRole];

  useEffect(() => {
    if (currentReport) {
      formik.setFieldValue('reportName', currentReport?.title);
      formik.setFieldValue('reportId', currentReport?.powerBiReportId);
      formik.setFieldValue('category', newCategory);
      formik.setFieldValue('description', currentReport?.description);
      formik.setFieldValue('workspaceId', currentReport?.workspaceId);
      formik.setFieldValue('rls', currentReport?.rlsEnabled);
      formik.setFieldValue('reportpagination', currentReport?.enablePagination);
      formik.setFieldValue('powerBiRlsRole', powerBiRlsRole);
      setBiRole(powerBiRlsRole);
    }
  }, [currentReport]);

  useEffect(() => {
    fetchMenuData();
  }, []);

  useEffect(() => {
    if (formik.values.rls !== currentReport?.rlsEnabled) {
      setIsChanged(true);
    } else if (formik.values.powerBiRlsRole
      && formik.values.powerBiRlsRole?.length
      && currentgetReport) {
      if (currentgetReport.length !== formik.values.powerBiRlsRole.length
        || JSON.stringify(currentgetReport) !== JSON.stringify(formik.values.powerBiRlsRole)) {
        setIsChanged(true);
      } else {
        setIsChanged(false);
      }
    } else {
      setIsChanged(false);
    }
  }, [formik.values.rls, formik.values?.powerBiRlsRole?.length, formik.values?.powerBiRlsRole]);

  return (
    <>
      <ConfirmModal
        ref={modalref}
      />
      <form className="modal-form">
        <div className="grid-col-2">
          <InputText
            name="reportName"
            label="Report Name"
            onChange={(value) => {
              formik.setFieldValue('reportName', value);
            }}
            {...formik.getFieldProps('reportName')}
            errormessage={formik.touched.reportName && formik.errors.reportName}
          />
          <InputText
            name="reportId"
            label="Report ID"
            onChange={(value) => {
              formik.setFieldValue('reportId', value);
            }}
            {...formik.getFieldProps('reportId')}
            errormessage={formik.touched.reportId && formik.errors.reportId}
          />
        </div>
        <div>
          <InputText
            name="workspaceId"
            label="Workspace ID"
            onChange={(value) => {
              formik.setFieldValue('workspaceId', value);
            }}
            {...formik.getFieldProps('workspaceId')}
            errormessage={formik.touched.workspaceId && formik.errors.workspaceId}
          />
        </div>
        <div>
          <DropDown
            label="Report Department/Category"
            name="category"
            options={categories}
            {...formik.getFieldProps('category')}
            onChange={(value) => {
              formik.setFieldValue('category', value);
            }}
            errormessage={formik.touched.category && formik.errors.category}
          />
        </div>
        <div>
          <InputText
            name="description"
            label="Description"
            onChange={(value) => {
              formik.setFieldValue('description', value);
            }}
            {...formik.getFieldProps('description')}
          />
        </div>
        <div className="grid-col-2">
          <Checkbox
            name="reportpagination"
            label="Enable pagination"
            className="align-self-start"
            checked={formik.values.reportpagination === true}
            onChange={(value) => {
              formik.setFieldValue('reportpagination', value);
            }}
            {...formik.getFieldProps('reportpagination')}
          />
          <Checkbox
            name="rls"
            label="Enable RLS"
            className="align-self-start"
            checked={formik.values.rls === true}
            onChange={(value) => {
              formik.setFieldValue('rls', value);
            }}
            {...formik.getFieldProps('rls')}
          />
        </div>
        {formik.values.rls === true && (
          <>
            <div className="rls-add">
              <div className="rls-add__head">
                <div className="f-bold font-sm">Manage RLS Roles</div>
                <button className=" rls-add__btn" type="button" title="Delete" onClick={() => addBiRlsRoleRow()}>
                  <img src={plus} alt="" />
                </button>
              </div>
              <div className="rls-add__body">
                {_.map(biRole, (item, index) => {
                  return (
                    <div className="rls-add__set">
                      <InputText
                        name={`powerBiRlsRole.${index}.rlsRole`}
                        placeholder="Enter RLS"
                        onChange={async (value) => {
                          formik.setFieldValue(`powerBiRlsRole.${index}.rlsRole`, value);
                        }}
                        {...formik.getFieldProps(`powerBiRlsRole.${index}.rlsRole`)}
                        errormessage={
                          formik.touched.powerBiRlsRole
                          && formik.errors.powerBiRlsRole
                          && formik.errors.powerBiRlsRole[index]
                          && formik.errors.powerBiRlsRole[index].rlsRole
                        }
                      />
                      <button className="rls-add__btn" type="button" title="Delete" onClick={() => removeBiRlsRoleRow(index)}>
                        <img src={iconTrash} alt="" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
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
              {currentReport ? 'Close' : 'Cancel'}
            </button>
            <button type="submit" disabled={disable} onClick={formik.handleSubmit} form="myform" className="btn-primary btn-md">
              {currentReport ? 'Update' : 'Add'}
            </button>
          </div>
        </div>
      </form>
    </>
  );
};

export default AddNewReport;
