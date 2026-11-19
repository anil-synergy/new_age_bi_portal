using PowerBIPortal.Core.Models.Entity;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Data.Interfaces
{
    public interface IUserRolesRepository : IBaseRepository<UserGroups>
    {
        Task <List<string>> GetRolesByEmailId(string emailId);
    }
}
