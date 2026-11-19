using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Core.Models.Dto
{
    public class GroupDetailsDto
    {
        public Guid Id { get; set; }
        public string Name { get; set; }
        public string Description { get; set; }
        public string CreatedBy { get; set; }
        public DateTime CreatedAt { get; set; }
        public string UpdatedBy { get; set; }
        public DateTime UpdatedAt { get; set; }
        public Guid ReportCategory { get; set; }
        public string ReportCategoryName { get; set; }
    }
    public class UserGroupDetailDto : GroupDetailsDto
    {
        public List<MappedUser> MappedUsers { get; set; }
        public List<MappedReports> MappedReports { get; set; }
    }
    public class MappedUser
    {
        public Guid UserId { get; set; }
        public string UserName { get; set; }
        public string UserEmail { get; set; }
    }
    public class MappedReports
    {
        public Guid ReportId { get; set; }
        public string ReportName { get; set; }
        public List<string> AssignedRlsRoles { get; set; }
    }
}
