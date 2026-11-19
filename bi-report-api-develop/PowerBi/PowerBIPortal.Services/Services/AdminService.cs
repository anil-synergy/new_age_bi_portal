using AutoMapper;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using PowerBIPortal.Core.Models.Api;
using PowerBIPortal.Core.Models.Dto;
using PowerBIPortal.Core.Models.Entity;
using PowerBIPortal.Core.User;
using PowerBIPortal.Data.Interfaces;
using PowerBIPortal.Services.Interfaces;

namespace PowerBIPortal.Services.Services
{
    public class AdminService : IAdminService
    {
        private readonly IUsersRepository _usersRepository;
        private readonly IGroupRepository _roleRepository;
        private readonly IMapper _mapper;
        private readonly IApplicationUser _applicationUser;
        private readonly IReportService _reportService;
        private readonly IReportCategorySevice _reportCategorySevice;
        private readonly IUserGroupService _userGroupService;
        private readonly IUserService _userService;
        private readonly IConfiguration _configuration;

        public AdminService(IUsersRepository usersRepository, IGroupRepository roleRepository, IMapper mapper,
            IApplicationUser applicationUser, IReportService reportService, IReportCategorySevice reportCategorySevice,
            IUserGroupService userGroupService, IUserService userService,IConfiguration configuration)
        {
            _usersRepository = usersRepository;
            _roleRepository = roleRepository;
            _mapper = mapper;
            _applicationUser = applicationUser;
            _reportService = reportService;
            _reportCategorySevice = reportCategorySevice;
            _userGroupService = userGroupService;
            _userService = userService;
            _configuration = configuration; 
        }


        #region USERS
        public async Task<PageModel<UserDetailDto>> GetAllUsers(PagedRequest pagedRequest)
        {
            return await _userService.GetAllUers(pagedRequest);
        }
        public async Task<UserInformationDto> GetUserInformation()
        {
            Guid userId = Guid.Empty;
            var user = await UserAuthorizationCheck();
            var info = await _usersRepository.GetUserInformation(user.Id);
            var departmentAdmin = await _reportCategorySevice.GetDepartmentofUser(user.Id);
            info.IsDepartmentAdmin = departmentAdmin.Any();
            info.IsSuperAdmin = info.Group.Any() ? info.Group.Any(prop => prop.Name.Contains(_configuration.GetValue<string>("SystemAdminRoleName"))) : false;
            return info;
        }

        public async Task<List<UserInformationDto>> GetUserEmailAddress()
        {
            var data = await _usersRepository.GetUserEmailAddress();
            return data;
        }

        public async Task<PageModel<UserDetailDto>> AddNewUser(UserCreateRequest user)
        {
            await UserAuthorizationCheck();
            return await _userService.AddNewUser(user);
        }
        public async Task<PageModel<UserDetailDto>> UpdateUser(Guid userId, UserCreateRequest user)
        {
            await UserAuthorizationCheck();
            user.Id = userId;
            return await _userService.UpdateUser(user);
        }

        public async Task<UserDetailDto> UserDetailById(Guid userId)
        {
            await UserAuthorizationCheck();
            return await _userService.UserDetailById(userId);
        }

        public async Task<PageModel<UserDetailDto>> DeleteUser(Guid userId)
        {
            PagedRequest pagedRequest = new PagedRequest
            {
                PageSize = 20,
                Page = 1
            };
            await _userService.DeleteUser(userId);
            return await GetAllUsers(pagedRequest);
        }

        public async Task<List<UserDetailDto>> GetAllUsersAsync()
        {
            var data = (await _usersRepository.GetAllAsListAsync()).Select(x => new UserDetailDto
            {
                Id = x.Id,
                Name = x.Name,
                Email = x.EmailAddress
            }).OrderBy(p => p.Name).ToList();
            return data;
        }

        private async Task<Users> UserAuthorizationCheck()
        {
            var abc = await _usersRepository.GetAllAsListAsync();
            var user = await _usersRepository.Where(u => u.EmailAddress.Trim().ToLower() == _applicationUser.Email.Trim().ToLower()).FirstOrDefaultAsync();
            if (user == null)
            {
                throw new UnauthorizedAccessException();
            }
            return user;
        }

        #endregion

        #region REPORT
        public async Task<PageModel<ReportDetailsDto>> GetAllReports(PagedRequest pagedRequest)
        {
            await UserAuthorizationCheck();
            return await _reportService.GetAllReports(pagedRequest);
        }
        public async Task<ReportAssignedDetails> GetReportDetailById(Guid id)
        {
            await UserAuthorizationCheck();
            return await _reportService.GetReportDetailById(id);
        }
        public async Task<PageModel<ReportDetailsDto>> AddReport(ReportCreateRequest reportCreateRequest)
        {
            await UserAuthorizationCheck();
            return await _reportService.AddUpdateReport(reportCreateRequest);

        }
        public async Task<PageModel<ReportDetailsDto>> UpdateReport(Guid reportId, ReportCreateRequest reportCreateRequest)
        {
            await UserAuthorizationCheck();
            reportCreateRequest.Id = reportId;
            return await _reportService.AddUpdateReport(reportCreateRequest);
        }
        public async Task<ReportAssignedDetails> MapReportToGroup(Guid reportId, Guid groupId, ReportMapRequest mapingRequest)
        {
            return await _reportService.MapReportToGroup(reportId, groupId, mapingRequest);
        }
        public async Task<ReportAssignedDetails> MapReportToUser(Guid reportId, Guid userId, ReportMapRequest mapingRequest)
        {
            return await _reportService.MapReportToUser(reportId, userId, mapingRequest);
        }

