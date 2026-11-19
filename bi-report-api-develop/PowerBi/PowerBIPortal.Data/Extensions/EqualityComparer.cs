using PowerBIPortal.Core.Models.Dto;
using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Data.Extensions
{
    public class EqualityComparer : IEqualityComparer<ReportInformation>
    {
        public bool Equals(ReportInformation x, ReportInformation y)
        {
            if (x.Id == y.Id)
                return true;

            return false;
        }
        public int GetHashCode([DisallowNull] ReportInformation obj)
        {
            return obj.Id.GetHashCode();
        }

    }
}
