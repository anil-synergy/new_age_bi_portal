using Microsoft.Extensions.Configuration;
using PowerBIPortal.Core.Constants;
using PowerBIPortal.Core.Models.Dto;
using PowerBIPortal.Services.EmailInvitation.Model;
using PowerBIPortal.Services.Interfaces;
using Synergy.Core.EmailService;

namespace PowerBIPortal.Services.Services
{
    public class EmailInvitationService : IEmailInvitationService
    {
        private readonly IEmailInvitationTemplateRender _emailInvitationTemplateRender;
        private readonly IConfiguration _configuration;
        private readonly IEmailService _emailService;

        public EmailInvitationService(IEmailInvitationTemplateRender emailInvitationTemplateRender, IConfiguration configuration, IEmailService emailService)
        {
            _emailInvitationTemplateRender = emailInvitationTemplateRender;
            _configuration = configuration;
            _emailService = emailService;
        }
        public async Task BuildEmailInvitation(SendEmailDto sendEmailDto)
        {
            EmailInvitationViewModel emailInvitationViewModel = new()
            {
                Name = sendEmailDto.UserName,
                WebUrl = _configuration.GetValue<string>("WebUrl"),
                FirstMessage = EmailValue.FirstLineMessage,
                SecondMessage = EmailValue.SecondLineMessage,
                ThirdMessage = EmailValue.ThirdLineMessage,
                ButtonMessage = EmailValue.ButtonMessage,
                HelpMessage = EmailValue.HelpMessage,
                HelpMessageSecond = EmailValue.HelpMessageSecond,
                HelpEmail = _configuration.GetValue<string>("EmailConfiguration:ReplyEmail"),
                LogoUrl = _configuration.GetValue<string>("logoSource"),
            };
            var htmlBody = await _emailInvitationTemplateRender.RenderToHtmlAsync(emailInvitationViewModel);

            if (sendEmailDto.ToEmailIds.Any())
            {
                SendingMailInfo sendInfo = new SendingMailInfo
                {
                    From = _configuration.GetSection("EmailConfiguration:From").Value == null ? string.Empty : _configuration.GetValue<string>("EmailConfiguration:From"),
                    Subject = EmailValue.EmailSubject,
                    Body = htmlBody,
                    IsBodyHtml = true,
                    To = sendEmailDto.ToEmailIds,
                    ReplyTo = _configuration.GetSection("EmailConfiguration:ReplyEmail").Value == null ? string.Empty : _configuration.GetValue<string>("EmailConfiguration:ReplyEmail"),
                    Name = _configuration.GetSection("EmailConfiguration:FromName").Value == null ? string.Empty : _configuration.GetValue<string>("EmailConfiguration:FromName"),
                };
                await _emailService.SendEmailAsync(sendInfo);
            }
        }
    }
}
