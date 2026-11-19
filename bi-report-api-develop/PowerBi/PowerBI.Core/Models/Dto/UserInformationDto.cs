using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Core.Models.Dto
{
    public class UserInformationDto
    {
        public Guid Id { get; set; }
        public string Name { get; set; }
        public string Email { get; set; }
        public List<GroupDto> Group { get; set; }
        public bool IsSuperAdmin { get; set; }
        public bool IsDepartmentAdmin { get; set; }
    }
}
