using Microsoft.EntityFrameworkCore;
using Newtonsoft.Json;
using OfficeOpenXml;
using System;
using System.Collections.Generic;
using System.Data;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;

namespace PowerBIPortal.Data.Helpers
{
    public static class DataTableConvertHelper
    {
        public static List<T> ConvertDataTable<T>(DataTable dt, DbContext dBContext)
        {
            List<T> data = new();
            foreach (DataRow row in dt.Rows)
            {
                T item = GetItem<T>(row, dBContext);
                data.Add(item);
            }
            return data;
        }
        public static T GetItem<T>(DataRow dr, DbContext dbContext)
        {
            Type temp = typeof(T);
            T obj = Activator.CreateInstance<T>();
            var entityType = dbContext.Model.FindEntityType(typeof(T));


            foreach (DataColumn column in dr.Table.Columns)
            {
                foreach (var property in entityType.GetProperties())
                {
                    var columnName = property.GetColumnName();
                    if (columnName == column.ColumnName)
                    {
                        var pro = temp.GetProperties().First(a => a.Name == property.Name);

                        if (pro.PropertyType == typeof(Guid))
                        {
                            Guid Id = GetId(dr, column);
                            pro.SetValue(obj, Id, null);
                        }
                        else
                        {
                            dynamic value = GetId(dr, column, pro);
                            pro.SetValue(obj, value, null);
                        }

                    }

                }


            }
            return obj;
        }

        private static dynamic GetId(DataRow dr, DataColumn column, PropertyInfo pro)
        {
            return (dr[column.ColumnName].ToString() == string.Empty || dr[column.ColumnName] == null || DBNull.Value.Equals(dr[column.ColumnName])) ? null :
Cast(dr[column.ColumnName], pro.PropertyType);
        }

        private static Guid GetId(DataRow dr, DataColumn column)
        {
            return dr[column.ColumnName].ToString() == string.Empty ? Guid.Empty : new Guid(dr[column.ColumnName].ToString());
        }

        public static dynamic Cast(dynamic obj, Type castTo)
        {
            var t = castTo;

            if (t.IsGenericType && t.GetGenericTypeDefinition().Equals(typeof(Nullable<>)))
            {
                if (obj == null)
                {
                    return null;
                }

                t = Nullable.GetUnderlyingType(t);
            }

            return Convert.ChangeType(obj, t);
        }

        public static DataTable GetDataTable(string excelSheetName)
        {
            DataTable dataTable = new();
            var basePath = AppContext.BaseDirectory;
            string FileName = Path.Combine(basePath, "LookUpData/LookUpData.xlsx");
            FileInfo file = new(FileName);

            ExcelWorksheet workSheet;
            ExcelPackage.LicenseContext = LicenseContext.Commercial;
            using (ExcelPackage package = new(file))
            {
                ExcelWorksheet excelWorksheet = package.Workbook.Worksheets[excelSheetName];
                using (workSheet = excelWorksheet)
                {
                    for (int i = 1; i <= workSheet.Dimension.Columns; i++)
                    {
                        string columnName = Convert.ToString(workSheet.Cells[1, i].Value);

                        dataTable.Columns.Add(columnName);
                    }
                    for (int i = 2; i <= workSheet.Dimension.Rows; i++)
                    {
                        DataRow dr = dataTable.NewRow();
                        for (int j = 1; j <= workSheet.Dimension.Columns; j++)
                        {
                            var columnValue = Convert.ToString(workSheet.Cells[i, j].Value);
                            dr[j - 1] = columnValue;
                        }
                        dataTable.Rows.Add(dr);
                    }
                }
            }
            return dataTable;
        }
    }

    public static class CloneObject
    {
        public static T Clone<T>(this T source)

        {

            var serialized = JsonConvert.SerializeObject(source);

            return JsonConvert.DeserializeObject<T>(serialized);

        }
    }

}
