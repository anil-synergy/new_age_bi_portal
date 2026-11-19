using Newtonsoft.Json;
using System.Collections;

namespace PowerBIPortal.Core.Models.Api
{
    public class ErrorModel
    {
        public string Message { get; set; }
        public string ResponseCode { get; set; }
        public List<string> Errors { get; set; }
        public string ReferenceCode { get; set; }

        public IDictionary Data { get; set; }
        public override string ToString()
        {
            return JsonConvert.SerializeObject(this);
        }
    }
}
