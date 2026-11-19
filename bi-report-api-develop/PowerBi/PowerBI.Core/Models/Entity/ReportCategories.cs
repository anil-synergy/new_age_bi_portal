using System.ComponentModel.DataAnnotations.Schema;

namespace PowerBIPortal.Core.Models.Entity
{
    [Table("bi_report_categories")]
    public class ReportCategories : BaseEntity
    {
        [Column("name")]
        public string Name { get; set; }
        [Column("description")]
        public string Description { get; set; }
        [Column("department_admin", TypeName = "jsonb")]
        public List<Guid> DepartmentAdmin { get; set; }
    }
}
