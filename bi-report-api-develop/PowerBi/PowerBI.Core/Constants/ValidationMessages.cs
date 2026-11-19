namespace PowerBIPortal.Core.Constants
{
    public static class ValidationMessages
    {
        public const string AccessDenied = "Access to the given report restricted";
        public const string UserNotFound = "Access to the given report restricted";
        public const string ReportNotFound = "Report not found";
        public const string CategoryNotFound = "Category not found";
        public const string DataNotFound = "Data not found";
        public const string UserExist = "User account already exists with given email address";
        public const string GroupNotFound = "Group not found";
        public const string DoNotRemoveAdminPrivilage ="You are unable to remove \"System Admin\" permission yourself";

    }

    public class EmailValue
    {
        public const string EmailSubject = "Welcome to Synergy BI Portal";
        public const string FirstLineMessage = "Synergy Maritime has invited you to use our new BI Portal, which will give you a better overview of all your reporting needs.";
        public const string SecondLineMessage = "This platform will help you to get the most out of data visualization, business intelligence, meaningful insights and analytics.";
        public const string ThirdLineMessage = "Check out the portal below:";
        public const string ButtonMessage = "GET STARTED!";
        public const string HelpMessage = "Note: Do not hesitate to reach out if you need any help at ";
        public const string HelpMessageSecond = "We would be happy to guide you.";

    }
}
