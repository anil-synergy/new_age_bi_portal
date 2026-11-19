using System.ComponentModel.DataAnnotations.Schema;

namespace PowerBIPortal.Core.Models.Entity
{
    [Table("role")]
    public class Group : BaseEntity
    {
        [Column("name")]
        public string Name { get; set; }
        [Column("description")]
        public string Description { get; set; }
        [Column("is_internal")]
        public bool IsInternal { get; set; }
        [Column("issuer")]
        public string Issuer { get; set; }
        [Column("report_category")]
        public Guid ReportCategory { get; set; }

    }
}
