using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations.Schema;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Core.Models.Entity
{
    [Table("users")]
    public class Users : BaseEntity
    {
        [Column("email_address")]
        public string EmailAddress { get; set; }
        [Column("external_user_id")]
        public Guid ExternalUserId { get; set; }
        [Column("issuer")]
        public string Issuer { get; set; }
        [Column("name")]
        public string Name { get; set; }
        [Column("send_mail")]
        public bool SendMail { get; set; }
    }
}
