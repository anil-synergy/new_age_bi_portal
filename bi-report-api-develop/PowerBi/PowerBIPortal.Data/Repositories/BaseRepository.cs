using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using PowerBIPortal.Core.Exceptions;
using PowerBIPortal.Core.Models.Api;
using PowerBIPortal.Data.Extensions;
using PowerBIPortal.Data.Interfaces;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Linq.Expressions;
using System.Text;
using System.Threading.Tasks;
using static Microsoft.EntityFrameworkCore.DbLoggerCategory;

namespace PowerBIPortal.Data.Repositories
{
    public class BaseRepository<TEntity> : IBaseRepository<TEntity> where TEntity : class
    {
        private readonly DbContext _context;
        public BaseRepository(DbContext context)
        {
            _context = context;
        }

        public bool Any(Expression<Func<TEntity, bool>> predicate = null)
        {
            IQueryable<TEntity> query = _context.Set<TEntity>().AsNoTracking();
            if (predicate != null)
            {
                return query.Any(predicate);
            }
            return query.Any();
        }

        public IDbContextTransaction BeginTransaction()
        {
            return _context.Database.BeginTransaction();
        }

        public async Task<IDbContextTransaction> BeginTransactionAsync()
        {
            return await _context.Database.BeginTransactionAsync();
        }

        public Task<int> Count()
        {
            return _context.Set<TEntity>().CountAsync();
        }

        public async Task DeleteAll()
        {
            _context.Set<TEntity>().RemoveRange(await GetAllAsNoTrackingAsync());
            await _context.SaveChangesAsync();
        }

        public async Task DeleteAsync(TEntity t, bool saveChanges = true)
        {
            _context.Set<TEntity>().Remove(t);
            if (saveChanges)
            {
                await _context.SaveChangesAsync();
            }
        }

        public async Task DeleteByIdAsync(object id)
        {
            TEntity existing = _context.Set<TEntity>().Find(id);
            if (existing != null)
            {
                _context.Set<TEntity>().Remove(existing);
                await _context.SaveChangesAsync();

            }
        }

        public async Task DeleteRangeAsync(IEnumerable<TEntity> t, bool saveChanges = true)
        {
            _context.Set<TEntity>().RemoveRange(t);
            if (saveChanges)
            {
                await _context.SaveChangesAsync();
            }
        }

        public Task DetachAll()
        {
            var objectStateEntries = this._context
                  .ChangeTracker.Entries().ToList();
            foreach (var entry in objectStateEntries)
                entry.State = EntityState.Detached;
            return Task.CompletedTask;
        }

        public async Task<TEntity> FindByIdAsync(object id)
        {
            return await _context.Set<TEntity>().FindAsync(id);
        }

        public async Task<TEntity> FirstOrDefaultAsync()
        {
            return await _context.Set<TEntity>().FirstOrDefaultAsync();

        }

        public async Task<List<TEntity>> GetAllAsListAsync()
        {
            return await _context.Set<TEntity>().AsNoTracking().ToListAsync();
        }

        public Task<IQueryable<TEntity>> GetAllAsNoTrackingAsync()
        {
            return Task.FromResult(_context.Set<TEntity>().AsNoTracking());
        }

        public Task<IQueryable<TEntity>> GetAllAsync(Expression<Func<TEntity, bool>> predicate)
        {
            return GetAllOrderByAsync(predicate, null);
        }

        public Task<IQueryable<TEntity>> GetAllOrderByAsync(Expression<Func<TEntity, bool>> predicate = null, Func<IQueryable<TEntity>, IOrderedQueryable<TEntity>> orderBy = null)
        {
            IQueryable<TEntity> query = GetQueryable(predicate);

            if (orderBy != null)
            {
                query = orderBy(query);
            }
            return Task.FromResult(query);
        }

        public  Task<PageModel<TEntity>> GetPaginated(Expression<Func<TEntity, bool>> predicate = null, Func<IQueryable<TEntity>, IOrderedQueryable<TEntity>> orderBy = null, int page = 1, int limit = 50)
        {
            IQueryable<TEntity> query = GetQueryable(predicate);
            if (orderBy != null)
            {
                query = orderBy(query);
            }
            var data =  query.PaginateAsync(page, limit);


            return data;
        }
        public async Task<List<TEntity>> SaveAllAsync(List<TEntity> entites)
        {
            await _context.Set<TEntity>().AddRangeAsync(entites);
            await _context.SaveChangesAsync();
            return entites;
        }

        public async Task<TEntity> SaveAsync(TEntity entity, bool saveChanges = true)
        {
            await _context.Set<TEntity>().AddAsync(entity);
            if (saveChanges)
            {
                await _context.SaveChangesAsync();
            }
            return entity;
        }

        public async Task<TEntity> UpdateAsync(TEntity updated, object key, bool saveChanges = true)
        {
            if (updated == null)
                return null;

            TEntity existing = await _context.Set<TEntity>().FindAsync(key);
            if (existing != null)
            {
                _context.Entry(existing).CurrentValues.SetValues(updated);
                if (saveChanges)
                {
                    await _context.SaveChangesAsync();

                }
            }
            return existing;
        }

        public async Task<TEntity> UpdateAsync(TEntity entity, bool saveChanges = true)
        {
            var key = GetKeys(entity).First().Value;
            if (!HasValidId(entity))
            {
                throw new AppException("Entity has no id");
            }
            TEntity existing = await _context.Set<TEntity>().FindAsync(key);
            if (existing != null)
            {
                _context.Entry(existing).CurrentValues.SetValues(entity);
                //commented due to - instance of entity type cannot be tracked
                //_context.Entry(entity).State = EntityState.Modified;
            }
            if (saveChanges)
            {
                await _context.SaveChangesAsync();

            }
            return entity;
        }

        public async Task<IEnumerable<TEntity>> UpdateRangeAsync(IEnumerable<TEntity> entities, bool saveChanges = true)
        {
            if (entities.Any())
            {

                foreach (var item in entities)
                {
                    await UpdateAsync(item, false);
                }
                if (saveChanges)
                {
                    await _context.SaveChangesAsync();
                }
            }

            return entities;
        }

        public IQueryable<TEntity> Where(Expression<Func<TEntity, bool>> predicate)
        {
            return GetQueryable(predicate);
        }

        public IDictionary<string, object> GetKeys(object entity)
        {
            DbContext ctx = _context;

            var entry = ctx.Entry(entity);
            var primaryKey = entry.Metadata.FindPrimaryKey();
            var keys = primaryKey.Properties.ToDictionary(x => x.Name, x => x.PropertyInfo.GetValue(entity));

            return keys;
        }
        private IQueryable<TEntity> GetQueryable(Expression<Func<TEntity, bool>> predicate = null)
        {
            IQueryable<TEntity> query = _context.Set<TEntity>();
            if (predicate != null)
            {
                query = query.Where(predicate);
            }
            return query;
        }

        private bool HasValidId(object entity)
        {
            bool isValid = true;
            var keys = GetKeys(entity);
            foreach (var item in keys)
            {
                if (item.Value is Guid && (Guid)item.Value == Guid.Empty)
                {
                    return false;
                }
                else if (item.Value is int && (int)item.Value == 0)
                {
                    return false;
                }
            }
            return isValid;
        }
    }
}
