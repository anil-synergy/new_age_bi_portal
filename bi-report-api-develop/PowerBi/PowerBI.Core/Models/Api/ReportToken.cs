using Microsoft.AspNetCore.Authentication.Cookies;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Core.Models.Api
{
    public class ReportToken
    {
        public Guid ReportId { get; set; }
        public string Token { get; set; }
        public DateTime Expiration { get; set; }
        public string EmbeddedUrl { get; set; }

    }
}
