using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Core.Models.Api
{
    public class GroupCreateRequest
    {
        public string Name { get; set; }
        public string Description { get; set; }
        public Guid ReportCategory { get; set; }
        //public List<Guid> Users { get; set; }
    }
}
