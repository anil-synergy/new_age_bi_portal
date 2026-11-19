using PowerBIPortal.Core.Models.Api;
using PowerBIPortal.Core.Models.Dto;
using PowerBIPortal.Core.Models.Entity;
using PowerBIPortal.Data.Repositories;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Data.Interfaces
{
    public interface IReportRepository : IBaseRepository<Report>
    {
        Task<List<ReportDetailsDto>> GetAllReports(Guid userId);
        Task<bool> CheckPermissionByReportId(Report report, Guid userId);
        Task<bool> BypassPermission(Guid reportId, Guid userId);
        Task<PageModel<ReportDetailsDto>> GetAllReports(PagedRequest pagedRequest);
        Task<ReportAssignedDetails> GetReportDetailById(Guid id);
        Task<PageModel<ReportDetailsDto>> GetAllReportsofDepartmentAdmin(PagedRequest pagedRequest, List<ReportCategoryDto> reportCategories);
        Task<List<ReportDetailsDto>> GetAllMyReportsofDepartmentAdmin(Guid userId, List<ReportCategoryDto> reportCategories);

    }
}
