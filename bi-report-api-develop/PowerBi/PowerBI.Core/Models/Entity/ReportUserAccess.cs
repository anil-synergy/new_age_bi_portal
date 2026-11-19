using PowerBIPortal.Core.Enums;
using System.ComponentModel.DataAnnotations.Schema;

namespace PowerBIPortal.Core.Models.Entity
{
    [Table("bi_report_user_access")]
    public class ReportUserAccess : BaseEntity
    {
        [Column("bi_report_id")]
        public Guid BiReportId { get; set; }
        [Column("email_address")]
        public string EmailAddress { get; set; }
        [Column("external_user_id")]
        public Guid ExternalUserId { get; set; }
        [Column("user_id")]
        public Guid UserId { get; set; }
        [Column("[permission]")]
        public ReportPermission Permission { get; set; }
        [Column("RLS_Bypassed")]
        public bool RLS_Bypassed { get; set; }
    }
}
