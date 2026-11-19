using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Core.Models.Api
{
    public class ReportMappingDeleteRequest
    {
        public Guid ReportId { get; set; }
        public Guid MappingGroupId { get; set; }
        public Guid MappingUserId { get; set; }
    }
}
