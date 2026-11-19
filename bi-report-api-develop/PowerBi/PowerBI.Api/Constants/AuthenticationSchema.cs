namespace PowerBIPortal.Api.Constants
{
    public class AuthenticationSchema
    {
        //public const string Seafarer = "SeafarerIdP";
        //public const string Shore = "ShoreIdP";
        public const string ShoreAndSeafarer = "AzureAd";
        public const string AzureAD = "AzureAd";
    }

    public class ErrorCodes
    {
        public const string Forbidden = "REPORT ACCESS DENIED";
        public const string Unauthorized = "USER AUTHENTICATION FAILED";
        public const string InternalServerError = "INTERNAL SERVER ERROR";
        public const string PowerBIException = "Failed to load report, Please contact your System Admin";
    }

    public class ErrorResponse
    {
        public const string Forbidden = "Access to the given report restricted";
        public const string Unauthorized = "Access token verification failed, please try login again";
    }
}
