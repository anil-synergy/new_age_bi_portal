using System.ComponentModel.DataAnnotations.Schema;

namespace PowerBIPortal.Core.Models.Entity
{
    [Table("user_roles")]
    public class UserGroups : BaseEntity
    {
        [Column("user_id")]
        public Guid UserId { get; set; }
        [Column("role_id")]
        public Guid RoleId { get; set; }
    }
}
