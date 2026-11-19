using PowerBIPortal.Core.Models.Api;
using PowerBIPortal.Core.Models.Dto;
using PowerBIPortal.Core.Models.Entity;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Services.Interfaces
{
    public interface IUserGroupService
    {
        Task<List<string>> GetRolesByEmailId(string emailId);

        Task<PageModel<UserGroupDetailDto>> GetAllGroup(PagedRequest pagedRequest);
        Task<PageModel<UserGroupDetailDto>> CreateGroup(GroupCreateRequest data);
        Task<PageModel<UserGroupDetailDto>> UpdateGroup(Guid id, GroupCreateRequest data);
        Task DeleteGroup(Guid groupId);
        Task<PageModel<UserGroupDetailDto>> MapMultipleUsers(UserGroupMapDto users, Guid groupId);
        Task<PageModel<UserGroupDetailDto>> DeleteUserFromGroup(Guid groupId, UserGroupMapDto users);
        Task<List<GroupDetailsDto>> GetAllRoles();

    }
}
