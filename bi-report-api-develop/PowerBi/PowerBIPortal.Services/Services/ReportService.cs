using AutoMapper;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.PowerBI.Api.Models;
using PowerBIPortal.Core.Constants;
using PowerBIPortal.Core.Exceptions;
using PowerBIPortal.Core.Models.Api;
using PowerBIPortal.Core.Models.Dto;
using PowerBIPortal.Core.Models.Entity;
using PowerBIPortal.Core.User;
using PowerBIPortal.Data.Helpers;
using PowerBIPortal.Data.Interfaces;
using PowerBIPortal.Data.Repositories;
using PowerBIPortal.Services.Interfaces;
using System.Data;
using Report = PowerBIPortal.Core.Models.Entity.Report;

namespace PowerBIPortal.Services.Services
{
    public class ReportService : IReportService
    {
        private readonly IApplicationUser _applicationUser;
        private readonly IReportRepository _reportRepository;
        private readonly IUserFavoritesRepository _userFavoritesRepository;
        private readonly IUsersRepository _usersRepository;
        private readonly IReportRoleAccessRepository _reportRoleAccessRepository;
        private readonly IReportUserAccessRepository _reportUserAccessRepository;
        private readonly IMapper _mapper;
        private readonly IReportCategorySevice _reportCategorySevice;
        private readonly IConfiguration _configuration;
        private readonly IUserGroupService _userGroupService;
        private readonly IReportCategoriesRepository _reportCategoriesRepository;

        public ReportService(IReportRepository reportRepository,
            IApplicationUser applicationUser, IUserFavoritesRepository userFavoritesRepository, IUsersRepository usersRepository,
            IReportRoleAccessRepository reportRoleAccessRepository, IMapper mapper, IReportUserAccessRepository reportUserAccessRepository,
            IReportCategorySevice reportCategorySevice, IConfiguration configuration, IUserGroupService userGroupService,
            IReportCategoriesRepository reportCategoriesRepository)
        {
            _reportCategoriesRepository = reportCategoriesRepository;
            _applicationUser = applicationUser;
            _reportRepository = reportRepository;
            _userFavoritesRepository = userFavoritesRepository;
            _usersRepository = usersRepository;
            _reportRoleAccessRepository = reportRoleAccessRepository;
            _mapper = mapper;
            _reportUserAccessRepository = reportUserAccessRepository;
            _reportCategorySevice = reportCategorySevice;
            _configuration = configuration;
            _userGroupService = userGroupService;
        }

        public async Task<List<ReportDetailsDto>> GetAllMyReport()
        {
            // check the user exist in user Db, if not Add the user
            var user = await _usersRepository.Where(u => u.EmailAddress.Trim().ToLower() == _applicationUser.Email.Trim().ToLower()).FirstOrDefaultAsync();
            if (user == null)
            {
                throw new UnauthorizedAccessException();
            }
            //
            List<ReportDetailsDto> result = new();
            var adminName = _configuration.GetValue<string>("SystemAdminRoleName");
            var roles = await _userGroupService.GetRolesByEmailId(user.EmailAddress);

            var departments = await _reportCategorySevice.GetDepartmentofUser(user.Id);
            if (departments.Any() && !roles.Contains(adminName))
            {
                result = await _reportRepository.GetAllMyReportsofDepartmentAdmin(user.Id, departments);

            }
            else
            {
                result = await _reportRepository.GetAllReports(user.Id);
            }

            var categories = await _reportCategoriesRepository.GetActiveCategoryHierarchy();
            if (categories != null)
            {
                foreach (var report in result)
                {
                    report.CategoryPath = CategoryPathBuilder.Build(categories, report.CategoryId);
                }
            }
            return result;
        }

