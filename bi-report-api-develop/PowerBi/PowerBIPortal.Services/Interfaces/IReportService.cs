using Microsoft.AspNetCore.Mvc;
using PowerBIPortal.Core.Models.Api;
using PowerBIPortal.Core.Models.Dto;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Services.Interfaces
{
    public interface IReportService
    {
        Task<List<ReportDetailsDto>> GetAllMyReport();
        Task<List<ReportDetailsDto>> FavoriteReport(Guid userId);
        Task<PageModel<ReportDetailsDto>> AddUpdateReport(ReportCreateRequest reportCreateRequest);
        Task<PageModel<ReportDetailsDto>> GetAllReports(PagedRequest pagedRequest);
        Task<ReportAssignedDetails> GetReportDetailById(Guid Id);
        Task<ReportAssignedDetails> MapReportToGroup(Guid reportId, Guid groupId, ReportMapRequest mapingRequest);
        Task<ReportAssignedDetails> MapReportToUser(Guid reportId, Guid userId, ReportMapRequest mapingRequest);
        Task<ReportAssignedDetails> DeleteMappedGroupFromReport(ReportMappingDeleteRequest reportMappingDeleteRequest);
        Task<ReportAssignedDetails> DeleteMappedUserFromReport(ReportMappingDeleteRequest reportMappingDeleteRequest);
        Task DeleteReport(Guid reportId);
    }
}
