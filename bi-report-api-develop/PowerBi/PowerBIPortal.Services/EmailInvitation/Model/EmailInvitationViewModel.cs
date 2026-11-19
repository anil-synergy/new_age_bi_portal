using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Services.EmailInvitation.Model
{
    public class EmailInvitationViewModel
    {
        public string? FirstMessage { get; set; }
        public string Name { get; set; }
        public string WebUrl { get; set; }
        public string ButtonMessage { get; set; }
        public string SecondMessage { get; set; }
        public string ThirdMessage { get; set; }
        public string HelpMessage { get; set; }
        public string HelpMessageSecond { get; set; }
        public string HelpEmail { get; set; }
        public string LogoUrl { get; set; }
    }
}
