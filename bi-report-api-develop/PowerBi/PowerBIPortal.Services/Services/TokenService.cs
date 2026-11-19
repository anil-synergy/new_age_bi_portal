using Microsoft.AspNetCore.Http;
using PowerBIPortal.Core.Constants;
using PowerBIPortal.Core.Exceptions;
using PowerBIPortal.Core.Models.Api;
using PowerBIPortal.Core.Models.Dto;
using PowerBIPortal.Core.User;
using PowerBIPortal.Data.Interfaces;
using PowerBIPortal.Services.Interfaces;
using Synergy.Core.EmbeddedAnalytics;
using Synergy.Core.EmbeddedAnalytics.Models;
using PowerBIPortal.Core.Extensions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using PowerBIPortal.Core.Models.Entity;
using PowerBIPortal.Data.Helpers;
using AutoMapper;
using System.Collections.Generic;
using Microsoft.PowerBI.Api.Models;

namespace PowerBIPortal.Services.Services
{
    public class TokenService : ITokenService
    {
        private readonly IEmbeddedAnalyticService _pbiService;
        private readonly IReportRepository _reportRepository;
        private readonly IApplicationUser _applicationUser;
        private readonly IHttpContextAccessor _httpContextAccessor;
        private readonly IUsersRepository _usersRepository;
        private readonly IGroupRepository _roleRepository;
        private readonly IConfiguration _configuration;
        private readonly IUserRolesRepository _userRoleRepository;
        private readonly IReportAccessLogRepository _reportAccessLogRepository;
        private readonly IReportCategorySevice _reportCategorySevice;
        private readonly IMapper _mapper;


        public TokenService(IEmbeddedAnalyticService pbiService, IReportRepository reportRepository,
            IApplicationUser applicationUser, IHttpContextAccessor httpContextAccessor,
            IUsersRepository usersRepository, IGroupRepository roleRepository, IConfiguration configuration,
            IUserRolesRepository userRoleRepository, IReportAccessLogRepository reportAccessLogRepository,
            IReportCategorySevice reportCategorySevice, IMapper mapper)

