using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using PowerBIPortal.Core.Models.Api;
using PowerBIPortal.Core.Models.Dto;
using PowerBIPortal.Core.Models.Entity;
using PowerBIPortal.Core.Utility;
using PowerBIPortal.Data.DBContexts;
using PowerBIPortal.Data.Extensions;
using PowerBIPortal.Data.Interfaces;
using System.Linq;

namespace PowerBIPortal.Data.Repositories
{
    public class ReportRepository : BaseRepository<Report>, IReportRepository
    {
        private readonly PortalDbContext _dbContext;
        private readonly IGroupRepository _roleRepository;
        private readonly IConfiguration _configuration;
        private readonly IUserRolesRepository _userRoleRepository;

        public ReportRepository(PortalDbContext dbContext, IGroupRepository roleRepository, IConfiguration configuration,
            IUserRolesRepository userRoleRepository) : base(dbContext)

        {
            _dbContext = dbContext;
            _roleRepository = roleRepository;
            _configuration = configuration;
            _userRoleRepository = userRoleRepository;

        }

        public async Task<List<ReportDetailsDto>> GetAllReports(Guid userId)
        {
            List<ReportInformation> getReports = new();
            List<ReportInformation> roleReports = new();
            List<ReportInformation> userReports = new();
            List<ReportInformation> group_BypassedRpts = new();
            List<ReportInformation> user_BypassedRpts = new();
            var adminUserGroup = _configuration.GetValue<string>("SystemAdminRoleName");
            var userDetail = await _dbContext.Users.FirstOrDefaultAsync(i => i.Id == userId);
            var roles = await _roleRepository.RoleNameByUserId(userId);
            var favoritedReports = await _dbContext.UserFavorites.Where(p => p.UserId == userId).ToListAsync();

            List<string> userGroups = await _userRoleRepository.Where(i => i.UserId == userId).Select(p => p.RoleId.ToString()).ToListAsync();
            List<string> userGroupNames = await _userRoleRepository.GetRolesByEmailId(userDetail.EmailAddress);

            //System Admin
            if (roles.Count > 0 && roles.Select(p => p.Name).Contains(adminUserGroup))
            {
                roleReports = await GetAllReports();
                getReports.AddRange(roleReports);
            }
            //Other Users excpet Department Admin
            else
            {
                roleReports = await ReportAssignedViaGroup(userId);
                getReports.AddRange(roleReports);
                group_BypassedRpts = await BypassedReportAssignedViaGroup(userId);
                getReports.AddRange(group_BypassedRpts);

                if (userDetail != null)
                {
                    userReports = await ReportAssignedViaUser(userDetail.Id);
                    getReports.AddRange(userReports);
                    user_BypassedRpts = await BypassedReportAssignedViaUser(userId);
                    getReports.AddRange(user_BypassedRpts);
                }
            }

            var uniqueReports = getReports.GroupBy(p => p.Id).Select(g => g.First()).ToList();

            //check if rls enabled report found and its RLS mappings done.else remove that
            //if a report is RLS bypassed no need to check RLS relation

            var rlsReports = uniqueReports.Where(i => i.RlsEnabled).ToList();
            if (rlsReports != null && rlsReports.Any() && !userGroupNames.Contains(adminUserGroup))
            {
                var recordstoRemove = new List<ReportInformation>();

                var rlsRolesNotDefined = rlsReports.Where(i => i.RlsRoles == null).ToList();
                if (rlsRolesNotDefined.Any())
                {
                    rlsReports = rlsReports.Except(rlsRolesNotDefined).ToList();
                    uniqueReports = uniqueReports.Except(rlsRolesNotDefined).ToList();
                }

                foreach (var rlseport in rlsReports)
                {
                    var rlsEnabledReports = rlseport.RlsRoles.RoleMappings.Where(x => x.RlsRole != null && x.IsActive);
                    if(group_BypassedRpts.Any(p=>p.Id==rlseport.Id) || user_BypassedRpts.Any(o=>o.Id==rlseport.Id))
                        {continue;}
                    if (rlsEnabledReports.Any())
                    {
                        var allgroups = rlsEnabledReports.Where(x => x.Groups != null).SelectMany(y => y.Groups).ToList();
                        var allusers = rlsEnabledReports.Where(y => y.Users != null).SelectMany(x => x.Users).ToList();
                        bool hasGroup = allgroups.Intersect(userGroups).Any();
                        bool hasUserId = allusers.Contains(userId.ToString());

                        if (!(hasGroup || hasUserId))
                        {
                            var uniqueReporttoRemove = uniqueReports.FirstOrDefault(x => x.Id == rlseport.Id);
                            recordstoRemove.Add(uniqueReporttoRemove);
                        }
                    }
                }

                if (recordstoRemove.Any())
                {
                    uniqueReports = uniqueReports.Except(recordstoRemove).ToList();
                }
            }


            if (favoritedReports.Count > 0 && uniqueReports.Count > 0)
            {
                foreach (var item in uniqueReports)
                {
                    item.Favorite = favoritedReports.Where(p => p.BiReportId == item.Id).ToList().Count > 0 ? true : false;
                }
            }

            var result = uniqueReports.Select(j => new ReportDetailsDto
            {
                Id = j.Id,
                Title = j.Title,
                Description = j.Description,
                CategoryId = j.CategoryId,
                CategoryName = j.CategoryName,
                EnablePagination = j.EnablePagination,
                ReportId = j.ReportId,
                Favorite = j.Favorite,
                RlsEnabled = j.RlsEnabled,

            }).OrderBy(p => p.CategoryName).ToList();


            return result;
        }
        public async Task<bool> CheckPermissionByReportId(Report report, Guid userId)
        {
            
            var data =  await (from roleAccess in _dbContext.ReportRoleAccesses
                              join userRole in _dbContext.UserGroups on roleAccess.RoleId equals userRole.RoleId
                              where userRole.UserId == userId && roleAccess.BiReportId == report.Id
                              && roleAccess.IsActive
                              select new { roleAccess }).FirstOrDefaultAsync();

            // var groupIds = data.Select(p=>p.roleAccess.RoleId.ToString()).ToList();
            var groupId = data?.roleAccess.RoleId.ToString();
            bool bypassedviaGroup = data!=null && (data.roleAccess!=null ) && data.roleAccess.RLS_Bypassed;

            var userData = await (from userAccess in _dbContext.ReportUserAccesses
                                  where userAccess.BiReportId == report.Id && userAccess.UserId == userId
                                  &&userAccess.IsActive
                                  select new { userAccess }
                                   ).FirstOrDefaultAsync();

            bool bypassedViaUser = userData!=null && userData.userAccess!=null && userData.userAccess.RLS_Bypassed;
            if (report.RlsEnabled && (data != null || userData != null)&&!bypassedviaGroup && !bypassedViaUser)
            {
                bool rlsMapGroup = false;
                var groupMappings = report.RlsRoles.RoleMappings.Where(p => p.IsActive).SelectMany(p => p.Groups).ToList();

                foreach(var group in groupMappings){
                    if(groupId.Contains(group))
                        rlsMapGroup = true;
                }
                var rlsMapUser = report.RlsRoles.RoleMappings.Where(p => p.IsActive).SelectMany(p => p.Users).ToList().Contains(userData?.userAccess?.UserId.ToString());
                return rlsMapGroup || rlsMapUser;
            }
            else
            {
                return bypassedviaGroup || bypassedViaUser ? bypassedviaGroup || bypassedViaUser : data != null || userData != null;
            }
        }

