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
    public class ReportAccessLogRepository : BaseRepository<ReportAccessLog>, IReportAccessLogRepository
    {
        private readonly PortalDbContext _dbContext;
        public ReportAccessLogRepository(PortalDbContext dbContext) : base(dbContext)
        {
            _dbContext = dbContext;
        }
    }
}
