using AutoMapper;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using PowerBIPortal.Core.Constants;
using PowerBIPortal.Core.Exceptions;
using PowerBIPortal.Core.Models.Api;
using PowerBIPortal.Core.Models.Dto;
using PowerBIPortal.Core.Models.Entity;
using PowerBIPortal.Core.User;
using PowerBIPortal.Core.Utility;
using PowerBIPortal.Data.Interfaces;
using PowerBIPortal.Services.Interfaces;
using System.DirectoryServices.AccountManagement;

namespace PowerBIPortal.Services.Services
{
    public class UserService : IUserService
    {
        private readonly IUsersRepository _usersRepository;
        private readonly IMapper _mapper;
        private readonly IUserRolesRepository _userGroupRepository;
        private readonly IApplicationUser _applicationUser;
        private readonly IConfiguration _configuration;
        private readonly IGroupRepository _groupRepository;
        private readonly IEmailInvitationService _emailInvitationService;

        public UserService(IUsersRepository usersRepository, IMapper mapper, IUserRolesRepository userGroupRepository,
            IApplicationUser applicationUser, IConfiguration configuration, IGroupRepository groupRepository, IEmailInvitationService emailInvitationService)
        {
            _usersRepository = usersRepository;
            _mapper = mapper;
            _userGroupRepository = userGroupRepository;
            _applicationUser = applicationUser;
            _configuration = configuration;
            _groupRepository = groupRepository;
            _emailInvitationService = emailInvitationService;
        }
        public async Task<PageModel<UserDetailDto>> AddNewUser(UserCreateRequest user)
        {
            PagedRequest pagedRequest = new PagedRequest
            {
                Page = 1,
                PageSize = 20,
            };

            using (var transaction = await _usersRepository.BeginTransactionAsync())
            {
                try
                {
                    if (user != null && await CheckUserExist(user.EmailAddress, user.Id))
                    {
                        throw new AppException(ValidationMessages.UserExist);
                    }
                    Users newUsers = _mapper.Map<Users>(user);
                    if (newUsers.Id == Guid.Empty)
                    {
                        newUsers.Id = Guid.NewGuid();
                    }
                    var userData = await _usersRepository.SaveAsync(newUsers);
                    if (user?.Group != null && user.Group.Count > 0)
                    {

                        var groupData = user.Group.Select(p => new UserGroups
                        {
                            UserId = userData.Id,
                            RoleId = p
                        }).ToList();

                        await _userGroupRepository.SaveAllAsync(groupData);
                    }
                    await transaction.CommitAsync();
                }
                catch (Exception)
                {
                    await SafeRollback(transaction);
                    throw;
                }
            }

            if (user?.SendMail == true)
            {
                try
                {
                    await _emailInvitationService.BuildEmailInvitation(new SendEmailDto
                    {
                        UserName = CommonUtility.CapitalizeLetter(user.Name),
                        ToEmailIds = new List<string> { user.EmailAddress }
                    });
                }
                catch
                {
                    // The account is already stored. A mail failure must not undo the save
                    // or roll back a transaction that has already completed.
                }
            }
            return await _usersRepository.GetAllUers(pagedRequest);
        }

        public async Task<PageModel<UserDetailDto>> GetAllUers(PagedRequest pagedRequest)
        {
            return await _usersRepository.GetAllUers(pagedRequest);
        }

        public async Task<PageModel<UserDetailDto>> UpdateUser(UserCreateRequest user)
        {
            PagedRequest pagedRequest = new PagedRequest
            {
                Page = 1,
                PageSize = 20,
            };

            using (var transaction = await _usersRepository.BeginTransactionAsync())
            {
                try
                {
                    if (user != null && await CheckUserExist(user.EmailAddress, user.Id))
                    {
                        throw new AppException(ValidationMessages.UserExist);
                    }
                    var existingUser = await _usersRepository.FindByIdAsync(user.Id);
                    existingUser.Name = user.Name;
                    existingUser.EmailAddress = user.EmailAddress;

                    await _usersRepository.UpdateAsync(existingUser);

                    var previousData = await _userGroupRepository.Where(i => i.UserId == user.Id).ToListAsync();
                    var selectedItem = user.Group;

                    //need to be delete
                    var itemDelete = previousData.Where(x => !selectedItem.Contains(x.RoleId));
                    var DeleteRoleNames = _groupRepository.Where(i => itemDelete.Select(p => p.RoleId).ToList().Contains(i.Id)).Select(x => x.Name).ToList();
                    if (_applicationUser.Email.Equals(existingUser.EmailAddress.ToLower()) && DeleteRoleNames.Contains(_configuration.GetValue<string>("SystemAdminRoleName")))
                    {
                        throw new AppException(ValidationMessages.DoNotRemoveAdminPrivilage);
                    }
                    await _userGroupRepository.DeleteRangeAsync(itemDelete);

                    //need to be add
                    var items = previousData.Select(m => m.RoleId).ToList();
                    selectedItem.RemoveAll(x => items.Contains(x));

                    if (selectedItem.Count > 0)
                    {
                        var groupData = selectedItem.Select(p => new UserGroups
                        {
                            UserId = user.Id,
                            RoleId = p
                        }).ToList();

                        await _userGroupRepository.SaveAllAsync(groupData);
                    }
                    await transaction.CommitAsync();
                }
                catch (Exception)
                {
                    await SafeRollback(transaction);
                    throw;
                }
            }
            return await _usersRepository.GetAllUers(pagedRequest);
        }

        public async Task<UserDetailDto> UserDetailById(Guid userId)
        {
            return await _usersRepository.UserDetailById(userId);
        }

        public async Task DeleteUser(Guid userId)
        {
            var existUser = await _usersRepository.FindByIdAsync(userId);
            if (existUser == null)
            {
                throw new AppException(ValidationMessages.UserNotFound);
            }
            await _usersRepository.DeleteByIdAsync(userId);
        }

        private static async Task SafeRollback(Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction transaction)
        {
            try
            {
                await transaction.RollbackAsync();
            }
            catch
            {
                // Already committed or rolled back. Preserve the original exception.
            }
        }

        private async Task<bool> CheckUserExist(string email, Guid userId)
        {
            var existingUser = await _usersRepository.Where(i => i.EmailAddress == email.Trim().ToLower() && i.Id != userId).FirstOrDefaultAsync();
            return existingUser != null;
        }
        public async Task<Users> UserDetailByEmail()
        {
            var user = await _usersRepository.Where(u => u.EmailAddress.Trim().ToLower() == _applicationUser.Email.Trim().ToLower()).FirstOrDefaultAsync();
            if (user == null)
            {
                throw new UnauthorizedAccessException();
            }
            return user;
        }
    }
}
