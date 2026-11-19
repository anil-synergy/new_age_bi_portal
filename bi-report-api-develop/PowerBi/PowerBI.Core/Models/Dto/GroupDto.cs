using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Core.Models.Dto
{
    public class GroupDto
    {
        public Guid Id { get; set; }
        public string Name { get; set; }
        public List<string> RlsRoleAssigned { get; set; }
    }
}
