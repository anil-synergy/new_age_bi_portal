using PowerBIPortal.Core.Models.Dto;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Core.Models.Api
{
    public class ReportCreateRequest
    {
        public Guid Id { get; set; }
        public string Name { get; set; }
        public string Description { get; set; }
        public Guid ReportCategory { get; set; }
        public Guid PowerBiReportId { get; set; }
        public Guid PowerWorkSpaceId { get; set; }
        public bool RlsEnabled { get; set; }
        public bool EnablePagination { get; set; }
        public List<RlsRoleDto> PowerBiRlsRole { get; set; }
    }
}
