using PowerBIPortal.Core.Models.Dto;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Core.Models.Api
{
    public class UserCreateRequest
    {
        public Guid Id { get; set; }
        public string Name { get; set; }
        public string EmailAddress { get; set; }
        public List<Guid> Group { get; set; }
        public bool SendMail { get; set; }
    }
}
