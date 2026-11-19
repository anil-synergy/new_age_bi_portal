using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Core.Models.Api
{
    public class PageModel<TModel>
    {
        public int CurrentPage { get; set; }
        public int TotalItems { get; set; }
        public int TotalPages { get; set; }
        public IList<TModel> Items { get; set; }
        public int PageSize { get; set; }
        public bool HasNext { get; set; }
        public bool HasPrev { get; set; }
        public int TotalCount { get; set; }
        public PageModel()
        {
            Items = new List<TModel>();
        }
    }
}
