namespace PowerBIPortal.Api.Configurations
{
    public class AzureAd
    {
        public string Authority { get; set; }
        public bool RequireHttps { get; set; }
        public string Instance { get; set; }
        public string ClientId { get; set; }
        public string TenantId { get; set; }
    }
}
