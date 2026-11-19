using Microsoft.EntityFrameworkCore;
using PowerBIPortal.Core.Models.Entity;
using PowerBIPortal.Data.DBContexts;
using PowerBIPortal.Data.Interfaces;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Data.Repositories
{
    public  class UserRolesRepository : BaseRepository<UserGroups>, IUserRolesRepository
    {
        private readonly PortalDbContext _dbContext;
        public UserRolesRepository(PortalDbContext dbContext) : base(dbContext)
        {
            _dbContext = dbContext;
        }

        public async Task<List<string>> GetRolesByEmailId(string emailId)
        {
            List<string> data = await (from userroles in _dbContext.UserGroups
                              join user in _dbContext.Users on userroles.UserId equals user.Id
                              join role in _dbContext.Group on userroles.RoleId equals role.Id
                              where user.EmailAddress.Trim().ToLower() == emailId
                              select role.Name).ToListAsync();
            return data;
        }
    }
}
