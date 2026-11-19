import React, { useEffect, useState } from 'react';
import axios from '../../utils/axios';
import GroupAcess from './permisions/GroupAcess';
import UserAcess from './permisions/UserAcess';

const SetPermissions = ({ permissionId, setshowAddModal, setmodal, handleReload }) => {
  const [showgroupAcess, setshowgroupAcess] = useState(true);
  const [groupsAssigned, setgroupsAssigned] = useState([]);
  const [usersAssigned, setusersAssigned] = useState([]);
  const [isrls, setrlsEnabled] = useState(null);
  const [rlsRoleList, setrlsRoleList] = useState([]);
  const [newReportId] = useState(permissionId);

  const getPermissionList = async (Id) => {
    const data = await axios.get(`bi-report-api/v1/admin/reports/${Id}`);
    if (data?.data) {
      const { assignedUsers, assignedGroup, rlsEnabled, powerBiRlsRole } = data?.data;
      setgroupsAssigned(assignedGroup);
      setusersAssigned(assignedUsers);
      setrlsEnabled(rlsEnabled);
      const roles = powerBiRlsRole?.map((item) => ({ label: item.rlsRole, value: item.id }));
      setrlsRoleList(roles);
    }
  };

  // const addGroup = async (groupId, payLoad) => {
  //   const data = await axios.post
  // (`bi-report-api/v1/admin/reports/${permissionId}/permission/group/${groupId}`, payLoad);
  //   // eslint-disable-next-line no-debugger
  //   // debugger;
  //   if (data?.data) {
  //     const { assignedUsers, assignedGroup, rlsEnabled, powerBiRlsRole } = data?.data;
  //     setgroupsAssigned(assignedGroup);
  //     setusersAssigned(assignedUsers);
  //     setrlsEnabled(rlsEnabled);

  //     const roles = powerBiRlsRole?.map((item) => ({ label: item, value: item }));
  //     setrlsRoleList(roles);
  //   }
  // };

  useEffect(() => {
    getPermissionList(permissionId);
  }, []);

  return (
    <div>
      <div className="flex tab-btn-wrap">
        <button className={`${showgroupAcess ? 'btn tab-button active' : 'btn tab-button'} text-sm`} onClick={() => setshowgroupAcess(true)} type="button">
          Manage Group Access
        </button>
        <button className={`${showgroupAcess ? 'btn tab-button' : 'btn tab-button active'} text-sm`} onClick={() => setshowgroupAcess(false)} type="button">
          Manage User Access
        </button>
      </div>

      {showgroupAcess
        ? (
          <GroupAcess
            setshowAddModal={setshowAddModal}
            newReportId={newReportId}
            setgroupsAssigned={setgroupsAssigned}
            groupsAssigned={groupsAssigned}
            isrls={isrls}
            rlsRoleList={rlsRoleList}
            isReload={handleReload}
            setmodal={setmodal}
          />
        ) : (
          <UserAcess
            setshowAddModal={setshowAddModal}
            newReportId={newReportId}
            setusersAssigned={setusersAssigned}
            usersAssigned={usersAssigned}
            isrls={isrls}
            rlsRoleList={rlsRoleList}
            isReload={handleReload}
            setmodal={setmodal}
          />
        )}
    </div>
  );
};

export default SetPermissions;
