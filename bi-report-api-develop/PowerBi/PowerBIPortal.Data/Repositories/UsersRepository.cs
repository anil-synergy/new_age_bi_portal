using Microsoft.EntityFrameworkCore;
using PowerBIPortal.Core.Models.Api;
using PowerBIPortal.Core.Models.Dto;
using PowerBIPortal.Core.Models.Entity;
using PowerBIPortal.Core.Utility;
using PowerBIPortal.Data.DBContexts;
using PowerBIPortal.Data.Extensions;
using PowerBIPortal.Data.Interfaces;
using System.Data;
using System.Security.Cryptography;

namespace PowerBIPortal.Data.Repositories
{
    public class UsersRepository : BaseRepository<Users>, IUsersRepository
    {
        private readonly PortalDbContext _dbContext;
        public UsersRepository(PortalDbContext dbContext) : base(dbContext)
        {
            _dbContext = dbContext;
        }

        public async Task<PageModel<UserDetailDto>> GetAllUers(PagedRequest pagedRequest)
        {
            var users = new List<UserDetailDto>();
            var tempList = new List<UsersReports>();

            var roleMappedUsers = await (from user in _dbContext.Users
                                         join userRole in _dbContext.UserGroups on user.Id equals userRole.UserId
                                         join role in _dbContext.Group on userRole.RoleId equals role.Id
                                         join roleAccess in _dbContext.ReportRoleAccesses on userRole.RoleId equals roleAccess.RoleId into TempGorup
                                         from groupAccess in TempGorup.DefaultIfEmpty()
                                         join report in _dbContext.Reports on groupAccess.BiReportId equals report.Id into tempReport
                                         from rep in tempReport.DefaultIfEmpty()
                                         where string.IsNullOrEmpty(pagedRequest.Search) ? true : (user.Name.ToLower().Trim().Contains(pagedRequest.Search.ToLower().Trim()) || user.EmailAddress.ToLower().Trim().Contains(pagedRequest.Search.ToLower().Trim()))
                                         select new UsersReports
                                         {
                                             Id = user.Id,
                                             Name = user.Name,
                                             Email = user.EmailAddress,
                                             GroupName = role.Name,
                                             GroupId = role.Id,
                                             AssignedRlsRoles = CommonUtility.IsNotNull(rep) ? SelectRlsRole(rep.RlsRoles, role.Id, false) : new List<string>()
                                         }).ToListAsync();
            tempList.AddRange(roleMappedUsers);

            var directUsers = await (
                                from user in _dbContext.Users
                                join userAccess in _dbContext.ReportUserAccesses on user.Id equals userAccess.UserId into tempUserAccess
                                from access in tempUserAccess.DefaultIfEmpty()
                                join report in _dbContext.Reports on access.BiReportId equals report.Id into tempReport
                                from rep in tempReport.DefaultIfEmpty()
                                where string.IsNullOrEmpty(pagedRequest.Search) ? true : (user.Name.ToLower().Trim().Contains(pagedRequest.Search.ToLower().Trim()) ||
                                user.EmailAddress.ToLower().Trim().Contains(pagedRequest.Search.ToLower().Trim()))
                                select new UsersReports
                                {
                                    Id = user.Id,
                                    Name = user.Name,
                                    Email = user.EmailAddress,
                                    ReportName = CommonUtility.IsNotNull(rep) ? rep.Name : null,
                                    ReportId = CommonUtility.IsNotNull(rep) ? rep.Id : Guid.Empty,
                                    AssignedRlsRoles = CommonUtility.IsNotNull(rep) ? SelectRlsRole(rep.RlsRoles, user.Id, true) : new List<string>()
                                }
                               ).ToListAsync();

            tempList.AddRange(directUsers);


            users = tempList.GroupBy(i => i.Id).Select(p => new UserDetailDto
            {
                Id = p.Select(k => k.Id).FirstOrDefault(),
                Name = p.Select(k => k.Name).FirstOrDefault(),
                Email = p.Select(k => k.Email).FirstOrDefault(),
                Group = p.GroupBy(j => j.GroupId).Where(k => k.Key != Guid.Empty).Select(k => new GroupDto
                {
                    Id = k.Select(q => q.GroupId).FirstOrDefault(),
                    Name = k.Select(q => q.GroupName).FirstOrDefault(),
                    RlsRoleAssigned = k.Where(x => x.AssignedRlsRoles != null).SelectMany(q => q.AssignedRlsRoles).ToList()
                }).ToList(),
                Reports = p.GroupBy(j => j.ReportId).Where(k => k.Key != Guid.Empty).Select(k => new ReportDto
                {
                    Id = k.Select(q => q.ReportId).FirstOrDefault(),
                    Name = k.Select(q => q.ReportName).FirstOrDefault(),
                    RlsRoleAssigned = k.Where(x => x.AssignedRlsRoles != null).SelectMany(q => q.AssignedRlsRoles).ToList()
                }).ToList()

            }).OrderBy(v => v.Name).ToList();

            var final = users.Paginate(pagedRequest.Page, pagedRequest.PageSize.GetValueOrDefault());

            return final;
        }

