using Microsoft.Extensions.Diagnostics.HealthChecks;
using Npgsql;
using PowerBIPortal.Data.DBContexts;

namespace PowerBIPortal.Api.Helpers.HealthChecks
{
    public class DatabaseHealthCheck : IHealthCheck
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(5);
        private readonly PortalDbContext _dbContext;
        private readonly ILogger<DatabaseHealthCheck> _logger;

        public DatabaseHealthCheck(PortalDbContext dbContext, ILogger<DatabaseHealthCheck> logger)
        {
            _dbContext = dbContext;
            _logger = logger;
        }

        public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(Timeout);
            try
            {
                return await _dbContext.Database.CanConnectAsync(timeout.Token)
                    ? HealthCheckResult.Healthy()
                    : HealthCheckResult.Unhealthy("Database unreachable");
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Database health check failed");
                return HealthCheckResult.Unhealthy("Database unreachable");
            }
        }

        /// <summary>Host/port/database for logs; never includes credentials.</summary>
        public static string DescribeTarget(string connectionString)
        {
            if (string.IsNullOrWhiteSpace(connectionString)) return "(not configured)";
            try
            {
                var builder = new NpgsqlConnectionStringBuilder(connectionString);
                return $"{builder.Host}:{builder.Port}/{builder.Database} (ssl {builder.SslMode})";
            }
            catch (ArgumentException)
            {
                return "(invalid connection string)";
            }
        }
    }
}
