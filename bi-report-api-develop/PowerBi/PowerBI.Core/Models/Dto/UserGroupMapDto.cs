using PowerBIPortal.Core.Models.Api;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Core.Models.Dto
{
    public class UserGroupMapDto:PagedRequest
    {
        public List<Guid> UserId { get;set; }
    }
}
