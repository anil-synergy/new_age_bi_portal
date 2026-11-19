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
    public class UserFavoritesRepository : BaseRepository<UserFavorites>, IUserFavoritesRepository
    {
        private readonly PortalDbContext _dbContext;
        public UserFavoritesRepository(PortalDbContext dbContext) : base(dbContext)
        {
            _dbContext = dbContext;
        }
    }
}
