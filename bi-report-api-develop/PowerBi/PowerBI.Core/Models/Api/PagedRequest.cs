using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Core.Models.Api
{
    public class PagedRequest
    {
        public int Page { get; set; }
        public int? PageSize { get; set; } = 50;
        public string Search { get; set; }
        public string PropertyName { get; set; }
        public string FilterValue { get; set; }
    }
}
