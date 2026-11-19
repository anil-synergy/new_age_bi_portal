using PowerBIPortal.Services.EmailInvitation;
using PowerBIPortal.Services.EmailInvitation.Model;

namespace PowerBIPortal.Services.Interfaces
{
    public interface IEmailInvitationTemplateRender
    {
        Task<string> RenderToHtmlAsync(EmailInvitationViewModel emailInvitationViewModel);
    }
}