        {
            _pbiService = pbiService;
            _reportRepository = reportRepository;
            _applicationUser = applicationUser;
            _httpContextAccessor = httpContextAccessor;
            _usersRepository = usersRepository;
            _roleRepository = roleRepository;
            _configuration = configuration;
            _userRoleRepository = userRoleRepository;
            _reportAccessLogRepository = reportAccessLogRepository;
            _reportCategorySevice = reportCategorySevice;
            _mapper = mapper;
        }
        public async Task<List<PbiWorkSpace>> GetWorkSpaces()
        {
            return await _pbiService.GetWorkspaces();
        }
        public async Task<List<PbiReport>> GetReports(Guid workSpaceId)
        {
            return await _pbiService.GetReports(workSpaceId);
        }
        public async Task<EmbeddedTokenDetails> GetToken(Guid reportId)
        {
            var adminUserGroup = _configuration.GetValue<string>("SystemAdminRoleName");
            EmbeddedTokenDetails tokenDetail = new();
            ReportEmbedConfig val = new();
            bool isDepartmentAdmin = false;
            List<Guid> DepartmentAdminReports = new();
            //get userid
            var userDetails = await _usersRepository.Where(i => i.EmailAddress.ToLower() == _applicationUser.Email).FirstOrDefaultAsync();
            if (userDetails == null)
            {
                throw new UnauthorizedAccessException();
            }
            var roles = await _roleRepository.RoleNameByUserId(userDetails.Id);
            //fetch user groups
            List<string> userGroups = await _userRoleRepository.Where(i => i.UserId == userDetails.Id).Select(p => p.RoleId.ToString()).ToListAsync();
            List<string> userGroupNames = await _userRoleRepository.GetRolesByEmailId(userDetails.EmailAddress);

            var reportDetails = await _reportRepository.FindByIdAsync(reportId);

            if (reportDetails == null)
            {
                throw new AppException(ValidationMessages.ReportNotFound);
            }

            //check user id department admin
            var departments = await _reportCategorySevice.GetDepartmentofUser(userDetails.Id);
            if (departments.Any() && !roles.Select(p => p.Name).Contains(adminUserGroup))
            {
                //check report under this department and throw exception if accessing report which has no permission
                var reports = await _reportRepository.GetAllMyReportsofDepartmentAdmin(userDetails.Id, departments);
                DepartmentAdminReports = reports.Select(p => p.Id).ToList();
                if (reports.Any() && !reports.Any(p => p.Id == reportId))
                {
                    throw new AccessDeniedException(ValidationMessages.AccessDenied);
                }
                isDepartmentAdmin = true;
            }

            var havePermisson = await _reportRepository.CheckPermissionByReportId(reportDetails, userDetails.Id);

            if (!havePermisson && !roles.Select(p => p.Name).Contains(adminUserGroup) && !isDepartmentAdmin)
            {
                throw new AccessDeniedException(ValidationMessages.AccessDenied);
            }

            tokenDetail.GroupId = reportDetails.PowerBiGroupId;
            tokenDetail.EnablePagination = reportDetails.EnablePagination;
            tokenDetail.WorkspaceId = reportDetails.PowerWorkSpaceId;
            tokenDetail.ReportName = reportDetails.Name;
            var BiTokenData = _httpContextAccessor.HttpContext.GetObject<ReportToken>("Token");

            var bypassPermission = await _reportRepository.BypassPermission(reportId,userDetails.Id);

            if (BiTokenData == null || BiTokenData.ReportId != reportId || BiTokenData.Expiration > DateTime.Now.AddMinutes(-5))
            {
                if (reportDetails.RlsEnabled && !userGroupNames.Contains(adminUserGroup)&& !bypassPermission)
                {
                    List<string> roleList = new List<string>();

                    //check the user is departmentAdmin
                    if (isDepartmentAdmin)
                    {
                        //check the corresponding department assigned via group/user/or department
                        //check via department
                        if (DepartmentAdminReports.Contains(reportId))
                        {
                            val = await _pbiService.GetEmbedParams(reportDetails.PowerWorkSpaceId, reportDetails.PowerBiReportId, ReportAccessLevel.View, null, null);
                        }
                        else
                        {
                            var userRoleList = reportDetails.RlsRoles?.RoleMappings.Where(i => i.IsActive && (i.Users != null && i.Users.Count > 0) && i.Users.Contains(userDetails.Id.ToString())).Select(r => r.RlsRole).ToList();
                            if (userRoleList != null)
                            {
                                roleList.AddRange(userRoleList);
                            }
                            var groupRoleList = reportDetails.RlsRoles?.RoleMappings.Where(i => i.IsActive && (i.Groups != null && i.Groups.Count > 0) && i.Groups.Any(g => userGroups.Contains(g))).Select(r => r.RlsRole).ToList();
                            if (groupRoleList != null)
                            {
                                roleList.AddRange(groupRoleList);
                            }

                            ReportIdentity reportIdentity = new ReportIdentity
                            {
                                UserName = _applicationUser.Email,
                                Roles = roleList
                            };
                            val = await _pbiService.GetEmbedParams(reportDetails.PowerWorkSpaceId, reportDetails.PowerBiReportId, ReportAccessLevel.View, null, reportIdentity);
                        }
                    }

                    else
                    {
                        var userRoleList = reportDetails.RlsRoles?.RoleMappings.Where(i => i.IsActive && (i.Users != null && i.Users.Count > 0) && i.Users.Contains(userDetails.Id.ToString())).Select(r => r.RlsRole).ToList();
                        if (userRoleList != null)
                        {
                            roleList.AddRange(userRoleList);
                        }
                        var groupRoleList = reportDetails.RlsRoles?.RoleMappings.Where(i => i.IsActive && (i.Groups != null && i.Groups.Count > 0) && i.Groups.Any(g => userGroups.Contains(g))).Select(r => r.RlsRole).ToList();
                        if (groupRoleList != null)
                        {
                            roleList.AddRange(groupRoleList);
                        }

                        ReportIdentity reportIdentity = new ReportIdentity
                        {
                            UserName = _applicationUser.Email,
                            Roles = roleList
                        };
                        val = await _pbiService.GetEmbedParams(reportDetails.PowerWorkSpaceId, reportDetails.PowerBiReportId, ReportAccessLevel.View, null, reportIdentity);
                    }
                }
                else
                {
                    val = await _pbiService.GetEmbedParams(reportDetails.PowerWorkSpaceId, reportDetails.PowerBiReportId, ReportAccessLevel.View, null, null);
                }
                tokenDetail.Token = val.EmbedToken.Token;
                tokenDetail.WorkspaceId = reportDetails.PowerWorkSpaceId;
                tokenDetail.ReportId = reportId;
                tokenDetail.EmbeddedUrl = val.EmbedReports != null ? val.EmbedReports.FirstOrDefault()?.EmbedUrl : null;

                // Add to Session
                ReportToken reportData = new()
                {
                    ReportId = reportId,
                    Token = val.EmbedToken.Token,
                    Expiration = val.EmbedToken.Expiration,
                    EmbeddedUrl = tokenDetail.EmbeddedUrl
                };

                _httpContextAccessor.HttpContext.SetObject("Token", reportData);

            }
            else
            {
                tokenDetail.ReportId = BiTokenData.ReportId;
                tokenDetail.EmbeddedUrl = BiTokenData.EmbeddedUrl;
                tokenDetail.Token = BiTokenData.Token;
            }

            //insert into access log
            await WriteAccessLog(userDetails.Id, reportId);

            return tokenDetail;
        }

