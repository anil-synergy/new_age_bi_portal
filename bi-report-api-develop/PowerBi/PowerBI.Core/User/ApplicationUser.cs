using Microsoft.AspNetCore.Http;
using System.Security.Claims;

namespace PowerBIPortal.Core.User
{
    public class ApplicationUser : IApplicationUser
    {

        private readonly IHttpContextAccessor _httpContextAccessor;

        public ApplicationUser(IHttpContextAccessor httpContextAccessor)
        {

            this._httpContextAccessor = httpContextAccessor;
        }
        public string Name => this.GetUserName();

        public Guid Id => this.GetUserId();

        public string Email => this.GetUserEmail();
        public string Issuer => this.GetIssuer();
        public List<string> Roles => new List<string>();

        private string GetIssuer()
        {
            var claim = _httpContextAccessor.HttpContext?
.User.Claims.FirstOrDefault(claim => claim.Type == SynergyClaimTypes.Issuer);

            var val = _httpContextAccessor.HttpContext?
    .User.Claims.FirstOrDefault(claim => claim.Type == AdClaimTypes.Issuer);

            return claim == null ? "" : claim.Value;

        }

        private string GetUserEmail()
        {
            var claim = _httpContextAccessor.HttpContext?
        .User.Claims.FirstOrDefault(claim => claim.Type == SynergyClaimTypes.UserEmail);

            claim ??= _httpContextAccessor.HttpContext?
        .User.Claims.FirstOrDefault(claim => claim.Type == AdClaimTypes.UniqueName);
            claim ??= _httpContextAccessor.HttpContext?
        .User.Claims.FirstOrDefault(claim => claim.Type == AdClaimTypes.PrefredName);
            return claim == null ? "" : claim.Value.ToLower().Trim();


        }

        public string Token => _httpContextAccessor.HttpContext?.Request.Headers["Authorization"].ToString().Replace("bearer ", "").Replace("Bearer ", "");

        private Guid GetUserId()
        {
            var claim = _httpContextAccessor.HttpContext?
                            .User.Claims.FirstOrDefault(claim => claim.Type == SynergyClaimTypes.UserId);
            claim ??= _httpContextAccessor.HttpContext?
                .User.Claims.FirstOrDefault(claim => claim.Type == AdClaimTypes.UserId);
            return claim == null ? Guid.Empty : new Guid(claim.Value);
        }
        private string GetUserName()
        {
            var FirstNameClaim = _httpContextAccessor.HttpContext?
                             .User.Claims.FirstOrDefault(claim => claim.Type == SynergyClaimTypes.FirstName);
            var LastNameClaim = _httpContextAccessor.HttpContext?
                             .User.Claims.FirstOrDefault(claim => claim.Type == SynergyClaimTypes.LastName);
            return (FirstNameClaim == null ? "" : FirstNameClaim.Value) + " " + (LastNameClaim == null ? "" : LastNameClaim.Value);

        }
        private List<string> GetRoles()
        {
            var roles = _httpContextAccessor.HttpContext?
                           .User.Claims.Where(c => c.Type == ClaimTypes.Role)
                           .Select(c => c.Value).ToList();
            if(roles.Count == 0)
            {
                roles = _httpContextAccessor.HttpContext?
                    .User.Claims.Where(claim => claim.Type == AdClaimTypes.UserRole)
                    .Select(c => c.Value).ToList();
            }


            
            return roles;
        }
    }
    public static class SynergyClaimTypes
    {
        public const string UserId = "user_id";
        public const string UserRole = ClaimTypes.Role;
        public const string UserEmail = ClaimTypes.Email;
        public const string FirstName = "first_name";
        public const string LastName = "last_name";
        public const string Issuer = "iss";
    }
    public static class AdClaimTypes
    {
        public const string UserId = "http://schemas.microsoft.com/identity/claims/objectidentifier";
        public const string UserEmail = ClaimTypes.Email;
        public const string Issuer = "iss";
        public const string UniqueName = ClaimTypes.Name;
        public const string PrefredName = "preferred_username";
        public const string UserRole = ClaimTypes.Role;


    }
}
