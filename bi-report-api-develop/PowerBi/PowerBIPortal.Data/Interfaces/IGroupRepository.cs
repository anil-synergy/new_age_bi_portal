using PowerBIPortal.Core.Models.Api;
using PowerBIPortal.Core.Models.Dto;
using PowerBIPortal.Core.Models.Entity;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Data.Interfaces
{
    public interface IGroupRepository : IBaseRepository<Group>
    {
        Task<List<GroupDto>> RoleNameByUserId(Guid userId);
        Task<PageModel<UserGroupDetailDto>> GetAllGroup(PagedRequest pagedRequest);
        Task<List<Group>> GetAllRoles();
        Task<PageModel<UserGroupDetailDto>> GetAllGroupByDepartment(PagedRequest pagedRequest, List<ReportCategories> reportCategories);
        Task<List<Group>> GetAllRolesofDepartmentAdmin(List<ReportCategories> reportCategories);

    }
}
