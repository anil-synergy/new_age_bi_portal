using PowerBIPortal.Core.Models.Api;
using PowerBIPortal.Core.Models.Dto;
using PowerBIPortal.Core.Models.Entity;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Services.Interfaces
{
    public interface IUserService
    {
        Task<PageModel<UserDetailDto>> AddNewUser(UserCreateRequest user);
        Task<PageModel<UserDetailDto>> UpdateUser(UserCreateRequest user);
        Task<UserDetailDto> UserDetailById(Guid userId);
        Task<PageModel<UserDetailDto>> GetAllUers(PagedRequest pagedRequest);
        Task DeleteUser(Guid userId);
        Task<Users> UserDetailByEmail();
    }
}
