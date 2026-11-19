using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PowerBIPortal.Data.Migrations
{
    public partial class RLS_Bypass_Enable : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "rls_bypass_enable",
                table: "bi_report",
                type: "boolean",
                nullable: false,
                defaultValue: true);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "rls_bypass_enable",
                table: "bi_report");
        }
    }
}
