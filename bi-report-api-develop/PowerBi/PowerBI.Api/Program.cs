using Microsoft.AspNetCore.Server.Kestrel.Core;
using PowerBIPortal.Api.Helpers.HealthChecks;
using PowerBIPortal.Api.Helpers.StartupHelper;
using PowerBIPortal.Api.Middilewares;
using PowerBIPortal.Data.Seeder;
using Serilog;
using Synergy.Core.QueueService;

var AllowAllOrigins = "_allowAllOrigins";

var builder = WebApplication.CreateBuilder(args);
IConfiguration configuration = builder.Configuration;

builder.Host.ConfigureAppConfiguration(config =>
{
    config
        .AddJsonFile("appsettings.json", optional: false, reloadOnChange: true)
        .AddJsonFile($"appsettings.{Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") ?? "Development"}.json", optional: true)
        .AddJsonFile($"appsettings.{Environment.GetEnvironmentVariable("DOCKER_ENVIRONMENT") ?? "Development"}.json", optional: true);
});

builder.WebHost.UseSentry();
builder.Host.UseSerilog(((ctx, lc) => lc
.ReadFrom.Configuration(ctx.Configuration)))
.ConfigureAppConfiguration(config =>
                          {
                              config
                                  .AddJsonFile("appsettings.json", optional: false, reloadOnChange: true)
                                  .AddJsonFile($"appsettings.{Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") ?? "Development"}.json", optional: true)
                                  .AddJsonFile($"appsettings.{Environment.GetEnvironmentVariable("DOCKER_ENVIRONMENT") ?? "Development"}.json", optional: true)
                                  // Re-added last so secrets such as ConnectionStrings__BIReportDbConnection override the JSON files.
                                  .AddEnvironmentVariables()
                                  .AddCommandLine(args);
                          });

// Add services to the container.
var a = builder.Services.Configure<KestrelServerOptions>(configuration.GetSection("Kestrel"));
builder.Services.AddCors(options =>
{
    List<string> allowedOrigins = new();
    builder.Configuration.GetSection("AllowAllOrigins").Bind(allowedOrigins);

    options.AddPolicy(name: AllowAllOrigins,
       builder => builder.WithOrigins(allowedOrigins.ToArray())
       .AllowAnyHeader().AllowAnyMethod().AllowCredentials().WithExposedHeaders("Content-Disposition"));
});
builder.Services.ConfigureAuthentication(builder.Configuration);
builder.Services.AddControllers();
// Learn more about configuring Swagger/OpenAPI at https://aka.ms/aspnetcore/swashbuckle
builder.Services.AddEndpointsApiExplorer();
builder.Services.ConfigureSwagger();
builder.Services.ConfigureDbContext(builder.Configuration);
builder.Services.AddAutoMapper(typeof(Program));
builder.Services.ConfigureDependencies(builder.Configuration);
builder.Services.AddQueueServicePBA(builder.Configuration);
builder.Services.AddRazorPages();
builder.Services.AddDistributedMemoryCache();
builder.Services.AddSession();
builder.Services.AddHealthChecks().AddCheck<DatabaseHealthCheck>("database");
var app = builder.Build();
app.Logger.LogInformation("Environment {Environment}; database {Database}", app.Environment.EnvironmentName,
    DatabaseHealthCheck.DescribeTarget(configuration.GetConnectionString(PowerBIPortal.Api.Configurations.ConnectionStrings.BIReportDbConnection)));

// Configure the HTTP request pipeline.
try
{
    PrepareLookUpData.LookUpDataPopulation(app);

    if (app.Environment.IsDevelopment())
    {
        app.UseDeveloperExceptionPage();
    }
    app.UseMiddleware<ExceptionMiddleware>();

    app.UseSwagger(c =>
    {
        c.RouteTemplate = "bi-report-api/v1/swagger/{documentname}/swagger.json";

    });

    app.UseSwaggerUI(c =>
    {
        c.SwaggerEndpoint(url: "v1/swagger.json", name: "BI Portal API Spec");
        c.RoutePrefix = "bi-report-api/v1/swagger";
    });

    app.UseCors(AllowAllOrigins);

    if (!app.Environment.IsDevelopment())
    {
        app.UseHttpsRedirection();
    }

    app.UseRouting();

    app.UseAuthentication();

    app.UseAuthorization();

    app.UseSession();

    app.MapControllers();
    // /health and /ping (HomeController) stay as DB-independent liveness probes.
    app.MapHealthChecks("/bi-report-api/v1/health/ready");

    app.Run();
}
catch (Exception ex)
{
    Console.WriteLine(ex.ToString());
    Log.Error(ex.ToString());
}
finally
{
    Log.CloseAndFlush();
}