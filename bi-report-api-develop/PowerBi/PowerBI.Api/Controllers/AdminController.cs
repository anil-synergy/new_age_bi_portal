using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PowerBIPortal.Api.Constants;
using PowerBIPortal.Api.Filters;
using PowerBIPortal.Core.Models.Api;
using PowerBIPortal.Core.Models.Dto;
using PowerBIPortal.Services.Interfaces;

namespace PowerBIPortal.Api.Controllers
{
    [Route("/bi-report-api/v1/admin")]
    [ApiController]
    [Authorize(AuthenticationSchemes = AuthenticationSchema.ShoreAndSeafarer)]
    public class AdminController : ControllerBase
    {
        private readonly IAdminService _adminService;
        public AdminController(IAdminService adminService)
        {
            _adminService = adminService;
        }

        #region USERS

        [HttpPost]
        [Route("users")]
        [ServiceFilter(typeof(AdminCustomAuthorizationFilter))]
        public async Task<PageModel<UserDetailDto>> GetAllUsers(PagedRequest pagedRequest)
        {
            return await _adminService.GetAllUsers(pagedRequest);
        }

        [HttpGet]
        [Route("users/email")]
        [ServiceFilter(typeof(AdminCustomAuthorizationFilter))]
        public async Task<List<UserInformationDto>> GetUserEmailAddress()
        {
            return await _adminService.GetUserEmailAddress();
        }

        [HttpPost]
        [Route("user")]
        [ServiceFilter(typeof(AdminCustomAuthorizationFilter))]
        public async Task<PageModel<UserDetailDto>> AddNewUser([FromBody] UserCreateRequest user)
        {
            return await _adminService.AddNewUser(user);
        }

        [HttpPut]
        [Route("user/{userId}")]
        [ServiceFilter(typeof(SystemAdminOnlyCustomAuthorization))]

        public async Task<PageModel<UserDetailDto>> UpdateUser(Guid userId, [FromBody] UserCreateRequest user)
        {
            return await _adminService.UpdateUser(userId, user);
        }

        [HttpGet]
        [Route("user/{userId}")]
        [ServiceFilter(typeof(SystemAdminOnlyCustomAuthorization))]
        public async Task<UserDetailDto> UserDetailById(Guid userId)
        {
            return await _adminService.UserDetailById(userId);
        }

        [HttpDelete]
        [Route("user/{userId}")]
        [ServiceFilter(typeof(SystemAdminOnlyCustomAuthorization))]
        public async Task<PageModel<UserDetailDto>> DeleteUser(Guid userId)
        {
            return await _adminService.DeleteUser(userId);
        }

        [HttpGet]
        [Route("allUsers")]
        [ServiceFilter(typeof(AdminCustomAuthorizationFilter))]
        public async Task<List<UserDetailDto>> GetAllUsers()
        {
            return await _adminService.GetAllUsersAsync();
        }

        #endregion

        #region GROUP

        [HttpGet]
        [Route("role")]
        [ServiceFilter(typeof(AdminCustomAuthorizationFilter))]
        public async Task<List<GroupDetailsDto>> GetAllRoles()
        {
            return await _adminService.GetAllGroup();
        }

        [HttpGet]
        [Route("user/group")]
        [ServiceFilter(typeof(AdminCustomAuthorizationFilter))]
        public async Task<PageModel<UserGroupDetailDto>> GetAllRoles([FromQuery] PagedRequest pagedRequest)
        {
            return await _adminService.GetAllGroup(pagedRequest);
        }

        [HttpPost]
        [Route("user/group")]
        [ServiceFilter(typeof(AdminCustomAuthorizationFilter))]
        public async Task<PageModel<UserGroupDetailDto>> CreateGroup([FromBody] GroupCreateRequest groupCreateRequest)
        {
            return await _adminService.CreateGroup(groupCreateRequest);
        }

        [HttpPut]
        [Route("user/group/{groupId}")]
        [ServiceFilter(typeof(AdminCustomAuthorizationFilter))]
        public async Task<PageModel<UserGroupDetailDto>> UpdateGroup(Guid groupId, [FromBody] GroupCreateRequest groupCreateRequest)
        {
            return await _adminService.UpdateGroup(groupId, groupCreateRequest);
        }

        [HttpDelete]
        [Route("user/group/{groupId}")]
        [ServiceFilter(typeof(SystemAdminOnlyCustomAuthorization))]
        public async Task<PageModel<UserGroupDetailDto>> DeleteGroup(Guid groupId)
        {
            return await _adminService.DeleteGroup(groupId);
        }

        [HttpPost]
        [Route("user/group/{groupId}/users")]
        [ServiceFilter(typeof(AdminCustomAuthorizationFilter))]
        public async Task<PageModel<UserGroupDetailDto>> MapMultipleUsers(Guid groupId, UserGroupMapDto users)
        {
            return await _adminService.MapMultipleUsers(users, groupId);
        }

