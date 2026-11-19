using PowerBIPortal.Core.Models.Api;
using PowerBIPortal.Core.Models.Dto;
using Synergy.Core.EmbeddedAnalytics.Models;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Services.Interfaces
{
    public interface ITokenService
    {
        Task<List<PbiWorkSpace>> GetWorkSpaces();
        Task<List<PbiReport>> GetReports(Guid workSpaceId);
        Task<EmbeddedTokenDetails> GetToken(Guid workSpaceId);
        Task<FileModel> DownloadPdf(Guid reportId, ExportRequest exportRequest);
    }
}
