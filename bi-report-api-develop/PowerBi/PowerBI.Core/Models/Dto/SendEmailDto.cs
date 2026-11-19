using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Core.Models.Dto
{
    public class SendEmailDto
    {
        public List<string> ToEmailIds { get; set; }
        public List<string> CcEmailIds { get; set; }
        public string Subject { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public string Message { get; set; }
        public string UserName { get; set; }
    }
}
