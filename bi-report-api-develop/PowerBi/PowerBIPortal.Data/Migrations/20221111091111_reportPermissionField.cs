using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PowerBIPortal.Data.Migrations
{
    public partial class reportPermissionField : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "[permission]",
                table: "bi_report_user_access",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "[permission]",
                table: "bi_report_role_access",
                type: "integer",
                nullable: false,
                defaultValue: 0);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "[permission]",
                table: "bi_report_user_access");

            migrationBuilder.DropColumn(
                name: "[permission]",
                table: "bi_report_role_access");
        }
    }
}
