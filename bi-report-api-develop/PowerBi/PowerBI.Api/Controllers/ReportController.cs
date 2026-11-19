using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PowerBIPortal.Api.Constants;
using PowerBIPortal.Core.Models.Dto;
using PowerBIPortal.Services.Interfaces;

namespace PowerBIPortal.Api.Controllers
{
    [Route("/bi-report-api/v1/report/")]
    [ApiController]
    [Authorize(AuthenticationSchemes = AuthenticationSchema.ShoreAndSeafarer)]
    public class ReportController : ControllerBase
    {
        private readonly IReportService _reportService;
        public ReportController(IReportService reportService)
        {
            _reportService = reportService;
        }
        [HttpGet]
        [Route("reports")]
        public async Task<List<ReportDetailsDto>> GetAllMyReport()
        {
            return await _reportService.GetAllMyReport();
        }
        [HttpPut]
        [Route("favoriteReport")]
        public async Task<List<ReportDetailsDto>> FavoriteReport(Guid reportId)
        {            
            return await _reportService.FavoriteReport(reportId);
        }
    }
}
