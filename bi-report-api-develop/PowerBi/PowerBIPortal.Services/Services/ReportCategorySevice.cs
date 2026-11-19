using AutoMapper;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using PowerBIPortal.Core.Constants;
using PowerBIPortal.Core.Exceptions;
using PowerBIPortal.Core.Models.Api;
using PowerBIPortal.Core.Models.Dto;
using PowerBIPortal.Core.Models.Entity;
using PowerBIPortal.Core.User;
using PowerBIPortal.Data.Interfaces;
using PowerBIPortal.Data.Repositories;
using PowerBIPortal.Services.Interfaces;
using System.Collections.Generic;

namespace PowerBIPortal.Services.Services
{
    public class ReportCategorySevice : IReportCategorySevice
    {
        private readonly IReportCategoriesRepository _reportCategoriesRepository;
        private readonly IMapper _mapper;
        private readonly IApplicationUser _applicationUser;
        private readonly IUserService _userService;
        private readonly IConfiguration _configuration;
        private readonly IUserGroupService _userGroupService;

        public ReportCategorySevice(IReportCategoriesRepository reportCategoriesRepository, IMapper mapper, IApplicationUser applicationUser,
            IUserService userService, IConfiguration configuration, IUserGroupService userGroupService)
        {
            _reportCategoriesRepository = reportCategoriesRepository;
            _mapper = mapper;
            _applicationUser = applicationUser;
            _userService = userService;
            _configuration = configuration;
            _userGroupService = userGroupService;
        }
        public async Task<PageModel<ReportCategoryDto>> AddUpdateCategory(ReportCategoryDto request)
        {
            PagedRequest pagedRequest = new PagedRequest();
            using (var transaction = await _reportCategoriesRepository.BeginTransactionAsync())
            {
                try
                {
                    var adminIds = request.DepartmentAdmin?
                        .Where(admin => admin != null && admin.Id != Guid.Empty)
                        .Select(admin => admin.Id)
                        .ToList();
                    var departmentAdmin = adminIds != null && adminIds.Count > 0 ? adminIds : null;
                    if (request.Id != Guid.Empty)
                    {
                        ReportCategories existingCategory = await _reportCategoriesRepository.FindByIdAsync(request.Id);
                        if (existingCategory == null)
                        {
                            throw new AppException(ValidationMessages.CategoryNotFound);
                        }
                        existingCategory.Name = request.Name;
                        existingCategory.Description = request.Description;
                        existingCategory.DepartmentAdmin = departmentAdmin;
                        await _reportCategoriesRepository.UpdateAsync(existingCategory);
                    }
                    else
                    {
                        ReportCategories reportCategory = new()
                        {
                            Id = Guid.NewGuid(),
                            Name = request.Name,
                            Description = request.Description,
                            DepartmentAdmin = departmentAdmin
                        };
                        await _reportCategoriesRepository.SaveAsync(reportCategory);
                    }
                    await transaction.CommitAsync();
                }
                catch (Exception)
                {
                    try
                    {
                        await transaction.RollbackAsync();
                    }
                    catch
                    {
                        // Keep the original save error when the transaction is already finished.
                    }
                    throw;
                }
            }
            pagedRequest.PageSize = 20;
            pagedRequest.Page = 1;
            return await GetAllCategory(pagedRequest);
        }

        public async Task<List<ReportCategoryDto>> GetAllCategories()
        {
            var userInfo = await _userService.UserDetailByEmail();
            var departments = await GetDepartmentofUser(userInfo.Id);
            var adminName = _configuration.GetValue<string>("SystemAdminRoleName");
            var roles = await _userGroupService.GetRolesByEmailId(userInfo.EmailAddress);
            if (departments.Any() && !roles.Contains(adminName))
            {
                return departments.OrderBy(p => p.Name).ToList();
            }
            else
            {
                return await _reportCategoriesRepository.GetAllCategories();
            }
        }

        public async Task<PageModel<ReportCategoryDto>> GetAllCategory(PagedRequest pagedRequest)
        {
            var userInfo = await _userService.UserDetailByEmail();
            var departments = await GetDepartmentofUser(userInfo.Id);
            var adminName = _configuration.GetValue<string>("SystemAdminRoleName");
            var roles = await _userGroupService.GetRolesByEmailId(userInfo.EmailAddress);
            if (departments.Any() && !roles.Contains(adminName))
            {
                return await _reportCategoriesRepository.GetAllCategoryofDepartmentAdmin(pagedRequest, departments);

            }
            else
            {
                return await _reportCategoriesRepository.GetAllCategory(pagedRequest);
            }
        }

        public async Task DeleteCategory(Guid categoryId)
        {
            var existingData = await _reportCategoriesRepository.FindByIdAsync(categoryId);
            if (existingData == null)
            {
                throw new AppException(ValidationMessages.CategoryNotFound);
            }
            await _reportCategoriesRepository.DeleteByIdAsync(categoryId);
        }

        public async Task<List<ReportCategoryDto>> GetDepartmentofUser(Guid userId)
        {
            List<ReportCategoryDto> reportCategoryDtos = new();

            var filteredData = await _reportCategoriesRepository.GetDepartmentofUser(userId);

            reportCategoryDtos = filteredData.Select(x => new ReportCategoryDto
            {
                Id = x.Id,
                Name = x.Name,
                Description = x.Description,
                DepartmentAdmin = x.DepartmentAdmin.Select(y => new DepartmentAdmin
                {
                    Id = y,
                }).ToList()
            }).ToList();

            return reportCategoryDtos;
        }
    }
}
