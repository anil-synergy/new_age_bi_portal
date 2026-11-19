using System.Net;
using PowerBIPortal.Core.Models.Api;
using PowerBIPortal.Core.Exceptions;
using Npgsql;
using Microsoft.AspNetCore.Diagnostics;
using PowerBIPortal.Api.Constants;
using Synergy.Core.EmbeddedAnalytics;
using PowerBIPortal.Core.User;

namespace PowerBIPortal.Api.Middilewares
{
    public class ExceptionMiddleware
    {
        private readonly RequestDelegate _request;
        private readonly ILogger<ExceptionMiddleware> _logger;
        readonly IConfiguration _configuration;
        private readonly IApplicationUser _applicationUser;

        public ExceptionMiddleware(RequestDelegate request, ILogger<ExceptionMiddleware> logger, IConfiguration configuration, IApplicationUser applicationUser)
        {
            _request = request;
            _logger = logger;
            _configuration = configuration;
            _applicationUser = applicationUser;
        }

        public async Task Invoke(HttpContext context)
        {
            try
            {
                await _request(context);
            }
            catch (UnauthorizedAccessException exception)
            {
                await HandleExceptionAsync(context, exception);
            }
            catch (AccessDeniedException exception)
            {
                await HandleExceptionAsync(context, exception);
            }
            catch (AppException commException)
            {
                await HandleExceptionAsync(context, commException);
            }
            catch (PostgresException dbException)
            {
                await HandleExceptionAsync(context, dbException);
            }
            catch (QueueServiceException powerBiException)
            {
                await HandleExceptionAsync(context, powerBiException);
            }
            catch (Exception generalException)
            {
                await HandleExceptionAsync(context, generalException);
            }

        }

        private Task HandleExceptionAsync(HttpContext context, AppException exception)
        {
            context.Response.ContentType = "application/json";
            List<string> errors = LogErrorDetail(exception);


            string result;
            if (exception != null)
            {
                string errorMsg = exception.Message;


                result = new ErrorModel()
                {
                    Message = errorMsg,
                    ResponseCode = HttpStatusCode.BadRequest.ToString(),
                    //Errors = errors,
                    Data = exception.Data
                }.ToString();
                context.Response.StatusCode = (int)HttpStatusCode.UnprocessableEntity;
            }
            else
            {
                result = new ErrorModel() { Message = "Internal server error", ResponseCode = HttpStatusCode.InternalServerError.ToString(), Errors = errors }.ToString();
                context.Response.StatusCode = (int)HttpStatusCode.InternalServerError;
            }
            return context.Response.WriteAsync(result);
        }

        private Task HandleExceptionAsync(HttpContext context, Exception exception)
        {
            context.Response.ContentType = "application/json";
            var contextFeature = context.Features.Get<IExceptionHandlerFeature>();
            List<string> errors = LogErrorDetail(exception);
            if (_configuration["ShowStackTrace"].ToString() == "false") { errors = null; }
            string result = new ErrorModel() { Message = exception.Message, ResponseCode = Convert.ToString(HttpStatusCode.InternalServerError), Errors = errors }.ToString();
            context.Response.StatusCode = (int)HttpStatusCode.InternalServerError;
            return context.Response.WriteAsync(result);
        }

        private Task HandleExceptionAsync(HttpContext context, UnauthorizedAccessException exception)
        {
            context.Response.ContentType = "application/json";
            List<string> errors = LogErrorDetail(exception);


            string result;
            if (exception != null)
            {
                string errorMsg = exception.Message;


                result = new ErrorModel()
                {
                    Message = errorMsg,
                    ResponseCode = ErrorCodes.Unauthorized,
                    //Errors = errors,
                    Data = exception.Data
                }.ToString();
                context.Response.StatusCode = (int)HttpStatusCode.Unauthorized;
            }
            else
            {
                result = new ErrorModel() { Message = "Internal server error", ResponseCode = HttpStatusCode.InternalServerError.ToString(), Errors = errors }.ToString();
                context.Response.StatusCode = (int)HttpStatusCode.InternalServerError;
            }
            return context.Response.WriteAsync(result);
        }

