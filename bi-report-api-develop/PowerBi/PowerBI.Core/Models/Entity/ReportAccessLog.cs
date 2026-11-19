using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations.Schema;
using System.ComponentModel.DataAnnotations;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Core.Models.Entity
{
    [Table("report_access_log")]
    public class ReportAccessLog
    {
        [Key]
        [Column("id")]
        public Guid Id { get; set; }
        [Column("user_id")]
        public Guid UserId { get; set; }
        [Column("report_id")]
        public Guid ReportId { get; set; }
        [Column("accessed_at", TypeName = "jsonb")]
        public List<DateTime> Accessed_At { get;set; }
    }
}
