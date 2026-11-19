using PowerBIPortal.Core.Enums;
using PowerBIPortal.Core.Models.Api;

namespace PowerBIPortal.Core.Models.Dto
{
    public class ReportBasicInformation
    {
        public Guid Id { get; set; }
        public string Title { get; set; }
        public string Description { get; set; }
        public bool RlsEnabled { get; set; }
        public bool EnablePagination { get; set; }
        public Guid PowerBiReportId { get; set; }
        public Guid WorkspaceId { get; set; }
        public List<RlsRoleDto> PowerBiRlsRole { get; set; }
        
    }
    
    public class ReportDetailsDto : ReportBasicInformation
    {
        public bool Favorite { get; set; }
        public Guid CategoryId { get; set; }
        public string CategoryName { get; set; }
        public Guid ReportId { get; set; }
        public Guid RoleId { get; set; }
        /// <summary>Root-to-leaf category chain; null when the database has no category hierarchy.</summary>
        public List<CategoryPathItem> CategoryPath { get; set; }
    }

    public class CategoryPathItem
    {
        public Guid Id { get; set; }
        public string Name { get; set; }
        public Guid? ParentId { get; set; }
        public int DisplayOrder { get; set; }
    }

    public class ReportInformation : ReportBasicInformation
    {
        public bool Favorite { get; set; }
        public Guid CategoryId { get; set; }
        public string CategoryName { get; set; }
        public Guid ReportId { get; set; }
        public RlsRoles RlsRoles { get; set; }
        public bool AssignedViaGroup { get; set; }
    }
    public class ReportAssignedDetails : ReportBasicInformation
    {
        public List<AssignedGroups> AssignedGroup { get; set; }
        public List<AssignedUsers> AssignedUsers { get; set; }
        public ReportCategoryDto ReportCategory { get; set; }
    }
    public class AssignedGroups 
    {
        public string  Group { get; set; }
        public ReportPermission  Permission { get; set; }
        public List<string> RlsRoleAssigned { get; set; }
        public Guid MappingGroupId { get; set; }
        public Guid GroupId { get; set; }
        public bool RLS_Bypassed { get; set; }
    }

    public class AssignedUsers
    {
        public string User { get; set; }
        public string UserEmail { get; set; }
        public ReportPermission Permission { get; set; }
        public List<string> RlsRoleAssigned { get; set; }
        public Guid MappingUserId { get; set; }
        public Guid UserId { get; set; }
        public bool RLS_Bypassed { get; set; }

    }
}
