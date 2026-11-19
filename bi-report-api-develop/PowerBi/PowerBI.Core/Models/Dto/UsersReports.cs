using PowerBIPortal.Core.Models.Api;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Core.Models.Dto
{
    public class UsersReports
    {
        public Guid Id { get; set; }
        public string Name { get; set; }
        public string Email { get; set; }
        public Guid GroupId { get; set; }
        public string GroupName { get; set; }
        public Guid ReportId { get; set; }
        public string ReportName { get; set; }
        public List<string> AssignedRlsRoles { get; set; }
    }
}
