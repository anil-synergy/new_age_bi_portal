using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PowerBIPortal.Data.Migrations
{
    public partial class RLS_Bypass_2 : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "rls_bypass_enable",
                table: "bi_report");

            migrationBuilder.AddColumn<bool>(
                name: "RLS_Bypassed",
                table: "bi_report_user_access",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "RLS_Bypassed",
                table: "bi_report_role_access",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "RLS_Bypassed",
                table: "bi_report_user_access");

            migrationBuilder.DropColumn(
                name: "RLS_Bypassed",
                table: "bi_report_role_access");

            migrationBuilder.AddColumn<bool>(
                name: "rls_bypass_enable",
                table: "bi_report",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }
    }
}
