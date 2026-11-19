using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace PowerBIPortal.Core.Models.Entity
{
    public class BaseEntity
    {
        [Key]
        [Column("id")]
        public Guid Id { get; set; } = Guid.NewGuid();
        [Column("created_by", TypeName = "jsonb")]
        public BaseUser CreatedBy { get; set; }
        [Column("created_at")]
        public DateTime CreatedAt { get; set; }
        [Column("updated_by", TypeName = "jsonb")]
        public BaseUser UpdatedBy { get; set; }
        [Column("updated_at")]
        public DateTime UpdatedAt { get; set; }
        [Column("deleted_by", TypeName = "jsonb")]
        public BaseUser DeletedBy { get; set; }
        [Column("deleted_at")]
        public DateTime? DeletedAt { get; set; }
        [Column("is_active")]
        public bool IsActive { get; set; } = true;
    }

    public class BaseUser
    {
        public Guid Id { get; set; }
        public string Name { get; set; }
    }
}
