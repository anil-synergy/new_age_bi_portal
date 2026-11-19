using Microsoft.AspNetCore.Mvc.Filters;
using PowerBIPortal.Core.Enums;
using PowerBIPortal.Core.Models.Api;
using PowerBIPortal.Core.User;
using PowerBIPortal.Services.Interfaces;
using System.Net.Mime;
using System.Net;
using PowerBIPortal.Core.Extensions;
using PowerBIPortal.Core.Constants;

namespace PowerBIPortal.Api.Filters
{
    public class AdminCustomAuthorizationFilter : IAsyncActionFilter
    {
        private readonly IUserGroupService _userGroupService;
        private readonly IApplicationUser _applicationUser;
        private readonly IConfiguration _configuration;
        private readonly IUserService _userService;
        private readonly IReportCategorySevice _reportCategorySevice;
        public AdminCustomAuthorizationFilter(IUserGroupService userGroupService, IApplicationUser applicationUser,
            IConfiguration configuration, IUserService userService, IReportCategorySevice reportCategorySevice)
        {
            _applicationUser = applicationUser;
            _userGroupService = userGroupService;
            _configuration = configuration;
            _userService = userService;
            _reportCategorySevice = reportCategorySevice;
        }
        public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
        {
            var userInfo = await _userService.UserDetailByEmail();
            var admin = await _userGroupService.GetRolesByEmailId(_applicationUser.Email);
            var checkDepartment = await _reportCategorySevice.GetDepartmentofUser(userInfo.Id);
            if ((admin != null && admin.Contains(_configuration.GetValue<string>("SystemAdminRoleName"))) || checkDepartment.Any())
            {
                await next();
            }
            else
            {
                context.HttpContext.Response.StatusCode = (int)HttpStatusCode.Forbidden;
                context.HttpContext.Response.ContentType = MediaTypeNames.Application.Json;
                var errorModel = new ErrorModel
                {
                    ResponseCode = Enum.GetName(typeof(ResponseCode), 403),
                    Message = "Forbidden",
                    Errors = new List<string> { "user does not have permission" }
                };
                await context.HttpContext.Response.WriteAsync(errorModel.Serializer());
            }
        }
    }
}
