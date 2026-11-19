using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using PowerBIPortal.Core.Models.Api;
using PowerBIPortal.Core.Models.Dto;
using PowerBIPortal.Core.Models.Entity;
using PowerBIPortal.Core.Utility;
using PowerBIPortal.Data.DBContexts;
using PowerBIPortal.Data.Extensions;
using PowerBIPortal.Data.Interfaces;
using System.Data;
using System.Linq;

namespace PowerBIPortal.Data.Repositories
{
    public class RoleRepository : BaseRepository<Group>, IGroupRepository
    {
        private readonly PortalDbContext _dbContext;
        private readonly IConfiguration _configuration;


        public RoleRepository(PortalDbContext dbContext, IConfiguration configuration) : base(dbContext)
        {
            _dbContext = dbContext;
            _configuration = configuration;
        }

        public async Task<List<GroupDto>> RoleNameByUserId(Guid userId)
        {
            var result = await (from groups in _dbContext.Group
                                join userRoles in _dbContext.UserGroups on groups.Id equals userRoles.RoleId
                                where userRoles.UserId == userId
                                select new GroupDto
                                {
                                    Id = groups.Id,
                                    Name = groups.Name,
                                }).ToListAsync();
            return result;
        }
        public async Task<PageModel<UserGroupDetailDto>> GetAllGroup(PagedRequest pagedRequest)
        {
            var groupList = await (from grp in _dbContext.Group
                                   join department in _dbContext.ReportCategories on grp.ReportCategory equals department.Id into tempDepartment
                                   from department in tempDepartment.DefaultIfEmpty()
                                   where string.IsNullOrEmpty(pagedRequest.Search) ? true : grp.Name.ToLower().Trim().Contains(pagedRequest.Search.ToLower().Trim())
                                   //&& string.IsNullOrEmpty(pagedRequest.FilterValue) ? true : grp.ReportCategory.ToString().Trim().Equals(pagedRequest.FilterValue.Trim())
                                   select new UserGroupDetailDto
                                   {
                                       Id = grp.Id,
                                       CreatedAt = grp.CreatedAt,
                                       CreatedBy = grp.CreatedBy.Name,
                                       Description = grp.Description,
                                       Name = grp.Name,
                                       UpdatedAt = grp.UpdatedAt,
                                       UpdatedBy = grp.UpdatedBy.Name,
                                       MappedReports = new List<MappedReports>(),
                                       MappedUsers = new List<MappedUser>(),
                                       ReportCategory = CommonUtility.IsNotNull(department) ? department.Id : Guid.Empty,
                                       ReportCategoryName = CommonUtility.IsNotNull(department) ? department.Name : null,
                                   }).OrderBy(p => p.Name).ToListAsync();
            if(!string.IsNullOrEmpty(pagedRequest.FilterValue))
            {
                groupList = groupList.Where(p => p.ReportCategory.ToString() == pagedRequest.FilterValue).ToList();
            }
            foreach (var item in groupList)
            {
                if (item.Name == _configuration.GetValue<string>("SystemAdminRoleName"))
                {
                    item.MappedReports = await GetAllReport();
                }
                else
                {
                    item.MappedReports = await AssignedReport(item.Id);
                }
                item.MappedUsers = await AssignedUsers(item.Id);
            }

            var result = groupList.Paginate(pagedRequest.Page, pagedRequest.PageSize.GetValueOrDefault());
            return result;
        }

        public async Task<List<Group>> GetAllRoles()
        {
            var result = await _dbContext.Group.OrderBy(p => p.Name).ToListAsync();
            return result;
        }

        public async Task<List<MappedReports>> AssignedReport(Guid groupId)
        {
            var items = await (from access in _dbContext.ReportRoleAccesses
                               join rep in _dbContext.Reports on access.BiReportId equals rep.Id
                               where access.RoleId == groupId
                               select new MappedReports
                               {
                                   ReportName = rep.Name,
                                   ReportId = rep.Id,
                                   AssignedRlsRoles = (CommonUtility.IsNotNull(rep) && rep.RlsEnabled) ? SelectRlsRole(rep.RlsRoles, groupId) : null
                               }).OrderBy(p => p.ReportName).ToListAsync();
            return items;
        }