        public async Task<bool> BypassPermission(Guid reportid, Guid userId)
        {
            bool bypass = false;

            var bypassForGroup = await (from roleAccess in _dbContext.ReportRoleAccesses
            join userRole in _dbContext.UserGroups on roleAccess.RoleId equals userRole.RoleId
            where userRole.UserId == userId && roleAccess.BiReportId == reportid 
            && roleAccess.RLS_Bypassed == true && roleAccess.IsActive & userRole.IsActive
            select new { roleAccess }).FirstOrDefaultAsync();

            var bypassForUser = await (from userAccess in _dbContext.ReportUserAccesses
                                  where userAccess.BiReportId == reportid && userAccess.UserId == userId
                                  &&userAccess.IsActive && userAccess.RLS_Bypassed == true
                                  select new { userAccess }
                                   ).FirstOrDefaultAsync();
            if(bypassForGroup != null && bypassForGroup.roleAccess.RLS_Bypassed)
                bypass = true;
            if(bypassForUser != null && bypassForUser.userAccess.RLS_Bypassed)
                bypass = true;

            return bypass;

            
        }
        public async Task<PageModel<ReportDetailsDto>> GetAllReports(PagedRequest pagedRequest)
        {
            var roleReports = await (from report in _dbContext.Reports
                                     join category in _dbContext.ReportCategories on report.ReportCategory equals category.Id into tempCategory
                                     from category in tempCategory.DefaultIfEmpty()
                                         //join reportRole in _dbContext.ReportRoleAccesses on report.Id equals reportRole.BiReportId into tempRole
                                         //from reportRole in tempRole.DefaultIfEmpty()
                                     where string.IsNullOrEmpty(pagedRequest.Search) ? true : report.Name.ToLower().Trim().Contains(pagedRequest.Search.Trim().ToLower())
                                     select new ReportDetailsDto
                                     {
                                         Id = report.Id,
                                         Title = report.Name,
                                         Description = report.Description,
                                         CategoryId = CommonUtility.IsNotNull(category) ? category.Id : Guid.Empty,
                                         CategoryName = CommonUtility.IsNotNull(category) ? category.Name : null,
                                         EnablePagination = report.EnablePagination,
                                         ReportId = report.PowerBiReportId,
                                         RlsEnabled = report.RlsEnabled,
                                         WorkspaceId = report.PowerWorkSpaceId,
                                         PowerBiReportId = report.PowerBiReportId,
                                         PowerBiRlsRole = report.RlsEnabled ? GetRlsRolesList(report) : null,
                                         
                                         //RoleId = CommonUtility.IsNotNull(reportRole) ? reportRole.Id : Guid.Empty
                                     }).OrderBy(v => v.Title).ToListAsync();

            if (pagedRequest.FilterValue != null)
            {
                roleReports = roleReports.Where(p => p.CategoryId.ToString() == pagedRequest.FilterValue).ToList();
            }
            var final = roleReports.Paginate(pagedRequest.Page, pagedRequest.PageSize.GetValueOrDefault());
            return final;
        }