        [HttpDelete]
        [Route("user/group/{groupId}/users")]
        [ServiceFilter(typeof(AdminCustomAuthorizationFilter))]
        public async Task<PageModel<UserGroupDetailDto>> DeleteUserFromGroup(Guid groupId, UserGroupMapDto users)
        {
            return await _adminService.DeleteUserFromGroup(groupId, users);
        }

        #endregion


        #region REPORT
        [HttpPost]
        [Route("getAllReports")]
        [ServiceFilter(typeof(AdminCustomAuthorizationFilter))]
        public async Task<PageModel<ReportDetailsDto>> GetAllReports(PagedRequest pagedRequest)
        {
            return await _adminService.GetAllReports(pagedRequest);
        }
        [HttpPost]
        [Route("reports")]
        [ServiceFilter(typeof(AdminCustomAuthorizationFilter))]
        public async Task<PageModel<ReportDetailsDto>> AddReport(ReportCreateRequest reportCreateRequest)
        {
            return await _adminService.AddReport(reportCreateRequest);
        }
        [HttpPut]
        [Route("reports/{reportId}")]
        [ServiceFilter(typeof(AdminCustomAuthorizationFilter))]
        public async Task<PageModel<ReportDetailsDto>> UpdateReport(Guid reportId, ReportCreateRequest reportCreateRequest)
        {
            return await _adminService.UpdateReport(reportId, reportCreateRequest);
        }

        [HttpGet]
        [Route("reports/{reportId}")]
        [ServiceFilter(typeof(AdminCustomAuthorizationFilter))]
        public async Task<ReportAssignedDetails> GetReportDetailsById(Guid reportId)
        {
            return await _adminService.GetReportDetailById(reportId);
        }

        [HttpPost]
        [Route("reports/{reportId}/permission/group/{groupId}")]
        [ServiceFilter(typeof(AdminCustomAuthorizationFilter))]
        public async Task<ReportAssignedDetails> MapReportToGroup(Guid reportId, Guid groupId, [FromBody] ReportMapRequest mappingRequest)
        {
            return await _adminService.MapReportToGroup(reportId, groupId, mappingRequest);
        }

        [HttpPost]
        [Route("reports/{reportId}/permission/user/{userId}")]
        [ServiceFilter(typeof(AdminCustomAuthorizationFilter))]
        public async Task<ReportAssignedDetails> MapReportToUser(Guid reportId, Guid userId, [FromBody] ReportMapRequest mappingRequest)
        {
            return await _adminService.MapReportToUser(reportId, userId, mappingRequest);
        }

        [HttpDelete]
        [Route("reports/permission/group")]
        [ServiceFilter(typeof(AdminCustomAuthorizationFilter))]
        public async Task<ReportAssignedDetails> DeleteMappedGroupFromReport(ReportMappingDeleteRequest request)
        {
            return await _adminService.DeleteMappedGroupFromReport(request);
        }

        [HttpDelete]
        [Route("reports/permission/user")]
        [ServiceFilter(typeof(AdminCustomAuthorizationFilter))]
        public async Task<ReportAssignedDetails> DeleteMappedUserFromReport(ReportMappingDeleteRequest request)
        {
            return await _adminService.DeleteMappedUserFromReport(request);
        }

        [HttpDelete]
        [Route("reports/{reportId}")]
        [ServiceFilter(typeof(AdminCustomAuthorizationFilter))]
        public async Task<PageModel<ReportDetailsDto>> DeleteReport(Guid reportId)
        {
            return await _adminService.DeleteReport(reportId);
        }

        #endregion

        #region REPORT CATEGORY
        [HttpPost]
        [Route("report/category")]
        [ServiceFilter(typeof(SystemAdminOnlyCustomAuthorization))]
        public async Task<PageModel<ReportCategoryDto>> AddCategory([FromBody] ReportCategoryDto request)
        {
            return await _adminService.AddCategory(request);
        }
        [HttpGet]
        [Route("report/category")]
        [ServiceFilter(typeof(AdminCustomAuthorizationFilter))]
        public async Task<PageModel<ReportCategoryDto>> GetAllCategory([FromQuery] PagedRequest pagedRequest)
        {
            return await _adminService.GetAllCategory(pagedRequest);
        }
        [HttpPut]
        [Route("report/category/{categoryId}")]
        [ServiceFilter(typeof(SystemAdminOnlyCustomAuthorization))]
        public async Task<PageModel<ReportCategoryDto>> UpdateCategory(Guid categoryId, [FromBody] ReportCategoryDto request)
        {
            return await _adminService.UpdateCategory(categoryId, request);
        }
        [HttpGet]
        [Route("report/categories")]
        [ServiceFilter(typeof(AdminCustomAuthorizationFilter))]
        public async Task<List<ReportCategoryDto>> GetAllCategories()
        {
            return await _adminService.GetAllCategories();
        }

        [HttpDelete]
        [Route("report/category/{categoryId}")]
        [ServiceFilter(typeof(SystemAdminOnlyCustomAuthorization))]
        public async Task<PageModel<ReportCategoryDto>> DeleteCategory(Guid categoryId)
        {
            return await _adminService.DeleteCategory(categoryId);
        }

        #endregion

    }
}
