/*eslint-disable*/
import React, { createContext, useEffect, useState } from 'react';
import { ClipLoader } from 'react-spinners';
import { useHistory, useParams } from 'react-router-dom';
import axios from '../utils/axios';
// eslint-disable-next-line import/no-cycle
import SideBar from './common/sideBar';

const myContext = createContext();

const MyContextProvider = (props) => {
  const [reportId, setreportId] = useState(null);
  const [reportName, setreportName] = useState(null);
  const [permissionList, setpermissionList] = useState([]);
  const [allPermissionList, setallPermissionList] = useState({});
  const [originalMenuData, setoriginalMenuData] = useState([]);
  const [isAuth, setIsAuth] = useState(false);
  const [isSuperAdmin, setSuperAdmin] = useState(false);
  const [isDepAdmin, setDepAdmin] = useState(false);

  const history = useHistory();
  const params = useParams();

  const getReport = async (id, title) => {
    history.push(`/dashboard/${id}`, { reportName: title });
  };

  useEffect(() => {
    if (props?.location?.state?.reportName) {
      setreportName(props?.location?.state?.reportName);
    }
  }, [props]);

  useEffect(() => {
    if (params?.reportId) {
      setreportId(params?.reportId);
    }
  }, [params?.reportId]);

  const fetchMenuData = async () => {
    const data = await axios.get('/bi-report-api/v1/report/reports');
    if (data?.data) {
      const arrayAscending = data?.data
        .sort((a, b) => a.categoryName - b.categoryName);
      setoriginalMenuData(arrayAscending);
    }
  };

  const getUserPermissions = async () => {
    const data = await axios.get('/bi-report-api/v1/user/userInfo');
    if(data.status === 401) {
      window.location.replace('/login');
    }
    else if (data?.data) {
      setSuperAdmin(data?.data?.isSuperAdmin);
      setDepAdmin(data?.data?.isDepartmentAdmin);

      setallPermissionList(data?.data);
      setpermissionList(data?.data?.group);
      fetchMenuData().catch(console.error);
      setIsAuth(true);
    } else {
      setIsAuth(false);
    }
  };

  useEffect(() => {
    if (permissionList.length === 0) {
      getUserPermissions().catch(console.error);
    }
  }, []);

  const { children } = props;
  return (
    <div className="main-wrap">

      {
      <myContext.Provider
        value={{
          reportId,
          setreportId,
          reportName,
          setreportName,
          getReport,
          permissionList,
          allPermissionList,
          originalMenuData,
          setoriginalMenuData,
          isSuperAdmin,
          isDepAdmin,
          fetchMenuData
        }}
      >
        {isAuth
          ? (
            <>
              <SideBar />
              {children}
            </>
          ) : (
            <div className="loader">
              <ClipLoader loading color="#333869" />
            </div>
          )}
      </myContext.Provider>
}
    </div>
  );
};

export { MyContextProvider, myContext };