        public async Task<ReportAssignedDetails> GetReportDetailById(Guid id)
        {
            ReportAssignedDetails reportDetails = new ReportAssignedDetails
            {
                ReportCategory = new ReportCategoryDto()
            };

            var reportData = await (from report in _dbContext.Reports
                                    join category in _dbContext.ReportCategories on report.ReportCategory equals category.Id into tempCategories
                                    from category in tempCategories.DefaultIfEmpty()
                                    where report.Id == id
                                    select new ReportDetailsDto
                                    {
                                        Id = report.Id,
                                        Title = report.Name,
                                        Description = report.Description,
                                        CategoryId = CommonUtility.IsNotNull(category) ? category.Id : Guid.Empty,
                                        CategoryName = CommonUtility.IsNotNull(category) ? category.Name : null,
                                        EnablePagination = report.EnablePagination,
                                        ReportId = report.PowerBiReportId,
                                        RlsEnabled = report.RlsEnabled,
                                        WorkspaceId = report.PowerWorkSpaceId,
                                        PowerBiReportId = report.PowerBiReportId,
                                        PowerBiRlsRole = GetRlsRolesList(report),
                                    }).FirstOrDefaultAsync();

            reportDetails.Id = reportData.Id;
            reportDetails.Title = reportData.Title;
            reportDetails.Description = reportData.Description;
            reportDetails.EnablePagination = reportData.EnablePagination;
            reportDetails.WorkspaceId = reportData.WorkspaceId;
            reportDetails.PowerBiReportId = reportData.PowerBiReportId;
            reportDetails.RlsEnabled = reportData.RlsEnabled;
            reportDetails.PowerBiRlsRole = reportData.PowerBiRlsRole;
            reportDetails.ReportCategory.Id = reportData.CategoryId;
            reportDetails.ReportCategory.Name = reportData.CategoryName;

            var roleReports = await (from report in _dbContext.Reports
                                     join roleAccess in _dbContext.ReportRoleAccesses on report.Id equals roleAccess.BiReportId
                                     join grp in _dbContext.Group on roleAccess.RoleId equals grp.Id
                                     where report.Id == id
                                     select new
                                     {
                                         Id = report.Id,
                                         GroupName = CommonUtility.IsNotNull(grp) ? grp.Name : null,
                                         Permission = CommonUtility.IsNotNull(roleAccess) ? roleAccess.Permission : 0,
                                         AssignedRole = CommonUtility.IsNotNull(grp) ? SelectRlsRole(report.RlsRoles, grp.Id, false, grp.Name) : null,
                                         rlsRols = report.RlsRoles,
                                         GroupMappingId = roleAccess.Id,
                                         GroupId = CommonUtility.IsNotNull(grp) ? grp.Id : Guid.Empty,
                                         RLS_Bypassed = roleAccess.RLS_Bypassed
                                     }).ToListAsync();

            var userAccessData = await (from report in _dbContext.Reports
                                        join userAccess in _dbContext.ReportUserAccesses on report.Id equals userAccess.BiReportId into tempUserAccess
                                        from userAccess in tempUserAccess.DefaultIfEmpty()
                                        join users in _dbContext.Users on userAccess.UserId equals users.Id
                                        where report.Id == id
                                        select new
                                        {
                                            Id = report.Id,
                                            UserName = CommonUtility.IsNotNull(users) ? users.Name : null,
                                            UserEmail = CommonUtility.IsNotNull(users) ? users.EmailAddress : null,
                                            UserPermission = CommonUtility.IsNotNull(userAccess) ? userAccess.Permission : 0,
                                            AssignedRole = CommonUtility.IsNotNull(users) ? SelectRlsRole(report.RlsRoles, users.Id, true, null) : null,
                                            UserMappingId = userAccess.Id,
                                            UserId = users.Id,
                                            RLS_Bypass = userAccess.RLS_Bypassed
                                        }).ToListAsync();

            var grouped = roleReports.GroupBy(p => p.Id).Select(j => new ReportAssignedDetails
            {
                Id = j.Key,
                AssignedGroup = j.Select(p => new AssignedGroups
                {
                    Permission = p.Permission,
                    Group = p.GroupName,
                    RlsRoleAssigned = p.AssignedRole,
                    MappingGroupId = p.GroupMappingId,
                    GroupId = p.GroupId,
                    RLS_Bypassed = p.RLS_Bypassed
                }).ToList()
            }).FirstOrDefault();

            var userData = userAccessData.GroupBy(p => p.Id).Select(j => new ReportAssignedDetails
            {
                Id = j.Key,
                AssignedUsers = j.Select(u => new AssignedUsers
                {
                    Permission = u.UserPermission,
                    User = u.UserName,
                    UserEmail = u.UserEmail,
                    RlsRoleAssigned = u.AssignedRole,
                    MappingUserId = u.UserMappingId,
                    UserId = u.UserId,
                    RLS_Bypassed = u.RLS_Bypass
                }).ToList()
            }).FirstOrDefault();

            reportDetails.AssignedGroup = (grouped != null && grouped.AssignedGroup.Any(i => i.Group != null)) ? grouped.AssignedGroup : null;
            reportDetails.AssignedUsers = userData != null ? userData.AssignedUsers : null;
            return reportDetails;
        }
        public static List<string> SelectRlsRole(RlsRoles rols, Guid id, bool isUser, string grpName = null)
        {
            List<string> roles = new();
            if (isUser)
            {
                roles = rols?.RoleMappings.Where(i => i.IsActive && (i.Users != null && i.Users.Count > 0) && i.Users.Contains(id.ToString())).Select(r => r.RlsRole).ToList();
            }
            else
            {
                roles = rols?.RoleMappings.Where(i => i.IsActive && (i.Groups != null && i.Groups.Count > 0) && i.Groups.Contains(id.ToString())).Select(r => r.RlsRole).ToList();

            }
            return roles;
        }

