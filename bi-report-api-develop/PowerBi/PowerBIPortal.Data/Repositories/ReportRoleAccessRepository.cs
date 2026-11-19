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
    public class ReportRoleAccessRepository : BaseRepository<ReportRoleAccess>, IReportRoleAccessRepository
    {
        private readonly PortalDbContext _dbContext;
        public ReportRoleAccessRepository(PortalDbContext context) : base(context)
        {
            _dbContext = context;
        }
    }
}
