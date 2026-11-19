using Microsoft.EntityFrameworkCore;
using PowerBIPortal.Core.Models.Entity;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Linq.Expressions;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Data.Extensions
{
    public static class SoftDeleteExtionsion
    {
        public static void ApplySoftDeleteFilter(this ModelBuilder modelbuilder)
        {
            foreach (var entityType in modelbuilder.Model.GetEntityTypes())
            {
                if (!typeof(BaseEntity).IsAssignableFrom(entityType.ClrType))
                {
                    continue;
                }

                var param = Expression.Parameter(entityType.ClrType, "entity");
                var prop = Expression.PropertyOrField(param, nameof(BaseEntity.IsActive));
                var notSoftDeleted = Expression.Lambda(Expression.Equal(prop, Expression.Constant(true)), param);

                entityType.SetQueryFilter(notSoftDeleted);
            }
        }
    }
}
