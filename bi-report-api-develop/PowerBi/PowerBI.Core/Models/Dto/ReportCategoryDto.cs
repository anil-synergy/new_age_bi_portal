using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Core.Models.Dto
{
    public class ReportCategoryDto
    {
        public Guid Id { get; set; }
        public string Name { get; set; }
        public string Description { get; set; }
        public List<DepartmentAdmin> DepartmentAdmin { get; set; }
    }

    public class DepartmentAdmin
    {
        public Guid Id { get; set; }
        public string Name { get; set; }
        public string Email { get; set; }
    }
    public class ReportCategoryDetails
    {
        public Guid Id { get; set; }
        public string Name { get; set; }
        public string Description { get; set; }
        public List<Guid> DepartmentAdminId { get; set; }
    }
}
