using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Core.Models.Api
{
    public class ReportMapRequest
    {
        public List<string> RolesSelected { get; set; }
        public bool BypassRLS { get; set; }
    }
}
