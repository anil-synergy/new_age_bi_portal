using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using PowerBIPortal.Api.Constants;
using PowerBIPortal.Core.Models.Api;
using PowerBIPortal.Core.Models.Dto;
using PowerBIPortal.Services.Interfaces;
using Synergy.Core.EmbeddedAnalytics.Models;

namespace PowerBIPortal.Api.Controllers
{
    [Route("/bi-report-api/v1/report")]
    [ApiController]
    [Authorize(AuthenticationSchemes = AuthenticationSchema.ShoreAndSeafarer)]
    public class TokenController : ControllerBase
    {
        private readonly ITokenService _tokenService;
        public TokenController(ITokenService tokenService)
        {
            _tokenService = tokenService;
        }

        [HttpGet]
        [Route("token/{reportId}/embededd")]
        public async Task<EmbeddedTokenDetails> GetToken(Guid reportId)
        {
            return await _tokenService.GetToken(reportId);
        }
        [HttpPost]
        [Route("token/report/{reportId}/download")]
        public async Task<FileResult> DownloadPdf(Guid reportId, ExportRequest exportRequest) {
            var fileModel =  await _tokenService.DownloadPdf(reportId, exportRequest);
            return File(fileModel.FileContents, fileModel.ContentType, fileModel.FileName);
        }
    }
}
