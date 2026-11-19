using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.Identity.Web;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using PowerBIPortal.Api.Configurations;
using PowerBIPortal.Api.Constants;
using PowerBIPortal.Api.Filters;
using PowerBIPortal.Core.User;
using PowerBIPortal.Data.DBContexts;
using PowerBIPortal.Data.Interfaces;
using PowerBIPortal.Data.Repositories;
using PowerBIPortal.Services.EmailInvitation;
using PowerBIPortal.Services.Interfaces;
using PowerBIPortal.Services.Services;
using Email = Synergy.Core.EmailService;

namespace PowerBIPortal.Api.Helpers.StartupHelper
{
    public static class StartupHelper
    {
        public static void ConfigureAuthentication(this IServiceCollection services, IConfiguration configuration)
        {
            //IdentityModelEventSource.ShowPII = true;
            var authConfiguration = configuration.GetSection(nameof(AuthConfiguration)).Get<AuthConfiguration>();
            //var AdauthConfiguration = configuration.GetSection(nameof(AzureAd)).Get<AzureAd>();
            services.AddAuthentication(AuthenticationSchema.AzureAD)
         //.AddJwtBearer(AuthenticationSchema.Seafarer, options =>
         //{
         //    options.Authority = authConfiguration.AuthoritySeafarer;
         //    options.RequireHttpsMetadata = authConfiguration.RequireHttps;
         //    options.TokenValidationParameters = new TokenValidationParameters
         //    {
         //        ValidateAudience = false
         //    };
         //})
         //.AddJwtBearer(AuthenticationSchema.Shore, options =>
         //{
         //    options.Authority = authConfiguration.AuthorityShore;
         //    options.RequireHttpsMetadata = authConfiguration.RequireHttps;
         //    options.TokenValidationParameters = new TokenValidationParameters
         //    {
         //        ValidateAudience = false
         //    };
         //})
         .AddMicrosoftIdentityWebApi(configuration.GetSection("AzureAd"), AuthenticationSchema.AzureAD);

            services.PostConfigure<JwtBearerOptions>(AuthenticationSchema.AzureAD, options =>
            {
                var clientId = configuration["AzureAd:ClientId"];
                if (!string.IsNullOrWhiteSpace(clientId))
                {
                    options.TokenValidationParameters.ValidAudiences = new[]
                    {
                        clientId,
                        $"api://{clientId}"
                    };
                }
            });
        }
        public static void ConfigureSwagger(this IServiceCollection services)
        {
            services.AddSwaggerGen();
            services.AddSwaggerGen(options =>
            {
                options.SwaggerDoc("v1", new OpenApiInfo { Title = "PowerBI Portal API", Version = "v1" });
                options.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
                {
                    Name = "Authorization",
                    Type = SecuritySchemeType.ApiKey,
                    In = ParameterLocation.Header,
                    Description = "Authorization header using the Bearer scheme."
                });
                options.AddSecurityRequirement(new OpenApiSecurityRequirement
                {
                    {
                          new OpenApiSecurityScheme
                            {
                                Reference = new OpenApiReference
                                {
                                    Type = ReferenceType.SecurityScheme,
                                    Id = "Bearer"
                                }
                            },
                            Array.Empty<string>()
                    }
                });
            });

        }
        public static void ConfigureDependencies(this IServiceCollection services, ConfigurationManager configuration)
        {
            services.AddSingleton<IHttpContextAccessor, HttpContextAccessor>();

            #region Sevices
            services.AddTransient<IReportService, ReportService>();
            services.AddTransient<IApplicationUser, ApplicationUser>();
            services.AddScoped<ITokenService, TokenService>();
            services.AddTransient<IAdminService, AdminService>();
            services.AddTransient<IUserGroupService, UserGroupService>();
            services.AddScoped<AdminCustomAuthorizationFilter>();
            services.AddScoped<SystemAdminOnlyCustomAuthorization>();
            services.AddTransient<IReportCategorySevice, ReportCategorySevice>();
            services.AddTransient<IUserService, UserService>();
            var emailServiceConfig = configuration.GetSection("SmtpConfiguration").Get<Email.SmtpConfiguration>();
            services.AddSingleton<Email.SmtpConfiguration>(emailServiceConfig);
            services.AddSingleton<Email.IEmailService, Email.Services.SmtpEmailService>();
            services.AddScoped<IEmailInvitationTemplateRender, EmailInvitationTemplateRenderer>();
            services.AddTransient<IRazorPartialToStringRenderer, RazorPartialToStringRenderer>();
            services.AddTransient<IEmailInvitationService, EmailInvitationService>();
            #endregion

            #region Repositories
            services.AddTransient<IGroupRepository, RoleRepository>();
            services.AddTransient<IReportRepository, ReportRepository>();
            services.AddTransient<IUserFavoritesRepository, UserFavoritesRepository>();
            services.AddTransient<IUserRolesRepository, UserRolesRepository>();
            services.AddTransient<IUsersRepository, UsersRepository>();
            services.AddTransient<IReportCategoriesRepository, ReportCategoriesRepository>();
            services.AddTransient<IReportRoleAccessRepository, ReportRoleAccessRepository>();
            services.AddTransient<IReportUserAccessRepository, ReportUserAccessRepository>();
            services.AddTransient<IReportAccessLogRepository, ReportAccessLogRepository>();
            #endregion
        }

        public static void ConfigureDbContext(this IServiceCollection services, ConfigurationManager configuration)
        {
            services.AddDbContext<PortalDbContext>(o => o.UseNpgsql(configuration.GetConnectionString(ConnectionStrings.BIReportDbConnection)), ServiceLifetime.Scoped);
        }
    }
}