        public async Task<List<ReportDetailsDto>> FavoriteReport(Guid reportId)
        {
            var getUser = await _usersRepository.Where(u => u.EmailAddress.Trim().ToLower() == _applicationUser.Email.Trim().ToLower()).FirstOrDefaultAsync();
            UserFavorites data = new()
            {
                BiReportId = reportId,
                UserId = getUser.Id
            };
            using (var transaction = await _userFavoritesRepository.BeginTransactionAsync())
            {
                try
                {
                    // check is exist data
                    var exist = await _userFavoritesRepository.
                        Where(i => i.UserId == data.UserId && i.BiReportId == reportId).IgnoreQueryFilters().FirstOrDefaultAsync();
                    if (exist != null && exist.IsActive)
                    {
                        await _userFavoritesRepository.DeleteByIdAsync(exist.Id);

                    }
                    else if (exist != null && !exist.IsActive)
                    {
                        data.Id = exist.Id;
                        data.CreatedAt = exist.CreatedAt;
                        data.CreatedBy = exist.CreatedBy;
                        data.DeletedAt = null;
                        data.DeletedBy = null;
                        await _userFavoritesRepository.UpdateAsync(data);
                    }
                    else
                    {
                        var result = await _userFavoritesRepository.SaveAsync(data);
                    }
                    await transaction.CommitAsync();
                }
                catch (Exception)
                {
                    await transaction.RollbackAsync();
                    throw;
                }
                return await GetAllMyReport();
            }
        }
        public async Task<PageModel<ReportDetailsDto>> AddUpdateReport(ReportCreateRequest reportCreateRequest)
        {
            PagedRequest pagedRequest = new PagedRequest();
            using (var transaction = await _reportRepository.BeginTransactionAsync())
            {
                try
                {
                    if (reportCreateRequest.Id != Guid.Empty)
                    {
                        Report existingReport = await _reportRepository.FindByIdAsync(reportCreateRequest.Id);
                        if (existingReport == null)
                        {
                            throw new AppException(ValidationMessages.ReportNotFound);
                        }


                        existingReport.Name = reportCreateRequest.Name;
                        existingReport.Description = reportCreateRequest.Description;
                        existingReport.PowerBiReportId = reportCreateRequest.PowerBiReportId;
                        existingReport.PowerWorkSpaceId = reportCreateRequest.PowerWorkSpaceId;
                        existingReport.ReportCategory = reportCreateRequest.ReportCategory;
                        existingReport.EnablePagination = reportCreateRequest.EnablePagination;
                        existingReport.RlsEnabled = reportCreateRequest.RlsEnabled;
                        if (reportCreateRequest.RlsEnabled)
                        {
                            var mappedRoles = existingReport.RlsRoles.Clone();
                            var newAdded = reportCreateRequest.PowerBiRlsRole.Where(p => p.Id == Guid.Empty).ToList();

                            // remove deleted rls roles
                            var removed = mappedRoles?.RoleMappings?.Where(x => x.IsActive).Select(p => p.Id).ToList().Except(reportCreateRequest.PowerBiRlsRole.Select(p => p.Id)).ToList();
                            if (removed != null && removed.Count > 0)
                            {
                                mappedRoles?.RoleMappings.Where(x => removed.Contains(x.Id)).ToList().ForEach(p => p.IsActive = false);
                            }
                            //update all rls roles - if name changes can happen
                            var updateList = mappedRoles?.RoleMappings?.Where(p => p.IsActive).ToList();
                            if (updateList != null)
                            {
                                foreach (var item in updateList)
                                {
                                    item.RlsRole = reportCreateRequest.PowerBiRlsRole.Where(p => p.Id == item.Id).FirstOrDefault().RlsRole;
                                }
                            }

                            //new added
                            if (newAdded.Count > 0)
                            {
                                if (mappedRoles == null)
                                {
                                    mappedRoles = new RlsRoles
                                    {
                                        RoleMappings = new List<RoleMappings>()
                                    };
                                }
                                List<RoleMappings> newMapping = newAdded.Select(x => new RoleMappings
                                {
                                    Groups = new List<string>(),
                                    Users = new List<string>(),
                                    RlsRole = x.RlsRole,
                                    Id = Guid.NewGuid(),
                                    IsActive = true
                                }).ToList();

                                mappedRoles.RoleMappings.AddRange(newMapping);
                            }
                            existingReport.RlsRoles = mappedRoles;
                        }
                        await _reportRepository.UpdateAsync(existingReport);
                    }
                    else
                    {
                        Report report = new Report();
                        report.Id = reportCreateRequest.Id == Guid.Empty ? Guid.NewGuid() : reportCreateRequest.Id;
                        report.Name = reportCreateRequest.Name;
                        report.Description = reportCreateRequest.Description;
                        report.PowerBiReportId = reportCreateRequest.PowerBiReportId;
                        report.PowerWorkSpaceId = reportCreateRequest.PowerWorkSpaceId;
                        report.RlsEnabled = reportCreateRequest.RlsEnabled;
                        report.EnablePagination = reportCreateRequest.EnablePagination;
                        report.ReportCategory = reportCreateRequest.ReportCategory;
                        if (reportCreateRequest.RlsEnabled)
                        {
                            report.RlsRoles = new RlsRoles
                            {
                                RoleMappings = new List<RoleMappings>()
                            };
                            List<RoleMappings> newMapping = new();
                            foreach (var item in reportCreateRequest.PowerBiRlsRole)
                            {
                                RoleMappings map = new()
                                {
                                    Groups = new List<string>(),
                                    Users = new List<string>()
                                };
                                map.RlsRole = item.RlsRole;
                                map.IsActive = true;
                                map.Id = Guid.NewGuid();
                                newMapping.Add(map);
                            }
                            report.RlsRoles.RoleMappings.AddRange(newMapping);
                        }
                        await _reportRepository.SaveAsync(report);
                    }
                    await transaction.CommitAsync();
                }
                catch (Exception)
                {
                    await transaction.RollbackAsync();
                    throw;
                }
            }
            pagedRequest.PageSize = 20;
            pagedRequest.Page = 1;
            return await _reportRepository.GetAllReports(pagedRequest);
        }

