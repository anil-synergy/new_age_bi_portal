using Microsoft.EntityFrameworkCore;
using PowerBIPortal.Core.Models.Entity;
using PowerBIPortal.Core.User;
using PowerBIPortal.Data.Extensions;

namespace PowerBIPortal.Data.DBContexts
{
    public class PortalDbContext : DbContext
    {
        private readonly IApplicationUser _applicationUser;

        public PortalDbContext(DbContextOptions<PortalDbContext> options, IApplicationUser applicationUser) : base(options)
        {
            _applicationUser = applicationUser;
        }
        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            modelBuilder.ApplySoftDeleteFilter();
        }

        #region SaveChangesOverride
        public override async Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
        {
            await AddRequiredDetails();
            return await base.SaveChangesAsync(cancellationToken);
        }

        public override int SaveChanges()
        {
            AddRequiredDetails().GetAwaiter().GetResult();
            return base.SaveChanges();
        }

        private Task AddRequiredDetails()
        {
            var entries = ChangeTracker
                       .Entries()
                       .Where(e => (e.Entity is BaseEntity)
                           && (e.State == EntityState.Added
                           || e.State == EntityState.Modified
                           || e.State == EntityState.Deleted
                           ));

            foreach (var entityEntry in entries)
            {
                DateTime CurrenTTime = DateTime.UtcNow;
                bool entityType = entityEntry.Entity is BaseEntity;
                if (entityType)
                {
                    ((BaseEntity)entityEntry.Entity).UpdatedBy = GetCurrentUser();
                    ((BaseEntity)entityEntry.Entity).UpdatedAt = CurrenTTime;
                }

                switch (entityEntry.State)
                {
                    case EntityState.Added:
                        ((BaseEntity)entityEntry.Entity).IsActive = true;

                        if (entityType)
                        {
                            ((BaseEntity)entityEntry.Entity).CreatedBy = GetCurrentUser();
                            ((BaseEntity)entityEntry.Entity).CreatedAt = CurrenTTime;
                        }

                        break;
                    case EntityState.Deleted:

                        ((BaseEntity)entityEntry.Entity).IsActive = false;
                        ((BaseEntity)entityEntry.Entity).DeletedBy = GetCurrentUser();
                        ((BaseEntity)entityEntry.Entity).DeletedAt = CurrenTTime;
                        entityEntry.State = EntityState.Modified;
                        break;

                }


            }
            return Task.CompletedTask;
        }

        private BaseUser GetCurrentUser()
        {
            var data = Users.FirstOrDefault(p => p.EmailAddress.ToLower().Trim() == _applicationUser.Email);
            return new BaseUser
            {
                Id = data.Id,
                Name = data.Name
            };
        }
        #endregion

        public DbSet<ReportCategories> ReportCategories { get; set; }
        public DbSet<Report> Reports { get; set; }
        public DbSet<ReportRoleAccess> ReportRoleAccesses { get; set; }
        public DbSet<ReportUserAccess> ReportUserAccesses { get; set; }
        public DbSet<Group> Group { get; set; }
        public DbSet<UserGroups> UserGroups { get; set; }
        public DbSet<Users> Users { get; set; }
        public DbSet<UserFavorites> UserFavorites { get; set; }
        public DbSet<ReportAccessLog> ReportAccessLogs { get; set; }

    }
}
