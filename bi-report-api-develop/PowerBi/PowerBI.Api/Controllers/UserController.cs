using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using PowerBIPortal.Api.Constants;
using PowerBIPortal.Core.Models.Dto;
using PowerBIPortal.Services.Interfaces;
using System.Net;

namespace PowerBIPortal.Api.Controllers
{
    [Route("/bi-report-api/v1/user")]
    [ApiController]
    [Authorize(AuthenticationSchemes = AuthenticationSchema.ShoreAndSeafarer)]
    public class UserController : ControllerBase
    {

        private readonly IAdminService _adminService;
        public UserController(IAdminService adminService)
        {
            _adminService = adminService;
        }
        [HttpGet]
        [Route("userInfo")]
        public async Task<UserInformationDto> GetUserInformation()
        {
            return await _adminService.GetUserInformation();
        }
    }
}
