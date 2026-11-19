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
    public interface IUsersRepository : IBaseRepository<Users>
    {
        Task<PageModel<UserDetailDto>> GetAllUers(PagedRequest pagedRequest);
        Task<UserInformationDto> GetUserInformation(Guid userId);
        Task<List<UserInformationDto>> GetUserEmailAddress();
        Task<UserDetailDto> UserDetailById(Guid userId);
    }
}
