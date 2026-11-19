using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PowerBIPortal.Data.Migrations
{
    public partial class RlsRoleColumnRemoved : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "powerbi_rls_role",
                table: "bi_report");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<List<string>>(
                name: "powerbi_rls_role",
                table: "bi_report",
                type: "jsonb",
                nullable: true);
        }
    }
}