        public async Task<List<MappedUser>> AssignedUsers(Guid groupId)
        {
            var items = await (from usrGrp in _dbContext.UserGroups
                               join usr in _dbContext.Users on usrGrp.UserId equals usr.Id
                               where usrGrp.RoleId == groupId
                               select new MappedUser
                               {
                                   UserName = usr.Name,
                                   UserId = usr.Id,
                                   UserEmail = usr.EmailAddress
                               }).OrderBy(p => p.UserName).ToListAsync();
            return items;
        }

        public static List<string> SelectRlsRole(RlsRoles rols, Guid id)
        {
            List<string> roles = new();
            roles = rols?.RoleMappings.Where(i => i.IsActive && (i.Groups != null && i.Groups.Count > 0) && i.Groups.Contains(id.ToString())).Select(r => r.RlsRole).ToList();
            return roles;
        }

        public async Task<List<MappedReports>> GetAllReport()
        {
            var data = await (from rp in _dbContext.Reports
                              select new MappedReports
                              {
                                  ReportId = rp.Id,
                                  ReportName = rp.Name,
                              }).OrderBy(p => p.ReportName).ToListAsync();
            return data;
        }

        public async Task<PageModel<UserGroupDetailDto>> GetAllGroupByDepartment(PagedRequest pagedRequest, List<ReportCategories> reportCategories)
        {
            var reportCategoryIds = reportCategories.Select(p => p.Id).ToList();
            var groupList = await (from grp in _dbContext.Group
                                   join department in _dbContext.ReportCategories on grp.ReportCategory equals department.Id
                                   where string.IsNullOrEmpty(pagedRequest.Search) ? true : grp.Name.ToLower().Trim().Contains(pagedRequest.Search.ToLower().Trim())
                                   select new UserGroupDetailDto
                                   {
                                       Id = grp.Id,
                                       CreatedAt = grp.CreatedAt,
                                       CreatedBy = grp.CreatedBy.Name,
                                       Description = grp.Description,
                                       Name = grp.Name,
                                       UpdatedAt = grp.UpdatedAt,
                                       UpdatedBy = grp.UpdatedBy.Name,
                                       MappedReports = new List<MappedReports>(),
                                       MappedUsers = new List<MappedUser>(),
                                       ReportCategory = department.Id,
                                       ReportCategoryName = department.Name,
                                   }).OrderBy(p => p.Name).ToListAsync();
            var departmentWise = groupList.Where(p => reportCategoryIds.Contains(p.ReportCategory)).Select(x => new UserGroupDetailDto
            {
                Id = x.Id,
                CreatedAt = x.CreatedAt,
                CreatedBy = x.CreatedBy,
                Description = x.Description,
                Name = x.Name,
                UpdatedAt = x.UpdatedAt,
                UpdatedBy = x.UpdatedBy,
                ReportCategory = x.ReportCategory,
                ReportCategoryName = x.ReportCategoryName,
            }).ToList();

            if (!string.IsNullOrEmpty(pagedRequest.FilterValue))
            {
                departmentWise = departmentWise.Where(p => p.ReportCategory.ToString() == pagedRequest.FilterValue).ToList();
            }

            foreach (var item in departmentWise)
            {
                if (item.Name == _configuration.GetValue<string>("SystemAdminRoleName"))
                {
                    item.MappedReports = await GetAllReport();
                }
                else
                {
                    item.MappedReports = await AssignedReport(item.Id);
                }
                item.MappedUsers = await AssignedUsers(item.Id);
            }

            var result = departmentWise.Paginate(pagedRequest.Page, pagedRequest.PageSize.GetValueOrDefault());
            return result;
        }

        public async Task<List<Group>> GetAllRolesofDepartmentAdmin(List<ReportCategories> reportCategories)
        {
            var reportCategoryIds = reportCategories.Select(p => p.Id).ToList();

            var allgroup = (await _dbContext.Group
                                  .Where(p => reportCategoryIds.Contains(p.ReportCategory))
                                  .ToListAsync()).Select(y => new Group { Id = y.Id, Name = y.Name }).OrderBy(x => x.Name).ToList();
            return allgroup;
        }
    }

}
