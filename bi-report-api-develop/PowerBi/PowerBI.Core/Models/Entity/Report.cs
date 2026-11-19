using PowerBIPortal.Core.Models.Api;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace PowerBIPortal.Core.Models.Entity
{
    [Table("bi_report")]
    public class Report: BaseEntity
    {
        [Column("name")]
        public string Name { get; set; }
        [Column("description")]
        public string Description { get; set; }
        [Column("report_category")]
        public Guid ReportCategory { get; set; }
        [Column("powerbi_report_id")]
        public Guid PowerBiReportId { get; set; }
        [Column("powerbi_group_id")]
        public Guid PowerBiGroupId { get; set; }
        [Column("powerbi_workspace_id")]
        public Guid PowerWorkSpaceId { get; set; }
        [Column("enable_pagination")]
        public bool EnablePagination { get; set; }
        [Column("rls_enabled")]
        public bool RlsEnabled { get; set; }

        [Column("rls_role_mapping", TypeName = "jsonb")]
        public RlsRoles RlsRoles { get; set; }
    }


}
