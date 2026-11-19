using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Core.Models.Dto
{
    public class EmbeddedTokenDetails
    {
        public Guid ReportId { get; set; }
        public Guid GroupId { get; set; }
        public Guid WorkspaceId { get; set; }
        public string Token { get; set; }
        public string EmbeddedUrl { get; set; }
        public bool EnablePagination { get; set; }
        public string ReportName { get; set; }
    }
}
