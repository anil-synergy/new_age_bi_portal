using PowerBIPortal.Core.Models.Dto;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Services.Interfaces
{
    public interface IEmailInvitationService
    {
        Task BuildEmailInvitation(SendEmailDto emailDto);
    }
}
