using Microsoft.AspNetCore.Builder;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PowerBIPortal.Core.Models.Entity;
using PowerBIPortal.Data.DBContexts;
using PowerBIPortal.Data.Helpers;
using System.Data;

namespace PowerBIPortal.Data.Seeder
{
    public static class PrepareLookUpData
    {
        public static void LookUpDataPopulation(IApplicationBuilder applicationBuilder)
        {
            using var scope = applicationBuilder.ApplicationServices.CreateScope();
            PortalDbContext ccdContext = scope.ServiceProvider.GetService<PortalDbContext>();
            SeedData(ccdContext);
        }

        private static void SeedData(PortalDbContext portalDbContext)
        {
            portalDbContext.Database.Migrate();
            //SeedTable<Report>(portalDbContext);
            //SeedTable<ReportCategories>(portalDbContext);
            //SeedTable<ReportRoleAccess>(portalDbContext);
            //SeedTable<Group>(portalDbContext);
            //SeedTable<UserGroups>(portalDbContext);
            //SeedTable<Users>(portalDbContext);
            //SeedTable<ReportUserAccess>(portalDbContext);
        }

        private static void SeedTable<T>(DbContext dbContext) where T : class
        {

            if (!dbContext.Set<T>().Any())
            {
                string tableName = typeof(T).Name;
                DataTable dt = DataTableConvertHelper.GetDataTable(tableName);
                List<T> data = DataTableConvertHelper.ConvertDataTable<T>(dt, dbContext);
                dbContext.Set<T>().AddRange(data);
                dbContext.SaveChanges();
            }
        }
    }
}
