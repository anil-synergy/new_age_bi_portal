using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Core.Models.Api
{
    public class RlsRoles
    {
        public List<RoleMappings> RoleMappings { get; set; }
    }

    public class RoleMappings
    {
        public string RlsRole { get; set; } // doroga,primus
        public List<string> Users { get; set; } // user
        public List<string> Groups { get; set; } //
        public bool IsActive { get; set; }
        public Guid Id { get; set; }
    }
}