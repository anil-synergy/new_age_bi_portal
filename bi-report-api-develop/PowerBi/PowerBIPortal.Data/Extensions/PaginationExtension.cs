using Microsoft.EntityFrameworkCore;
using PowerBIPortal.Core.Models.Api;

namespace PowerBIPortal.Data.Extensions
{
    public static class PaginationExtension
    {
        public static async Task<PageModel<TModel>> PaginateAsync<TModel>(
   this IQueryable<TModel> query,
   int page,
   int limit = 50
   )
   where TModel : class
        {

            var paged = new PageModel<TModel>();

            page = (page < 0) ? 1 : page;

            paged.CurrentPage = page;
            paged.PageSize = limit;

            var totalItemsCountTask = await query.CountAsync();

            var startRow = (page - 1) * limit;

            paged.Items = await query.Skip(startRow).Take(limit).ToListAsync();

            paged.TotalItems = totalItemsCountTask;
            paged.TotalPages = limit == 0 ? 0 : (int)Math.Ceiling(paged.TotalItems / (double)limit);
            paged.HasNext = (paged.PageSize * paged.CurrentPage) < paged.TotalItems;
            paged.HasPrev = paged.CurrentPage > 1;

            return paged;
        }

        public static PageModel<TModel> Paginate<TModel>(
   this List<TModel> query,
   int page,
   int limit = 50
   )
   where TModel : class
        {
            var paged = new PageModel<TModel>();
            page = (page < 0) ? 1 : page;
            paged.CurrentPage = page;
            paged.PageSize = limit;
            var totalItemsCountTask = query.Count;
            var startRow = (page - 1) * limit;
            paged.Items = query.Skip(startRow).Take(limit).ToList();
            paged.TotalItems = totalItemsCountTask;
            paged.TotalPages = limit == 0 ? 0 : (int)Math.Ceiling(paged.TotalItems / (double)limit);
            paged.HasNext = (paged.PageSize * paged.CurrentPage) < paged.TotalItems;
            paged.HasPrev = paged.CurrentPage > 1;
            return paged;
        }
    }
}
