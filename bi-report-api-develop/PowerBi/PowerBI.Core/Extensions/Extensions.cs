using Microsoft.AspNetCore.DataProtection.KeyManagement;
using Microsoft.AspNetCore.Http;
using Newtonsoft.Json;

namespace PowerBIPortal.Core.Extensions
{
    public static  class Extensions
    {
        public static string Serializer<T>(this T t)
        {
            var seralizeString = string.Empty;
            if (t != null)
            {
                seralizeString = JsonConvert.SerializeObject(t, new JsonSerializerSettings
                {
                    NullValueHandling = NullValueHandling.Ignore,
                    DefaultValueHandling = DefaultValueHandling.Ignore
                });
            }
            return seralizeString;
        }

        public static void SetObject(this HttpContext context, string key, object value)
        {
            context.Session.SetString(key, JsonConvert.SerializeObject(value));
        }

        public static T GetObject<T>(this HttpContext context, string key)
        {
            var value = context.Session.GetString(key);
            return value == null ? default(T) : JsonConvert.DeserializeObject<T>(value);
        }
    }
}
