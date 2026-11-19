using PowerBIPortal.Core.Models.Api;
using PowerBIPortal.Core.Models.Dto;

namespace PowerBIPortal.Services.Interfaces
{
    public interface IAdminService
    {
        #region USERS
        Task<PageModel<UserDetailDto>> GetAllUsers(PagedRequest pagedRequest);
        Task<UserInformationDto> GetUserInformation();
        Task<List<UserInformationDto>> GetUserEmailAddress();
        Task<PageModel<UserDetailDto>> AddNewUser(UserCreateRequest user);
        Task<PageModel<UserDetailDto>> UpdateUser(Guid userId, UserCreateRequest user);
        Task<UserDetailDto> UserDetailById(Guid userId);
        Task<PageModel<UserDetailDto>> DeleteUser(Guid userId);
        Task<List<UserDetailDto>> GetAllUsersAsync();
        #endregion

        #region REPORTS
        Task<PageModel<ReportDetailsDto>> AddReport(ReportCreateRequest reportCreateRequest);
        Task<PageModel<ReportDetailsDto>> GetAllReports(PagedRequest pagedRequest);
        Task<PageModel<ReportDetailsDto>> UpdateReport(Guid reportId, ReportCreateRequest reportCreateRequest);
        Task<ReportAssignedDetails> GetReportDetailById(Guid id);
        Task<ReportAssignedDetails> MapReportToGroup(Guid reportId, Guid groupId, ReportMapRequest mapingRequest);
        Task<ReportAssignedDetails> MapReportToUser(Guid reportId, Guid usersId, ReportMapRequest mapingRequest);
        Task<ReportAssignedDetails> DeleteMappedGroupFromReport(ReportMappingDeleteRequest reportMappingDeleteRequest);
        Task<ReportAssignedDetails> DeleteMappedUserFromReport(ReportMappingDeleteRequest reportMappingDeleteRequest);
        Task<PageModel<ReportDetailsDto>> DeleteReport(Guid reportId);

        #endregion

        #region REPORT CATEGORY
        Task<PageModel<ReportCategoryDto>> GetAllCategory(PagedRequest pagedRequest);
        Task<PageModel<ReportCategoryDto>> AddCategory(ReportCategoryDto request);
        Task<PageModel<ReportCategoryDto>> UpdateCategory(Guid categoryId, ReportCategoryDto request);
        Task<List<ReportCategoryDto>> GetAllCategories();
        Task<PageModel<ReportCategoryDto>> DeleteCategory(Guid categoryId);

        #endregion

        #region GROUP
        Task<List<GroupDetailsDto>> GetAllGroup();
        Task<PageModel<UserGroupDetailDto>> GetAllGroup(PagedRequest pagedRequest);
        Task<PageModel<UserGroupDetailDto>> CreateGroup(GroupCreateRequest data);
        Task<PageModel<UserGroupDetailDto>> UpdateGroup(Guid groupId, GroupCreateRequest data);
        Task<PageModel<UserGroupDetailDto>> DeleteGroup(Guid groupId);
        Task<PageModel<UserGroupDetailDto>> MapMultipleUsers(UserGroupMapDto users, Guid groupId);
        Task<PageModel<UserGroupDetailDto>> DeleteUserFromGroup(Guid groupId, UserGroupMapDto users);
        #endregion

    }
}
