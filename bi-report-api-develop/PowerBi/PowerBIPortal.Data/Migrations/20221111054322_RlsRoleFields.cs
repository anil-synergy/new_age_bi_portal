using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PowerBIPortal.Data.Migrations
{
    public partial class RlsRoleFields : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "rls_role_mapping ",
                table: "bi_report",
                newName: "rls_role_mapping");

            migrationBuilder.AddColumn<List<string>>(
                name: "powerbi_rls_role",
                table: "bi_report",
                type: "jsonb",
                nullable: true);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "powerbi_rls_role",
                table: "bi_report");

            migrationBuilder.RenameColumn(
                name: "rls_role_mapping",
                table: "bi_report",
                newName: "rls_role_mapping ");
        }
    }
}