        public async Task<PageModel<ReportDetailsDto>> GetAllReports(PagedRequest pagedRequest)
        {
            var userInfo = await _usersRepository.Where(u => u.EmailAddress.Trim().ToLower() == _applicationUser.Email.Trim().ToLower()).FirstOrDefaultAsync();
            if (userInfo == null)
            {
                throw new UnauthorizedAccessException();
            }

            var adminName = _configuration.GetValue<string>("SystemAdminRoleName");
            var roles = await _userGroupService.GetRolesByEmailId(userInfo.EmailAddress);

            var departments = await _reportCategorySevice.GetDepartmentofUser(userInfo.Id);
            if (departments.Any() && !roles.Contains(adminName))
            {
                return await _reportRepository.GetAllReportsofDepartmentAdmin(pagedRequest, departments);
            }
            else
            {
                return await _reportRepository.GetAllReports(pagedRequest);
            }
        }

        public async Task<ReportAssignedDetails> GetReportDetailById(Guid id)
        {
            var reportData = await _reportRepository.FindByIdAsync(id);
            if (reportData == null)
            {
                throw new AppException(ValidationMessages.ReportNotFound);
            }
            var userInfo = await _usersRepository.Where(u => u.EmailAddress.Trim().ToLower() == _applicationUser.Email.Trim().ToLower()).FirstOrDefaultAsync();

            var result = await _reportRepository.GetReportDetailById(id);

            var adminName = _configuration.GetValue<string>("SystemAdminRoleName");
            var roles = await _userGroupService.GetRolesByEmailId(userInfo.EmailAddress);
            var departments = await _reportCategorySevice.GetDepartmentofUser(userInfo.Id);

            //filter group if department admin accessing
            if (departments.Any() && !roles.Contains(adminName))
            {
                var departmentGroups = await _userGroupService.GetAllRoles();
                var deprtmentIds = departmentGroups.Select(p => p.Id).ToList();
                if (departmentGroups.Count > 0)
                {
                    var filetrData = result.AssignedGroup?.Where(p => deprtmentIds.Contains(p.GroupId)).ToList();
                    result.AssignedGroup = filetrData;
                }
            }
            return result;
        }
        public async Task<ReportAssignedDetails> MapReportToGroup(Guid reportId, Guid groupId, ReportMapRequest mapingRequest)
        {
            var reportData = await _reportRepository.FindByIdAsync(reportId);
            if (reportData == null)
            {
                throw new AppException(ValidationMessages.ReportNotFound);
            }

            using (var transaction = await _reportRepository.BeginTransactionAsync())
            {
                try
                {
                    //check group is already mapped 
                    var existingMapping = await _reportRoleAccessRepository.Where(i => i.BiReportId == reportId && i.RoleId == groupId).FirstOrDefaultAsync();
                    if (existingMapping != null)
                    {

                        await _reportRoleAccessRepository.UpdateAsync(existingMapping);
                    }
                    else
                    {
                        ReportRoleAccess reportRoleAccess = new()
                        {
                            BiReportId = reportId,
                            RoleId = groupId,
                            Permission = Core.Enums.ReportPermission.Viewer,
                            RLS_Bypassed = mapingRequest.BypassRLS,
                        };

                        await _reportRoleAccessRepository.SaveAsync(reportRoleAccess);
                    }

                    
                    if (reportData.RlsEnabled && mapingRequest?.RolesSelected != null)
                    {
                        var existingMappingData = reportData.RlsRoles?.Clone();
                        //check the group is already mapped against this rls role


                        RlsRoles newRoleData = new();
                        var existingReport = _mapper.Map<ReportInformation>(reportData);
                        //check requesting rls alreadday there
                        foreach (var role in mapingRequest.RolesSelected)
                        {
                            if (existingMappingData == null)
                            {
                                existingMappingData = new RlsRoles()
                                {
                                    RoleMappings = new List<RoleMappings>()
                                {
                                    new RoleMappings()
                                    {
                                        Groups = new List<string>(),
                                        Users = new List<string>()
                                    }
                                }
                                };
                                existingMappingData.RoleMappings.First().Groups.Add(groupId.ToString());
                                existingMappingData.RoleMappings.First().RlsRole = role;
                            }
                            else
                            {

                                var existingRolesMapped = existingMappingData.RoleMappings.Where(i => i.RlsRole != null && i.RlsRole.Contains(role)).FirstOrDefault();
                                if (existingRolesMapped == null)
                                {
                                    List<RoleMappings> newMapping = new();
                                    RoleMappings map = new()
                                    {
                                        Groups = new List<string>(),
                                        Users = new List<string>()
                                    };
                                    map.RlsRole = role;
                                    map.Groups.Add(groupId.ToString());
                                    newMapping.Add(map);
                                    existingMappingData.RoleMappings.AddRange(newMapping);
                                }
                                else
                                {
                                    foreach (var roleName in existingMappingData.RoleMappings)
                                    {
                                        if (roleName.Groups == null)
                                        {
                                            roleName.Groups = new List<string>();
                                        }
                                        if (roleName.RlsRole == role && !roleName.Groups.Contains(groupId.ToString()))
                                        {
                                            roleName.Groups.Add(groupId.ToString());
                                        }
                                    }
                                }
                            }
                        }

                        reportData.RlsRoles = existingMappingData;

                        await _reportRepository.UpdateAsync(reportData);

                    }
                    await transaction.CommitAsync();
                }
                catch (Exception)
                {
                    await transaction.RollbackAsync();
                    throw;
                }
            }
            return await GetReportDetailById(reportId);
        }