        private static List<RlsRoleDto> GetRlsRolesList(Report data)
        {
            var roleList = data.RlsRoles?.RoleMappings.Where(p => p.IsActive).Select(r => new RlsRoleDto { Id = r.Id, RlsRole = r.RlsRole }).ToList();
            return roleList;
        }

        public async Task<PageModel<ReportDetailsDto>> GetAllReportsofDepartmentAdmin(PagedRequest pagedRequest, List<ReportCategoryDto> reportCategories)
        {
            List<ReportCategories> categories = reportCategories.Select(p => new ReportCategories
            {
                Id = p.Id,
                Name = p.Name,
                Description = p.Description,
                DepartmentAdmin = p.DepartmentAdmin.Select(x => x.Id).ToList()
            }).ToList();
            var departmentAdminDept = categories.Select(c => c.Id).ToList();
            //var departmentAdminGroup = await _roleRepository.GetAllRolesofDepartmentAdmin(categories);
            //var departmentGrops = departmentAdminGroup.Select(p => p.Id).ToList();

            var departmentAdminReport = await (from report in _dbContext.Reports
                                               join category in _dbContext.ReportCategories on report.ReportCategory equals category.Id
                                               //join reportRole in _dbContext.ReportRoleAccesses on report.Id equals reportRole.BiReportId
                                               where string.IsNullOrEmpty(pagedRequest.Search) ? true : report.Name.ToLower().Trim().Contains(pagedRequest.Search.Trim().ToLower())
                                               select new ReportDetailsDto
                                               {
                                                   Id = report.Id,
                                                   Title = report.Name,
                                                   Description = report.Description,
                                                   CategoryId = CommonUtility.IsNotNull(category) ? category.Id : Guid.Empty,
                                                   CategoryName = CommonUtility.IsNotNull(category) ? category.Name : null,
                                                   EnablePagination = report.EnablePagination,
                                                   ReportId = report.PowerBiReportId,
                                                   RlsEnabled = report.RlsEnabled,
                                                   WorkspaceId = report.PowerWorkSpaceId,
                                                   PowerBiReportId = report.PowerBiReportId,
                                                   PowerBiRlsRole = report.RlsEnabled ? GetRlsRolesList(report) : null,
                                                   
                                                   //RoleId = reportRole.RoleId
                                               }).OrderBy(v => v.Title).ToListAsync();
            departmentAdminReport = departmentAdminReport.Where(p => departmentAdminDept.Contains(p.CategoryId)).ToList();
            if (pagedRequest.FilterValue != null)
            {
                departmentAdminReport = departmentAdminReport.Where(p => p.CategoryId.ToString() == pagedRequest.FilterValue).ToList();
            }
            var final = departmentAdminReport.Paginate(pagedRequest.Page, pagedRequest.PageSize.GetValueOrDefault());
            return final;
        }

