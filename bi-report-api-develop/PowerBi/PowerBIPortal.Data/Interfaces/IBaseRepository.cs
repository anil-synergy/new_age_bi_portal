using Microsoft.EntityFrameworkCore.Storage;
using PowerBIPortal.Core.Models.Api;
using System.Linq.Expressions;

namespace PowerBIPortal.Data.Interfaces
{
    public interface IBaseRepository<TEntity> where TEntity : class
    {
        Task<TEntity> FindByIdAsync(object id);
        Task<TEntity> SaveAsync(TEntity entity, bool saveChanges = true);
        Task<IQueryable<TEntity>> GetAllAsNoTrackingAsync();
        Task<List<TEntity>> GetAllAsListAsync();
        Task<List<TEntity>> SaveAllAsync(List<TEntity> entites);
        Task<TEntity> FirstOrDefaultAsync();
        IDbContextTransaction BeginTransaction();
        Task<IDbContextTransaction> BeginTransactionAsync();
        Task<TEntity> UpdateAsync(TEntity updated, object key, bool saveChanges = true);
        Task<TEntity> UpdateAsync(TEntity entity, bool saveChanges = true);

        Task DeleteByIdAsync(object id);
        Task DeleteAsync(TEntity t, bool saveChanges = true);
        Task DeleteAll();
        Task DetachAll();
        Task DeleteRangeAsync(IEnumerable<TEntity> t, bool saveChanges = true);
        Task<IEnumerable<TEntity>> UpdateRangeAsync(IEnumerable<TEntity> entities, bool saveChanges = true);

        Task<int> Count();
        bool Any(Expression<Func<TEntity, bool>> predicate = null);
        IQueryable<TEntity> Where(Expression<Func<TEntity, bool>> predicate);
        Task<IQueryable<TEntity>> GetAllAsync(Expression<Func<TEntity, bool>> predicate);
        Task<IQueryable<TEntity>> GetAllOrderByAsync(Expression<Func<TEntity, bool>> predicate = null,
                                               Func<IQueryable<TEntity>, IOrderedQueryable<TEntity>> orderBy = null);
        Task<PageModel<TEntity>> GetPaginated(Expression<Func<TEntity, bool>> predicate = null,
                                                    Func<IQueryable<TEntity>, IOrderedQueryable<TEntity>> orderBy = null,
                                                    int page = 1, int limit = 50);
    }
}