        public async Task<ReportAssignedDetails> MapReportToUser(Guid reportId, Guid userId, ReportMapRequest mapingRequest)
        {
            var reportData = await _reportRepository.FindByIdAsync(reportId);
            if (reportData == null)
            {
                throw new AppException(ValidationMessages.ReportNotFound);
            }

            using (var transaction = await _reportUserAccessRepository.BeginTransactionAsync())
            {
                try
                {
                    // check mapping already exist -> user can map rls role alone
                    var existingUserMapping = await _reportUserAccessRepository.Where(i => i.BiReportId == reportId && i.UserId == userId).FirstOrDefaultAsync();
                    if (existingUserMapping != null)
                    {
                        await _reportUserAccessRepository.UpdateAsync(existingUserMapping);
                    }
                    else
                    {
                        ReportUserAccess reportUser = new()
                        {
                            BiReportId = reportId,
                            UserId = userId,
                            Permission = Core.Enums.ReportPermission.Viewer,
                            RLS_Bypassed = mapingRequest.BypassRLS
                        };
                        await _reportUserAccessRepository.SaveAsync(reportUser);
                    }

                    
                    if (reportData.RlsEnabled && mapingRequest?.RolesSelected != null)
                    {
                        var existingMappingData = reportData.RlsRoles?.Clone();
                        var existingReport = _mapper.Map<ReportInformation>(reportData);
                        foreach (var role in mapingRequest.RolesSelected)
                        {
                            if (existingMappingData == null)
                            {
                                existingMappingData = new RlsRoles()
                                {
                                    RoleMappings = new List<RoleMappings>()
                                {
                                    new RoleMappings()
                                    {
                                        Users = new List<string>(),
                                        Groups = new List<string>()
                                    }
                                }
                                };
                                existingMappingData.RoleMappings.First().Users.Add(userId.ToString());
                                existingMappingData.RoleMappings.First().RlsRole = role;
                            }
                            else
                            {

                                var existingRolesMapped = existingMappingData.RoleMappings.Where(i => i.RlsRole.Contains(role)).FirstOrDefault();
                                if (existingRolesMapped == null)
                                {
                                    List<RoleMappings> newMapping = new();
                                    RoleMappings map = new()
                                    {
                                        Users = new List<string>(),
                                        Groups = new List<string>()
                                    };
                                    map.RlsRole = role;
                                    map.Users.Add(userId.ToString());
                                    newMapping.Add(map);
                                    existingMappingData.RoleMappings.AddRange(newMapping);
                                }
                                else
                                {
                                    foreach (var roleName in existingMappingData.RoleMappings)
                                    {
                                        if (roleName.Users == null)
                                        {
                                            roleName.Users = new List<string>();
                                        }
                                        if (roleName.RlsRole == role && !roleName.Users.Contains(userId.ToString()))
                                        {

                                            roleName.Users.Add(userId.ToString());
                                        }
                                    }
                                }
                            }

                        }
                        reportData.RlsRoles = existingMappingData;
                        await _reportRepository.UpdateAsync(reportData);
                    }
                    await transaction.CommitAsync();
                }
                catch (Exception)
                {
                    await transaction.RollbackAsync();
                    throw;
                }
            }
            return await _reportRepository.GetReportDetailById(reportId);
        }