        public async Task<UserInformationDto> GetUserInformation(Guid userId)
        {
            var roleMappedUsers = await (from user in _dbContext.Users
                                         join userRole in _dbContext.UserGroups on user.Id equals userRole.UserId into tempUserRole
                                         from userRole in tempUserRole.DefaultIfEmpty()
                                         join role in _dbContext.Group on userRole.RoleId equals role.Id into tempRole
                                         from role in tempRole.DefaultIfEmpty()
                                         where user.Id == userId
                                         select new UsersReports
                                         {
                                             Id = user.Id,
                                             Name = user.Name,
                                             Email = user.EmailAddress,
                                             GroupName = CommonUtility.IsNotNull(role) ? role.Name : null,
                                             GroupId = CommonUtility.IsNotNull(role) ? role.Id : Guid.Empty
                                         }).ToListAsync();

            var result = roleMappedUsers.GroupBy(i => i.Id).Select(p => new UserInformationDto
            {
                Id = p.Select(k => k.Id).FirstOrDefault(),
                Name = p.Select(k => k.Name).FirstOrDefault(),
                Email = p.Select(k => k.Email).FirstOrDefault(),
                Group = p.GroupBy(j => j.GroupId).Where(k => k.Key != Guid.Empty).Select(k => new GroupDto
                {
                    Id = k.Select(q => q.GroupId).FirstOrDefault(),
                    Name = k.Select(q => q.GroupName).FirstOrDefault(),
                }).ToList()

            }).FirstOrDefault();
            return result;
        }

        public async Task<List<UserInformationDto>> GetUserEmailAddress()
        {
            var email = await _dbContext.Users.Select(p => new UserInformationDto
            {
                Id = p.Id,
                Name = p.Name,
                Email = p.EmailAddress
            }).OrderBy(j => j.Name).ToListAsync();
            return email;
        }

        public static List<string> SelectRlsRole(RlsRoles rols, Guid id, bool isUser)
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

        public async Task<UserDetailDto> UserDetailById(Guid userId)
        {
            var data = await (from usr in _dbContext.Users
                              join usrGrp in _dbContext.UserGroups on usr.Id equals usrGrp.UserId into tempuserGroups
                              from usrGrp in tempuserGroups.DefaultIfEmpty()
                              join grp in _dbContext.Group on usrGrp.RoleId equals grp.Id into tempGroups
                              from grp in tempGroups.DefaultIfEmpty()
                              where usr.Id == userId
                              select new
                              {
                                  Name = usr.Name,
                                  Id = usr.Id,
                                  Email = usr.EmailAddress,
                                  CreatedAt = usr.CreatedAt,
                                  CreatedBy = usr.CreatedBy.Name,
                                  UpdatedAt = usr.UpdatedAt,
                                  UpdatedBy = usr.UpdatedBy.Name,
                                  GroupId = CommonUtility.IsNotNull(grp) ? grp.Id : Guid.Empty,
                                  GroupName = CommonUtility.IsNotNull(grp) ? grp.Name : null,
                              }
                              ).ToListAsync();

            var result = data.GroupBy(p => p.Id).Select(m => new UserDetailDto
            {
                Id = m.Select(k => k.Id).FirstOrDefault(),
                Name = m.Select(k => k.Name).FirstOrDefault(),
                Email = m.Select(k => k.Email).FirstOrDefault(),
                CreatedAt = m.Select(k => k.CreatedAt).FirstOrDefault(),
                CreatedBy = m.Select(k => k.CreatedBy).FirstOrDefault(),
                UpdatedAt = m.Select(k => k.UpdatedAt).FirstOrDefault(),
                UpdatedBy = m.Select(k => k.UpdatedBy).FirstOrDefault(),
                Group = m.Where(p => p.GroupId != Guid.Empty).Select(k => new GroupDto
                {
                    Id = k.GroupId,
                    Name = k.GroupName
                }).ToList()
            }).FirstOrDefault();

            return result;
        }
    }
}
