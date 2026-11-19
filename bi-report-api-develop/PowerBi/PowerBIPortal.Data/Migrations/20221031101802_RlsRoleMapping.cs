using Microsoft.EntityFrameworkCore.Migrations;
using PowerBIPortal.Core.Models.Api;

#nullable disable

namespace PowerBIPortal.Data.Migrations
{
    public partial class RlsRoleMapping : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<RlsRoles>(
                name: "rls_role_mapping ",
                table: "bi_report",
                type: "jsonb",
                nullable: true);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "rls_role_mapping ",
                table: "bi_report");
        }
    }
}