        public async Task<List<ReportDetailsDto>> GetAllMyReportsofDepartmentAdmin(Guid userId, List<ReportCategoryDto> reportCategories)
        {
            List<ReportInformation> getReports = new();
            List<ReportInformation> roleReports = new();
            List<ReportInformation> userReports = new();
             List<ReportInformation> group_BypassedRpts = new();
            List<ReportInformation> user_BypassedRpts = new();
            List<ReportInformation> myDepartmentReports = new();
            var userDetail = await _dbContext.Users.FirstOrDefaultAsync(i => i.Id == userId);
            var roles = await _roleRepository.RoleNameByUserId(userId);
            var favoritedReports = await _dbContext.UserFavorites.Where(p => p.UserId == userId).ToListAsync();

            List<string> userGroups = await _userRoleRepository.Where(i => i.UserId == userId).Select(p => p.RoleId.ToString()).ToListAsync();
            List<string> userGroupNames = await _userRoleRepository.GetRolesByEmailId(userDetail.EmailAddress);

            //all report of my department

            List<ReportCategories> categories = reportCategories.Select(p => new ReportCategories
            {
                Id = p.Id,
                Name = p.Name,
                Description = p.Description,
                DepartmentAdmin = p.DepartmentAdmin.Select(x => x.Id).ToList()
            }).ToList();
            var departmentAdminDept = categories.Select(c => c.Id).ToList();

            ///all assigned report
            roleReports = await ReportAssignedViaGroup(userId);
            getReports.AddRange(roleReports);
            group_BypassedRpts = await BypassedReportAssignedViaGroup(userId);
            getReports.AddRange(group_BypassedRpts);

            //report assigned via users access
            if (userDetail != null)
            {
                userReports = await ReportAssignedViaUser(userDetail.Id);
                getReports.AddRange(userReports);
                user_BypassedRpts = await BypassedReportAssignedViaUser(userId);
                getReports.AddRange(user_BypassedRpts);
            }

            var uniqueReports = getReports.GroupBy(p => p.Id).Select(g => g.First()).ToList();

            //check if rls report found and its role mapping done.else remove that

            var rlsReports = uniqueReports.Where(i => i.RlsEnabled).ToList();
            if (rlsReports != null && rlsReports.Any())
            {
                var recordstoRemove = new List<ReportInformation>();

                var rlsRolesNotDefined = rlsReports.Where(i => i.RlsRoles == null).ToList();
                if (rlsRolesNotDefined.Any())
                {
                    rlsReports = rlsReports.Except(rlsRolesNotDefined).ToList();
                    uniqueReports = uniqueReports.Except(rlsRolesNotDefined).ToList();
                }

                foreach (var rlseport in rlsReports)
                {
                    var rlsEnabledReports = rlseport.RlsRoles.RoleMappings.Where(x => x.RlsRole != null && x.IsActive).ToList();
                    if(group_BypassedRpts.Any(p=>p.Id==rlseport.Id) || user_BypassedRpts.Any(o=>o.Id==rlseport.Id))
                        {continue;}
                    if (rlsEnabledReports.Any())
                    {
                        var allgroups = rlsEnabledReports.Where(x => x.Groups != null).SelectMany(y => y.Groups).ToList();
                        var allusers = rlsEnabledReports.Where(y => y.Users != null).SelectMany(x => x.Users).ToList();
                        bool hasGroup = allgroups.Intersect(userGroups).Any();
                        bool hasUserId = allusers.Contains(userId.ToString());

                        if (!(hasGroup || hasUserId))
                        {
                            var uniqueReporttoRemove = uniqueReports.FirstOrDefault(x => x.Id == rlseport.Id);
                            recordstoRemove.Add(uniqueReporttoRemove);
                        }
                    }
                }

                if (recordstoRemove.Any())
                {
                    uniqueReports = uniqueReports.Except(recordstoRemove).ToList();
                }
            }

            //add department reports - here 
            myDepartmentReports = await MyDepartmentReports(departmentAdminDept);
            if (uniqueReports.Count > 0)
            {
                //remove those which is added via by group/user and already in department
                myDepartmentReports = myDepartmentReports.Union(uniqueReports.Except(myDepartmentReports, new EqualityComparer())).ToList();
                uniqueReports = myDepartmentReports;
            }
            else
            {
                uniqueReports.AddRange(myDepartmentReports);
            }
            if (favoritedReports.Count > 0 && uniqueReports.Count > 0)
            {
                foreach (var item in uniqueReports)
                {
                    item.Favorite = favoritedReports.Where(p => p.BiReportId == item.Id).ToList().Count > 0 ? true : false;
                }
            }

            var result = uniqueReports.Select(j => new ReportDetailsDto
            {
                Id = j.Id,
                Title = j.Title,
                Description = j.Description,
                CategoryId = j.CategoryId,
                CategoryName = j.CategoryName,
                EnablePagination = j.EnablePagination,
                ReportId = j.ReportId,
                Favorite = j.Favorite,
                RlsEnabled = j.RlsEnabled,
            }).OrderBy(p => p.CategoryName).ToList();


            return result;
        }


