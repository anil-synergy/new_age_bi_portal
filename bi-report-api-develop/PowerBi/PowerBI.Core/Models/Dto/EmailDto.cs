using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Core.Models.Dto
{
    public class EmailDto
    {
        public bool IsBodyHtml { get; set; }
        public string Body { get; set; }
        public string FromId { get; set; }
        public string Subject { get; set; }
        public List<string> To { get; set; }
        public List<string> Cc { get; set; }
    }
}
