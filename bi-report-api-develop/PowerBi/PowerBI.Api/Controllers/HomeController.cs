using Microsoft.AspNetCore.Mvc;

namespace PowerBIPortal.Api.Controllers
{
    [ApiController]
    [Route("/bi-report-api/v1/")]
    public class HomeController : Controller
    {
        [Route("ping")]
        [HttpGet]
        public IActionResult Ping()
        {
            return Ok($"PowerBi Api received your request at => {DateTime.Now.ToShortTimeString()} ");
        }
        [Route("health")]
        [HttpGet]
        public IActionResult Health()
        {
            return Ok($"PowerBi Api received your request at => {DateTime.Now.ToShortTimeString()} ");
        }
    }
}
