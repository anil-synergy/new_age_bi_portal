using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using PowerBIPortal.Core.Constants;
using PowerBIPortal.Core.Exceptions;
using PowerBIPortal.Core.Models.Api;
using PowerBIPortal.Core.Models.Dto;
using PowerBIPortal.Core.Models.Entity;
using PowerBIPortal.Data.Interfaces;
using PowerBIPortal.Services.Interfaces;
using Group = PowerBIPortal.Core.Models.Entity.Group;

namespace PowerBIPortal.Services.Services
{
    public class UserGroupService : IUserGroupService
    {
        private readonly IUserRolesRepository _userGroupRepository;
        private readonly IGroupRepository _groupRepository;
        private readonly IUserService _userService;
        private readonly IReportCategoriesRepository _reportCategoriesRepository;
        private readonly IConfiguration _configuration;

        public UserGroupService(IUserRolesRepository userRolesRepository, IGroupRepository groupRepository, IUserService userService,
            IReportCategoriesRepository reportCategoriesRepository, IConfiguration configuration)
        {
            _userGroupRepository = userRolesRepository;
            _groupRepository = groupRepository;
            _userService = userService;
            _reportCategoriesRepository = reportCategoriesRepository;
            _configuration = configuration;
        }

        public async Task<PageModel<UserGroupDetailDto>> CreateGroup(GroupCreateRequest data)
        {
            PagedRequest pagedRequest = new PagedRequest();
            using (var transaction = await _groupRepository.BeginTransactionAsync())
            {
                try
                {
                    Group group = new Group();
                    group.Id = Guid.NewGuid();
                    group.Name = data.Name;
                    group.Description = data.Description;
                    group.ReportCategory = data.ReportCategory;

                    await _groupRepository.SaveAsync(group);

                    await transaction.CommitAsync();
                }
                catch (Exception)
                {
                    await transaction.RollbackAsync();
                    throw;
                }
            }
            pagedRequest.Page = 1;
            pagedRequest.PageSize = 20;
            return await GetAllGroup(pagedRequest);
        }

        public async Task<PageModel<UserGroupDetailDto>> GetAllGroup(PagedRequest pagedRequest)
        {
            var userInfo = await _userService.UserDetailByEmail();
            var departments = await _reportCategoriesRepository.GetDepartmentofUser(userInfo.Id);
            var adminName = _configuration.GetValue<string>("SystemAdminRoleName");
            var roles = await GetRolesByEmailId(userInfo.EmailAddress);
            if (departments.Any() && !roles.Contains(adminName))
            {
                return await _groupRepository.GetAllGroupByDepartment(pagedRequest, departments);
            }
            else
            {
                return await _groupRepository.GetAllGroup(pagedRequest);
            }
        }

        public async Task<List<string>> GetRolesByEmailId(string emailId)
        {
            return await _userGroupRepository.GetRolesByEmailId(emailId);
        }
        public async Task<PageModel<UserGroupDetailDto>> UpdateGroup(Guid id, GroupCreateRequest data)
        {
            PagedRequest pagedRequest = new PagedRequest();
            using (var transaction = await _groupRepository.BeginTransactionAsync())
            {
                try
                {
                    Group existingGroup = await _groupRepository.FindByIdAsync(id);
                    if (existingGroup == null)
                    {
                        throw new AppException(ValidationMessages.GroupNotFound);
                    }
                    existingGroup.Name = data.Name;
                    existingGroup.Description = data.Description;
                    existingGroup.ReportCategory = data.ReportCategory;

                    await _groupRepository.UpdateAsync(existingGroup);
                    
                    await transaction.CommitAsync();
                }
                catch (Exception)
                {
                    await transaction.RollbackAsync();
                    throw;
                }
            }
            pagedRequest.Page = 1;
            pagedRequest.PageSize = 20;
            return await GetAllGroup(pagedRequest);
        }

        public async Task DeleteGroup(Guid groupId)
        {
            var existingData = await _groupRepository.FindByIdAsync(groupId);
            if (existingData == null)
            {
                throw new AppException(ValidationMessages.GroupNotFound);
            }
            await _groupRepository.DeleteByIdAsync(groupId);
        }

        public async Task<PageModel<UserGroupDetailDto>> MapMultipleUsers(UserGroupMapDto users, Guid groupId)
        {
            PagedRequest pagedRequest = new PagedRequest();
            var request = users.UserId.Select(p => new UserGroups
            {
                UserId = p,
                RoleId = groupId
            }).ToList();
            await _userGroupRepository.SaveAllAsync(request);

            pagedRequest.Page = users.Page;
            pagedRequest.PageSize = users.PageSize;
            pagedRequest.Search = users.Search;
            return await GetAllGroup(pagedRequest);
        }

        public async Task<PageModel<UserGroupDetailDto>> DeleteUserFromGroup(Guid groupId, UserGroupMapDto users)
        {
            PagedRequest pagedRequest = new PagedRequest();
            var data = await _userGroupRepository.Where(i => i.UserId == users.UserId.First() && i.RoleId == groupId).FirstOrDefaultAsync();
            if (data == null)
            {
                throw new AppException(ValidationMessages.DataNotFound);
            }
            await _userGroupRepository.DeleteByIdAsync(data.Id);

            pagedRequest.Page = users.Page;
            pagedRequest.PageSize = users.PageSize;
            pagedRequest.Search = users.Search;
            return await GetAllGroup(pagedRequest);
        }

        public async Task<List<GroupDetailsDto>> GetAllRoles()
        {
            var userInfo = await _userService.UserDetailByEmail();
            var departments = await _reportCategoriesRepository.GetDepartmentofUser(userInfo.Id);
            List<GroupDetailsDto> data = new ();
            List<Group> result = new();

            var adminName = _configuration.GetValue<string>("SystemAdminRoleName");
            var roles = await GetRolesByEmailId(userInfo.EmailAddress);
            if (departments.Any() && !roles.Contains(adminName))
            {
                result = await _groupRepository.GetAllRolesofDepartmentAdmin(departments);
            }
            else
            {
                result = await _groupRepository.GetAllRoles();
            }
            data = result.Select(p => new GroupDetailsDto
            {
                Id = p.Id,
                Name = p.Name,
                Description = p.Description,
                CreatedAt = p.CreatedAt,
                CreatedBy = p.CreatedBy?.Name,
                UpdatedAt = p.UpdatedAt,
                UpdatedBy = p.UpdatedBy?.Name,
            }).ToList();
            return data;
        }
    }
}
