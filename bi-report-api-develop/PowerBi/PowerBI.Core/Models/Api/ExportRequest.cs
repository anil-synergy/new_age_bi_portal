using Microsoft.PowerBI.Api.Models;
using PowerBIPortal.Core.Enums;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Core.Models.Api
{
    public class ExportRequest
    {
        public Guid PowerBiReportId { get; set; }
        public Guid WorkspaceId { get; set; }
        public List<FiletrItem> Filters { get; set; }
        public FileFormat ExportFileFormat { get; set; }
        public bool OnlyCurrentPage { get; set; }
        public List<ExportReportPage> PageParameters { get; set; }
    }

    public class FiletrItem
    {
        public string TableName { get; set; }
        public string Column { get; set; }
        public string SelectedValue { get; set; }
    }
}