        private Task HandleExceptionAsync(HttpContext context, AccessDeniedException exception)
        {
            context.Response.ContentType = "application/json";
            List<string> errors = LogErrorDetail(exception);


            string result;
            if (exception != null)
            {
                string errorMsg = exception.Message;


                result = new ErrorModel()
                {
                    Message = errorMsg,
                    ResponseCode = ErrorCodes.Forbidden,
                    //Errors = errors,
                    Data = exception.Data
                }.ToString();
                context.Response.StatusCode = (int)HttpStatusCode.Forbidden;
            }
            else
            {
                result = new ErrorModel() { Message = "Internal server error", ResponseCode = HttpStatusCode.InternalServerError.ToString(), Errors = errors }.ToString();
                context.Response.StatusCode = (int)HttpStatusCode.InternalServerError;
            }
            return context.Response.WriteAsJsonAsync(result);
        }
        private Task HandleExceptionAsync(HttpContext context, QueueServiceException exception)
        {
            
            context.Response.ContentType = "application/json";
            string refCode = DateTime.UtcNow.ToString("ddMMyy:hhmm:ss");
            List<string> errors = LogErrorDetail(exception, refCode);

            string result;
            if (exception != null)
            {
                result = new ErrorModel()
                {
                    Message = ErrorCodes.PowerBIException,
                    ResponseCode = HttpStatusCode.BadRequest.ToString(),
                    //Errors = errors,
                    Data = exception.Data,
                    ReferenceCode = refCode
                }.ToString();
                context.Response.StatusCode = (int)HttpStatusCode.UnprocessableEntity;
            }
            else
            {
                result = new ErrorModel() { Message = "Internal server error", ResponseCode = HttpStatusCode.InternalServerError.ToString(), Errors = errors }.ToString();
                context.Response.StatusCode = (int)HttpStatusCode.InternalServerError;
            }
            return context.Response.WriteAsync(result);
        }
        public List<string> LogErrorDetail(AppException exception)
        {

            List<string> errors = new List<string>();
            string stackTrace;
            string innerException;
            innerException = exception.InnerException != null ? exception.InnerException.ToString() : "";

            stackTrace = (exception.StackTrace != null && _configuration["ShowStackTrace"].ToString().ToLower() == "true") ? exception.StackTrace.ToString() : stackTrace = "";
            if (!string.IsNullOrEmpty(innerException)) errors.Add("InnerException - " + innerException);
            if (!string.IsNullOrEmpty(stackTrace)) errors.Add("StackTrace - " + stackTrace);
            _logger.LogError(exception, exception.Message + " - " + _applicationUser.Email);
            return errors;
        }
        public List<string> LogErrorDetail(Exception exception)
        {
            List<string> errors = new List<string>();
            string stackTrace;
            string innerException;
            innerException = exception.InnerException != null ? exception.InnerException.ToString() : "";
            stackTrace = (exception.StackTrace != null && _configuration["ShowStackTrace"].ToString().ToLower() == "true") ? exception.StackTrace.ToString() : stackTrace = "";
            if (!string.IsNullOrEmpty(innerException)) errors.Add("InnerException - " + innerException);
            if (!string.IsNullOrEmpty(stackTrace)) errors.Add("StackTrace - " + stackTrace);
            _logger.LogError(exception,exception.Message + " - " + _applicationUser.Email);
            return errors;
        }
        public List<string> LogErrorDetail(QueueServiceException exception,string refCode)
        {
            List<string> errors = new List<string>();
            string stackTrace;
            string innerException;
            innerException = exception.InnerException != null ? exception.InnerException.ToString() : "";
            stackTrace = (exception.StackTrace != null && _configuration["ShowStackTrace"].ToString().ToLower() == "true") ? exception.StackTrace.ToString() : stackTrace = "";
            if (!string.IsNullOrEmpty(innerException)) errors.Add("InnerException - " + innerException);
            if (!string.IsNullOrEmpty(stackTrace)) errors.Add("StackTrace - " + stackTrace);
            _logger.LogError(exception, exception.Message + " - " + refCode);
            return errors;
        }
    }
}
