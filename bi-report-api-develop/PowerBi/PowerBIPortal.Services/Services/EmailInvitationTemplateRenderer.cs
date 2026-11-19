using PowerBIPortal.Services.EmailInvitation;
using PowerBIPortal.Services.EmailInvitation.Model;
using PowerBIPortal.Services.Interfaces;

namespace PowerBIPortal.Services.Services
{
    public class EmailInvitationTemplateRenderer : IEmailInvitationTemplateRender
    {
        private readonly IRazorPartialToStringRenderer _razorViewToStringRenderer;
        public EmailInvitationTemplateRenderer(IRazorPartialToStringRenderer razorViewToStringRenderer)
        {
            _razorViewToStringRenderer = razorViewToStringRenderer;
        }

        public async Task<string> RenderToHtmlAsync(EmailInvitationViewModel emailInvitationViewModel)
        {
            var path = Path.Combine(Directory.GetCurrentDirectory(), "/Views/EmailInvitation.cshtml");
            return await _razorViewToStringRenderer.RenderPartialToStringAsync(path, emailInvitationViewModel);
        }
    }
}
