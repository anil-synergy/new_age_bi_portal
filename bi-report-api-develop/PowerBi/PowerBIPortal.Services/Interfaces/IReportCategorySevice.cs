using PowerBIPortal.Core.Models.Api;
using PowerBIPortal.Core.Models.Dto;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Services.Interfaces
{
    public interface IReportCategorySevice
    {
        Task<PageModel<ReportCategoryDto>> GetAllCategory(PagedRequest pagedRequest);
        Task<PageModel<ReportCategoryDto>> AddUpdateCategory(ReportCategoryDto request);
        Task<List<ReportCategoryDto>> GetAllCategories();
        Task DeleteCategory(Guid categoryId);
        Task<List<ReportCategoryDto>> GetDepartmentofUser(Guid userId);
    }
}
