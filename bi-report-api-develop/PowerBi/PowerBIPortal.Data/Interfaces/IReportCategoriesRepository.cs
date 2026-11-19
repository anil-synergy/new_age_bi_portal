using PowerBIPortal.Core.Models.Api;
using PowerBIPortal.Core.Models.Dto;
using PowerBIPortal.Core.Models.Entity;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Data.Interfaces
{
    public interface IReportCategoriesRepository : IBaseRepository<ReportCategories>
    {
        Task<PageModel<ReportCategoryDto>> GetAllCategory(PagedRequest pagedRequest);
        Task<List<ReportCategoryDto>> GetAllCategories();
        Task<List<ReportCategories>> GetDepartmentofUser(Guid userId);
        Task<PageModel<ReportCategoryDto>> GetAllCategoryofDepartmentAdmin(PagedRequest pagedRequest, List<ReportCategoryDto> department);
        /// <summary>Active categories keyed by id, or null when parent_id/display_order columns do not exist.</summary>
        Task<Dictionary<Guid, CategoryPathItem>> GetActiveCategoryHierarchy(CancellationToken cancellationToken = default);

    }
}
