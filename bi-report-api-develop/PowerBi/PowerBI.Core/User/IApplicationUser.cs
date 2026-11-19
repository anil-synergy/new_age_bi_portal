using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Core.User
{
    public interface IApplicationUser
    {
        public string Name { get; }
        public Guid Id { get; }
        public string Email { get; }
        public string Token { get; }
        public string Issuer { get; }
        public List<string> Roles { get; }

    }
}
