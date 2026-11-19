using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PowerBIPortal.Data.Migrations
{
    public partial class ReportRLSEnable : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "rls_enabled",
                table: "bi_report",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "rls_enabled",
                table: "bi_report");
        }
    }
}