        public async Task<ReportAssignedDetails> DeleteMappedGroupFromReport(ReportMappingDeleteRequest reportMappingDeleteRequest)
        {
            using (var transaction = await _reportRoleAccessRepository.BeginTransactionAsync())
            {
                try
                {
                    var reportData = await _reportRepository.FindByIdAsync(reportMappingDeleteRequest.ReportId);

                    var mappedReport = await _reportRoleAccessRepository.FindByIdAsync(reportMappingDeleteRequest.MappingGroupId);
                    if (mappedReport == null)
                    {
                        throw new AppException(ValidationMessages.DataNotFound);
                    }
                    Guid groupId = mappedReport.RoleId;
                    await _reportRoleAccessRepository.DeleteByIdAsync(mappedReport.Id);

                    //remove from josn mapping
                    if (reportData != null && reportData.RlsEnabled)
                    {
                        var rlsMapping = reportData.RlsRoles.Clone();
                        foreach (var data in rlsMapping.RoleMappings)
                        {
                            if (data.Groups.Contains(groupId.ToString()))
                            {
                                data.Groups.Remove(groupId.ToString());
                            }

                        }
                        reportData.RlsRoles = rlsMapping;
                        await _reportRepository.UpdateAsync(reportData);
                    }
                    await transaction.CommitAsync();
                }
                catch (Exception)
                {
                    await transaction.RollbackAsync();
                    throw;
                }
            }

            return await GetReportDetailById(reportMappingDeleteRequest.ReportId);
        }

        public async Task<ReportAssignedDetails> DeleteMappedUserFromReport(ReportMappingDeleteRequest reportMappingDeleteRequest)
        {
            using (var transaction = await _reportUserAccessRepository.BeginTransactionAsync())
            {
                try
                {
                    var reportData = await _reportRepository.FindByIdAsync(reportMappingDeleteRequest.ReportId);

                    var mappedReport = await _reportUserAccessRepository.FindByIdAsync(reportMappingDeleteRequest.MappingUserId);
                    if (mappedReport == null)
                    {
                        throw new AppException(ValidationMessages.DataNotFound);
                    }
                    Guid userId = mappedReport.UserId;

                    await _reportUserAccessRepository.DeleteByIdAsync(mappedReport.Id);

                    //remove from josn mapping
                    if (reportData != null && reportData.RlsEnabled)
                    {
                        var rlsMapping = reportData.RlsRoles.Clone();
                        foreach (var data in rlsMapping.RoleMappings)
                        {
                            if (data.Users != null && data.Users.Contains(userId.ToString()))
                            {
                                data.Users.Remove(userId.ToString());
                            }

                        }
                        reportData.RlsRoles = rlsMapping;
                        await _reportRepository.UpdateAsync(reportData);
                    }
                    await transaction.CommitAsync();
                }
                catch (Exception)
                {
                    await transaction.RollbackAsync();
                    throw;
                }
            }
            return await GetReportDetailById(reportMappingDeleteRequest.ReportId);
        }

        public async Task DeleteReport(Guid reportId)
        {
            var existingData = await _reportRepository.FindByIdAsync(reportId);
            if (existingData == null)
            {
                throw new AppException(ValidationMessages.ReportNotFound);
            }
            await _reportRepository.DeleteByIdAsync(reportId);
        }
    }
}
