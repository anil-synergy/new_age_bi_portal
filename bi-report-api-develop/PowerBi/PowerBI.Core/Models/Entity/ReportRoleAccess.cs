using PowerBIPortal.Core.Enums;
using System.ComponentModel.DataAnnotations.Schema;

namespace PowerBIPortal.Core.Models.Entity
{
    [Table("bi_report_role_access")]
    public class ReportRoleAccess : BaseEntity
    {
        [Column("bi_report_id")]
        public Guid BiReportId { get; set; }
        [Column("role_id")]
        public Guid RoleId { get; set; }
        [Column("[permission]")]
        public ReportPermission Permission { get; set; }
        [Column("RLS_Bypassed")]
        public bool RLS_Bypassed { get; set; }
    }
}