        private async Task WriteAccessLog(Guid userId, Guid reportId)
        {
            var existingdata = await _reportAccessLogRepository.Where(i => i.UserId == userId && i.ReportId == reportId).FirstOrDefaultAsync();
            if (existingdata == null)
            {
                ReportAccessLog log = new ReportAccessLog
                {
                    UserId = userId,
                    Accessed_At = new List<DateTime> { DateTime.UtcNow },
                    ReportId = reportId
                };
                await _reportAccessLogRepository.SaveAsync(log);
            }
            else
            {
                var data = existingdata.Accessed_At.Clone();
                data.Add(DateTime.UtcNow);
                existingdata.Accessed_At = data;
                await _reportAccessLogRepository.UpdateAsync(existingdata);
            }
        }

        public async Task<FileModel> DownloadPdf(Guid reportId, ExportRequest exportRequest)
        {
            var adminUserGroup = _configuration.GetValue<string>("SystemAdminRoleName");

            var userDetails = await _usersRepository.Where(i => i.EmailAddress.ToLower() == _applicationUser.Email).FirstOrDefaultAsync();
            if (userDetails == null)
            {
                throw new UnauthorizedAccessException();
            }
            var roles = await _roleRepository.RoleNameByUserId(userDetails.Id);
            //fetch user groups
            List<string> userGroups = await _userRoleRepository.Where(i => i.UserId == userDetails.Id).Select(p => p.RoleId.ToString()).ToListAsync();
            List<string> userGroupNames = await _userRoleRepository.GetRolesByEmailId(userDetails.EmailAddress);

            var reportDetails = await _reportRepository.FindByIdAsync(reportId);

            if (reportDetails == null)
            {
                throw new AppException(ValidationMessages.ReportNotFound);
            }
            PbiReportExportRequest pbiReportExportRequest = _mapper.Map<PbiReportExportRequest>(exportRequest);
            pbiReportExportRequest.ReportId = reportDetails.PowerBiReportId;
            pbiReportExportRequest.WorkspaceId = reportDetails.PowerWorkSpaceId;
            pbiReportExportRequest.ExportName = reportDetails.Name;
            pbiReportExportRequest.PollingtimeOutInMinutes = 10;
            if (reportDetails.RlsEnabled && !userGroupNames.Contains(adminUserGroup))
            {
                pbiReportExportRequest.IsRlsEbabled = reportDetails.RlsEnabled;
                List<string> roleList = new List<string>();
                var userRoleList = reportDetails.RlsRoles?.RoleMappings.Where(i => i.IsActive && (i.Users != null && i.Users.Count > 0) && i.Users.Contains(userDetails.Id.ToString())).Select(r => r.RlsRole).ToList();
                if (userRoleList != null)
                {
                    roleList.AddRange(userRoleList);
                }
                var groupRoleList = reportDetails.RlsRoles?.RoleMappings.Where(i => i.IsActive && (i.Groups != null && i.Groups.Count > 0) && i.Groups.Any(g => userGroups.Contains(g))).Select(r => r.RlsRole).ToList();
                if (groupRoleList != null)
                {
                    roleList.AddRange(groupRoleList);
                }

                ReportIdentity reportIdentity = new()
                {
                    UserName = _applicationUser.Email,
                    Roles = roleList
                };
                pbiReportExportRequest.ReportIdentity = reportIdentity;
            }
            if (exportRequest.Filters != null)
            {
                var newList = exportRequest.Filters
                                .GroupBy(x => new { x.TableName, x.Column })
                                .Select(y => new
                                {
                                    TableName = y.Key.TableName,
                                    Column = y.Key.Column,
                                    Selected = y.Select(k => k.SelectedValue).ToList()
                                }
                                ).ToList();
                foreach (var item in newList)
                {
                    string filterValue = item.TableName + "/" + item.Column;
                    if (item.Selected.Count > 1)
                    {
                        filterValue = $"{filterValue} in({string.Join(",", item.Selected)})";
                    }
                    else
                    {
                        //Store/Territory eq 'NC'
                        filterValue = $"{filterValue} eq {" " +"'"+ item.Selected.First() +"'"}";
                    }
                    pbiReportExportRequest.Filters = filterValue;
                }
            }
            if (exportRequest.OnlyCurrentPage)
            {
                pbiReportExportRequest.PageParameters = exportRequest.PageParameters;
                return await _pbiService.ExportPowerBIReportAPI(pbiReportExportRequest);

                //return await _pbiService.ExportPaginatedReport(_applicationUser.Token, pbiReportExportRequest.WorkspaceId, pbiReportExportRequest.ReportId, "pdf", pbiReportExportRequest.ExportFileFormat, _applicationUser.Email, "pdf", pbiReportExportRequest.PageParameters);
            }
            else
            {

                return await _pbiService.ExportPowerBIReportAPI(pbiReportExportRequest);

            }
        }
    }
}
