using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations.Schema;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Core.Models.Entity
{
    [Table("bi_user_favorites")]
    public class UserFavorites : BaseEntity
    {
        [Column("user_id")]
        public Guid UserId { get; set; }
        [Column("bi_report_id")]
        public Guid BiReportId { get; set; }
    }
}