        public async Task<ReportAssignedDetails> DeleteMappedGroupFromReport(ReportMappingDeleteRequest reportMappingDeleteRequest)
        {
            return await _reportService.DeleteMappedGroupFromReport(reportMappingDeleteRequest);
        }

        public async Task<ReportAssignedDetails> DeleteMappedUserFromReport(ReportMappingDeleteRequest reportMappingDeleteRequest)
        {
            return await _reportService.DeleteMappedUserFromReport(reportMappingDeleteRequest);
        }

        public async Task<PageModel<ReportDetailsDto>> DeleteReport(Guid reportId)
        {
            PagedRequest pagedRequest = new PagedRequest
            {
                PageSize = 20,
                Page = 1
            };
            await _reportService.DeleteReport(reportId);
            return await GetAllReports(pagedRequest);
        }

        #endregion

        #region REPORT CATEGORY
        public async Task<PageModel<ReportCategoryDto>> GetAllCategory(PagedRequest pagedRequest)
        {
            var user = await UserAuthorizationCheck();
            return await _reportCategorySevice.GetAllCategory(pagedRequest);
        }

        public async Task<PageModel<ReportCategoryDto>> AddCategory(ReportCategoryDto request)
        {
            await UserAuthorizationCheck();
            return await _reportCategorySevice.AddUpdateCategory(request);
        }
        public async Task<PageModel<ReportCategoryDto>> UpdateCategory(Guid categoryId, ReportCategoryDto request)
        {
            await UserAuthorizationCheck();
            request.Id = categoryId;
            return await _reportCategorySevice.AddUpdateCategory(request);
        }

        public async Task<List<ReportCategoryDto>> GetAllCategories()
        {
            await UserAuthorizationCheck();
            return await _reportCategorySevice.GetAllCategories();
        }

        public async Task<PageModel<ReportCategoryDto>> DeleteCategory(Guid categoryId)
        {
            PagedRequest pagedRequest = new PagedRequest
            {
                PageSize = 20,
                Page = 1
            };
            await _reportCategorySevice.DeleteCategory(categoryId);
            return await GetAllCategory(pagedRequest);
        }

        #endregion

        #region GROUP 
        public async Task<List<GroupDetailsDto>> GetAllGroup()
        {
            return await _userGroupService.GetAllRoles();
            //List<GroupDetailsDto> data = new List<GroupDetailsDto>();
            //var result = await _roleRepository.GetAllRoles();

            //data = result.Select(p => new GroupDetailsDto
            //{
            //    Id = p.Id,
            //    Name = p.Name,
            //    Description = p.Description,
            //    CreatedAt = p.CreatedAt,
            //    CreatedBy = p.CreatedBy?.Name,
            //    UpdatedAt = p.UpdatedAt,
            //    UpdatedBy = p.UpdatedBy?.Name,
            //}).ToList();
            //return data;
        }
        public async Task<PageModel<UserGroupDetailDto>> GetAllGroup(PagedRequest pagedRequest)
        {
            await UserAuthorizationCheck();
            return await _userGroupService.GetAllGroup(pagedRequest);
            //return await _roleRepository.GetAllGroup(pagedRequest);
        }

        public async Task<PageModel<UserGroupDetailDto>> CreateGroup(GroupCreateRequest data)
        {
            await UserAuthorizationCheck();
            return await _userGroupService.CreateGroup(data);
        }

        public async Task<PageModel<UserGroupDetailDto>> UpdateGroup(Guid groupId, GroupCreateRequest data)
        {
            await UserAuthorizationCheck();

            GroupDetailsDto request = _mapper.Map<GroupDetailsDto>(data);
            request.Id = groupId;
            return await _userGroupService.UpdateGroup(groupId, data);
        }
        public async Task<PageModel<UserGroupDetailDto>> DeleteGroup(Guid groupId)
        {
            await UserAuthorizationCheck();
            PagedRequest pagedRequest = new PagedRequest();
            await _userGroupService.DeleteGroup(groupId);
            pagedRequest.Page = 1;
            pagedRequest.PageSize = 20;
            return await GetAllGroup(pagedRequest);
        }

        public async Task<PageModel<UserGroupDetailDto>> MapMultipleUsers(UserGroupMapDto users, Guid groupId)
        {
            await UserAuthorizationCheck();
            return await _userGroupService.MapMultipleUsers(users, groupId);
        }

        public async Task<PageModel<UserGroupDetailDto>> DeleteUserFromGroup(Guid groupId, UserGroupMapDto users)
        {
            await UserAuthorizationCheck();
            return await _userGroupService.DeleteUserFromGroup(groupId, users);
        }

        #endregion
    }
}

