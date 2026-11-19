using Microsoft.EntityFrameworkCore;
using PowerBIPortal.Core.Models.Api;
using PowerBIPortal.Core.Models.Dto;
using PowerBIPortal.Core.Models.Entity;
using PowerBIPortal.Data.DBContexts;
using PowerBIPortal.Data.Extensions;
using PowerBIPortal.Data.Interfaces;
using System.Collections.Concurrent;
using System.Data;

namespace PowerBIPortal.Data.Repositories
{
    public class ReportCategoriesRepository : BaseRepository<ReportCategories>, IReportCategoriesRepository
    {
        private readonly PortalDbContext _dbContext;
        public ReportCategoriesRepository(PortalDbContext dbContext) : base(dbContext)
        {
            _dbContext = dbContext;
        }
        public async Task<PageModel<ReportCategoryDto>> GetAllCategory(PagedRequest pagedRequest)
        {
            List<ReportCategoryDto> categoryData = new();
            List<ReportCategoryDetails> tempData = new();

            tempData = await (from category in _dbContext.ReportCategories
                              where string.IsNullOrEmpty(pagedRequest.Search) ? true : category.Name.ToLower().Trim().Contains(pagedRequest.Search.Trim().ToLower())
                              select new ReportCategoryDetails
                              {
                                  Id = category.Id,
                                  Name = category.Name,
                                  Description = category.Description,
                                  DepartmentAdminId = category.DepartmentAdmin
                              }).OrderBy(p => p.Name).ToListAsync();

            //find admin names
            foreach (var item in tempData)
            {
                ReportCategoryDto category = new ReportCategoryDto
                {
                    DepartmentAdmin = new()
                };

                category.Id = item.Id;
                category.Name = item.Name;
                category.Description = item.Description;
                if (item.DepartmentAdminId != null && item.DepartmentAdminId.Any())
                {
                    foreach (var adminId in item.DepartmentAdminId)
                    {
                        var user = await _dbContext.Users.Where(p => p.Id == adminId).FirstOrDefaultAsync();
                        if (user == null) // user delete from users list
                        {
                            continue;
                        }
                        else
                        {
                            category.DepartmentAdmin.Add(new DepartmentAdmin
                            {
                                Id = adminId,
                                Name = user.Name,
                                Email = user.EmailAddress
                            });
                        }
                    }
                }
                categoryData.Add(category);
            }
            var result = categoryData.Paginate(pagedRequest.Page, pagedRequest.PageSize.GetValueOrDefault());

            return result;
        }

        public async Task<List<ReportCategoryDto>> GetAllCategories()
        {
            var categoryData = await (from category in _dbContext.ReportCategories
                                      select new ReportCategoryDto
                                      {
                                          Id = category.Id,
                                          Name = category.Name
                                      }).OrderBy(p => p.Name).ToListAsync();
            return categoryData;
        }

        public async Task<List<ReportCategories>> GetDepartmentofUser(Guid userId)
        {
            var allDepartment = await _dbContext.ReportCategories.Select(p => p).ToListAsync();
            var filteredData = allDepartment.Where(i => i.DepartmentAdmin != null && i.DepartmentAdmin.Any(x => x == userId)).ToList();
            return filteredData;
        }

        public async Task<PageModel<ReportCategoryDto>> GetAllCategoryofDepartmentAdmin(PagedRequest pagedRequest, List<ReportCategoryDto> departments)
        {
            List<ReportCategoryDto> categoryData = new();
            List<ReportCategoryDetails> tempData = new();
            tempData = (from category in departments
                        where
                        string.IsNullOrEmpty(pagedRequest.Search) ? true : category.Name.ToLower().Trim().Contains(pagedRequest.Search.Trim().ToLower())
                        select new ReportCategoryDetails
                        {
                            Id = category.Id,
                            Name = category.Name,
                            Description = category.Description,
                            DepartmentAdminId = category.DepartmentAdmin.Select(p => p.Id).ToList(),
                        }).OrderBy(p => p.Name).ToList();
            foreach (var item in tempData)
            {
                ReportCategoryDto category = new ReportCategoryDto
                {
                    DepartmentAdmin = new()
                };

                category.Id = item.Id;
                category.Name = item.Name;
                category.Description = item.Description;
                if (item.DepartmentAdminId != null && item.DepartmentAdminId.Any())
                {
                    foreach (var adminId in item.DepartmentAdminId)
                    {
                        var user = await _dbContext.Users.Where(p => p.Id == adminId).FirstOrDefaultAsync();
                        if (user == null) // user delete from users list
                        {
                            continue;
                        }
                        else
                        {
                            category.DepartmentAdmin.Add(new DepartmentAdmin
                            {
                                Id = adminId,
                                Name = user.Name,
                                Email = user.EmailAddress
                            });
                        }
                    }
                }
                categoryData.Add(category);
            }
            var result = categoryData.Paginate(pagedRequest.Page, pagedRequest.PageSize.GetValueOrDefault());
            return result;
        }

        // parent_id/display_order exist in some environments' schema but not in the EF model or migrations,
        // so they are read with plain SQL and only when present. Detection is cached per connection string.
        private static readonly ConcurrentDictionary<string, bool> HierarchySupport = new();

        public async Task<Dictionary<Guid, CategoryPathItem>> GetActiveCategoryHierarchy(CancellationToken cancellationToken = default)
        {
            var connection = _dbContext.Database.GetDbConnection();
            var opened = false;
            if (connection.State != ConnectionState.Open)
            {
                await connection.OpenAsync(cancellationToken);
                opened = true;
            }
            try
            {
                var key = _dbContext.Database.GetConnectionString() ?? string.Empty;
                if (!HierarchySupport.TryGetValue(key, out var supported))
                {
                    await using var probe = connection.CreateCommand();
                    probe.CommandText = @"SELECT count(*) FROM information_schema.columns
                        WHERE table_schema = current_schema() AND table_name = 'bi_report_categories'
                          AND column_name IN ('parent_id', 'display_order')";
                    supported = Convert.ToInt32(await probe.ExecuteScalarAsync(cancellationToken)) == 2;
                    HierarchySupport[key] = supported;
                }
                if (!supported) return null;

                await using var command = connection.CreateCommand();
                command.CommandText = @"SELECT id, name, parent_id, display_order
                    FROM bi_report_categories WHERE is_active = true";
                var categories = new Dictionary<Guid, CategoryPathItem>();
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken))
                {
                    var id = reader.GetGuid(0);
                    categories[id] = new CategoryPathItem
                    {
                        Id = id,
                        Name = reader.IsDBNull(1) ? null : reader.GetString(1),
                        ParentId = reader.IsDBNull(2) ? null : reader.GetGuid(2),
                        DisplayOrder = reader.GetInt32(3),
                    };
                }
                return categories;
            }
            finally
            {
                if (opened) await connection.CloseAsync();
            }
        }
    }
}
