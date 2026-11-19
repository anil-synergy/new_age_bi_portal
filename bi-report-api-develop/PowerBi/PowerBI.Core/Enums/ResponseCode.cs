using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Core.Enums
{
    public enum ResponseCode
    {
        FILE_NOT_FOUND,
        INTERNAL_SERVER_ERROR = 500,
        INVALID_REQUEST = 422,
        FORBIDDEN = 403
    }
    public enum ReportPermission
    {
        Viewer = 0,
        All = 1
    }

    public enum FileFormats
    {
        PPTX = 0,
        PDF,
        PNG,
        IMAGE,
        XLSX,
        DOCX,
        CSV,
        XML,
        MHTML,
        ACCESSIBLEPDF
    }
}