        #region Private Methods
        private async Task<List<ReportInformation>> GetAllReports()
        {
            var allReport = await (from report in _dbContext.Reports
                                   join category in _dbContext.ReportCategories on report.ReportCategory equals category.Id
                                   where report.IsActive
                                   select new ReportInformation

                                   {
                                       Id = report.Id,
                                       Title = report.Name,
                                       Description = report.Description,
                                       CategoryId = category.Id,
                                       CategoryName = category.Name,
                                       EnablePagination = report.EnablePagination,
                                       ReportId = report.PowerBiReportId,
                                       RlsEnabled = report.RlsEnabled,
                                       RlsRoles = report.RlsRoles,
                                   }).ToListAsync();
            return allReport;
        }


        private async Task<List<ReportInformation>> ReportAssignedViaGroup(Guid userId)
        {
            var groupAssigned = await (from report in _dbContext.Reports
                                       join roleAccess in _dbContext.ReportRoleAccesses on report.Id equals roleAccess.BiReportId
                                       join userRole in _dbContext.UserGroups on roleAccess.RoleId equals userRole.RoleId
                                       join category in _dbContext.ReportCategories on report.ReportCategory equals category.Id
                                       where userRole.UserId == userId && report.IsActive && roleAccess.IsActive
                                       select new ReportInformation
                                       {
                                           Id = report.Id,
                                           Title = report.Name,
                                           Description = report.Description,
                                           CategoryId = category.Id,
                                           CategoryName = category.Name,
                                           EnablePagination = report.EnablePagination,
                                           ReportId = report.PowerBiReportId,
                                           RlsEnabled = report.RlsEnabled,
                                           RlsRoles = report.RlsRoles,
                                           PowerBiRlsRole = report.RlsEnabled ? GetRlsRolesList(report) : null,
                                           

                                       }).ToListAsync();
            return groupAssigned;
        }
        private async Task<List<ReportInformation>> BypassedReportAssignedViaGroup(Guid userId)
        {
            var groupAssigned = await (from report in _dbContext.Reports
                                       join roleAccess in _dbContext.ReportRoleAccesses on report.Id equals roleAccess.BiReportId
                                       join userRole in _dbContext.UserGroups on roleAccess.RoleId equals userRole.RoleId
                                       join category in _dbContext.ReportCategories on report.ReportCategory equals category.Id
                                       where userRole.UserId == userId && report.IsActive && roleAccess.IsActive
                                       && roleAccess.RLS_Bypassed
                                       select new ReportInformation
                                       {
                                           Id = report.Id,
                                           Title = report.Name,
                                           Description = report.Description,
                                           CategoryId = category.Id,
                                           CategoryName = category.Name,
                                           EnablePagination = report.EnablePagination,
                                           ReportId = report.PowerBiReportId,
                                           RlsEnabled = report.RlsEnabled,
                                           RlsRoles = report.RlsRoles,
                                           PowerBiRlsRole = report.RlsEnabled ? GetRlsRolesList(report) : null,
                                           

                                       }).ToListAsync();
            return groupAssigned;
        }
        private async Task<List<ReportInformation>> ReportAssignedViaUser(Guid userId)
        {
            var userAssigned = await (from report in _dbContext.Reports
                                      join userAccess in _dbContext.ReportUserAccesses on report.Id equals userAccess.BiReportId
                                      join category in _dbContext.ReportCategories on report.ReportCategory equals category.Id
                                      where userAccess.UserId == userId && report.IsActive && userAccess.IsActive
                                      select new ReportInformation
                                      {
                                          Id = report.Id,
                                          Title = report.Name,
                                          Description = report.Description,
                                          CategoryId = category.Id,
                                          CategoryName = category.Name,
                                          EnablePagination = report.EnablePagination,
                                          ReportId = report.PowerBiReportId,
                                          RlsEnabled = report.RlsEnabled,
                                          RlsRoles = report.RlsRoles,
                                          PowerBiRlsRole = report.RlsEnabled ? GetRlsRolesList(report) : null,
                                          
                                      }).ToListAsync();
            return userAssigned;
        }
        private async Task<List<ReportInformation>> BypassedReportAssignedViaUser(Guid userId)
        {
            var userAssigned = await (from report in _dbContext.Reports
                                      join userAccess in _dbContext.ReportUserAccesses on report.Id equals userAccess.BiReportId
                                      join category in _dbContext.ReportCategories on report.ReportCategory equals category.Id
                                      where userAccess.UserId == userId && report.IsActive && userAccess.IsActive
                                      && userAccess.RLS_Bypassed
                                      select new ReportInformation
                                      {
                                          Id = report.Id,
                                          Title = report.Name,
                                          Description = report.Description,
                                          CategoryId = category.Id,
                                          CategoryName = category.Name,
                                          EnablePagination = report.EnablePagination,
                                          ReportId = report.PowerBiReportId,
                                          RlsEnabled = report.RlsEnabled,
                                          RlsRoles = report.RlsRoles,
                                          PowerBiRlsRole = report.RlsEnabled ? GetRlsRolesList(report) : null,
                                          
                                      }).ToListAsync();
            return userAssigned;
        }
        private async Task<List<ReportInformation>> MyDepartmentReports(List<Guid> departmentAdminDept)
        {
            var myDepartmentReports = await (from report in _dbContext.Reports
                                             join category in _dbContext.ReportCategories on report.ReportCategory equals category.Id
                                             select new ReportInformation
                                             {
                                                 Id = report.Id,
                                                 Title = report.Name,
                                                 Description = report.Description,
                                                 CategoryId = CommonUtility.IsNotNull(category) ? category.Id : Guid.Empty,
                                                 CategoryName = CommonUtility.IsNotNull(category) ? category.Name : null,
                                                 EnablePagination = report.EnablePagination,
                                                 ReportId = report.PowerBiReportId,
                                                 RlsEnabled = report.RlsEnabled,
                                                 RlsRoles = report.RlsRoles,
                                                 PowerBiRlsRole = report.RlsEnabled ? GetRlsRolesList(report) : null,
                                                 
                                             }).OrderBy(v => v.Title).ToListAsync();
            var departmentAdminReport = myDepartmentReports.Where(p => departmentAdminDept.Contains(p.CategoryId)).ToList();
            return departmentAdminReport;
        }

        #endregion

    }
}

