import axios from '../utils/axios';
import apiEndPoints from '../utils/apiUrlConstants';

const {
  permission,
  allGroups,
  allEmails,
  permissionGroupDelete,
  permissionUserDelete,
  addUser,
  allRoles,
  addGroup,
  allCategory,
  addCategory,
  allUsers
} = apiEndPoints;

export const deleteGroupUser = async (groupId, payload) => {
  try {
    const response = await axios.delete(`${addGroup}/${groupId}/users`, payload);
    return response;
  } catch (error) {
    return Promise.reject(error);
  }
};

export const addGroupUsers = async (groupId, payload) => {
  try {
    const response = await axios.post(`${addGroup}/${groupId}/users`, payload);
    return response.data;
  } catch (error) {
    return Promise.reject(error);
  }
};

export const getAllUsers = async () => {
  try {
    const response = await axios.get(`${allUsers}`);
    return response.data;
  } catch (error) {
    return Promise.reject(error);
  }
};

export const addCategories = async (payload) => {
  try {
    const response = await axios.post(`${addCategory}`, payload);
    return response.data;
  } catch (error) {
    return Promise.reject(error);
  }
};

export const deleteCategory = async (categoryId) => {
  try {
    const response = await axios.delete(`${addCategory}/${categoryId}`);
    return response;
  } catch (error) {
    return Promise.reject(error);
  }
};

export const editCategories = async (categoryId, payload) => {
  try {
    const res = await axios.put(`${addCategory}/${categoryId}`, payload);
    return {
      success: true,
      data: res.data
    };
  } catch (err) {
    return Promise.reject(err);
  }
};

export const addGroupPost = async (payload) => {
  try {
    const response = await axios.post(`${addGroup}`, payload);
    return response.data;
  } catch (error) {
    return Promise.reject(error);
  }
};

export const addReportPost = async (payload) => {
  try {
    const response = await axios.post(`${permission}`, payload);
    return response.data;
  } catch (error) {
    return Promise.reject(error);
  }
};

export const getReport = async (reportId) => {
  try {
    const response = await axios.get(`${permission}/${reportId}`);
    return response.data;
  } catch (error) {
    return Promise.reject(error);
  }
};

export const deleteReport = async (reportId) => {
  try {
    const response = await axios.delete(`${permission}/${reportId}`);
    return response;
  } catch (error) {
    return Promise.reject(error);
  }
};

export const editGroup = async (groupId, payload) => {
  try {
    const res = await axios.put(`${addGroup}/${groupId}`, payload);
    return {
      success: true,
      data: res.data
    };
  } catch (err) {
    return Promise.reject(err);
  }
};

export const deleteGroup = async (groupId) => {
  try {
    const response = await axios.delete(`${addGroup}/${groupId}`);
    return response;
  } catch (error) {
    return Promise.reject(error);
  }
};

export const getAllCategories = async () => {
  try {
    const response = await axios.get(`${allCategory}`);
    return response.data;
  } catch (error) {
    return Promise.reject(error);
  }
};

export const getAllRoles = async () => {
  try {
    const response = await axios.get(`${allRoles}`);
    return response.data;
  } catch (error) {
    return Promise.reject(error);
  }
};

export const AddUserPost = async (payload) => {
  try {
    const response = await axios.post(`${addUser}`, payload);
    return response.data;
  } catch (error) {
    return Promise.reject(error);
  }
};

export const PermissionGroup = async (reportId, groupId, payload) => {
  try {
    const response = await axios.post(`${permission}/${reportId}/permission/group/${groupId}`, payload);
    return response.data;
  } catch (error) {
    return Promise.reject(error);
  }
};

export const PermissionUser = async (reportId, userId, payload) => {
  try {
    const response = await axios.post(`${permission}/${reportId}/permission/user/${userId}`, payload);
    return response.data;
  } catch (error) {
    return Promise.reject(error);
  }
};

export const getAllGroups = async () => {
  try {
    const response = await axios.get(`${allGroups}`);
    return response.data;
  } catch (error) {
    return Promise.reject(error);
  }
};

export const getAllEmails = async () => {
  try {
    const response = await axios.get(`${allEmails}`);
    return response.data;
  } catch (error) {
    return Promise.reject(error);
  }
};

export const removeGroup = async (payload) => {
  try {
    const response = await axios.delete(`${permissionGroupDelete}`, payload);
    return response.data;
  } catch (error) {
    return Promise.reject(error);
  }
};

export const removeUser = async (payload) => {
  try {
    const response = await axios.delete(`${permissionUserDelete}`, payload);
    return response.data;
  } catch (error) {
    return Promise.reject(error);
  }
};

export const EditUser = async (userId, payload) => {
  try {
    const res = await axios.put(`${addUser}/${userId}`, payload);
    return {
      success: true,
      data: res.data
    };
  } catch (err) {
    return Promise.reject(err);
  }
};

export const deleteUser = async (userId) => {
  try {
    const response = await axios.delete(`${addUser}/${userId}`);
    return response;
  } catch (error) {
    return Promise.reject(error);
  }
};

export const editReports = async (reportId, payload) => {
  try {
    const res = await axios.put(`${permission}/${reportId}`, payload);
    return {
      success: true,
      data: res.data
    };
  } catch (err) {
    return Promise.reject(err);
  }
};
