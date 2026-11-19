using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PowerBIPortal.Data.Migrations
{
    public partial class AccessLogChanges : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropPrimaryKey(
                name: "PK_ReportAccessLogs",
                table: "ReportAccessLogs");

            migrationBuilder.RenameTable(
                name: "ReportAccessLogs",
                newName: "report_access_log");

            migrationBuilder.AddPrimaryKey(
                name: "PK_report_access_log",
                table: "report_access_log",
                column: "id");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropPrimaryKey(
                name: "PK_report_access_log",
                table: "report_access_log");

            migrationBuilder.RenameTable(
                name: "report_access_log",
                newName: "ReportAccessLogs");

            migrationBuilder.AddPrimaryKey(
                name: "PK_ReportAccessLogs",
                table: "ReportAccessLogs",
                column: "id");
        }
    }
}
