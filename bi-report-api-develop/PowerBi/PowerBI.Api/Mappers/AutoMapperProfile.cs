using AutoMapper;
using PowerBIPortal.Core.Models.Api;
using PowerBIPortal.Core.Models.Dto;
using PowerBIPortal.Core.Models.Entity;
using Synergy.Core.EmbeddedAnalytics.Models;

namespace PowerBIPortal.Api.Mappers
{
    public class AutoMapperProfile : Profile
    {
        public AutoMapperProfile()
        {
            CreateMap<GroupDetailsDto, Group>().ReverseMap();
            CreateMap<ReportCategoryDto, ReportCategories>().ReverseMap();
            CreateMap<GroupDetailsDto, GroupCreateRequest>().ReverseMap();
            CreateMap<Report, ReportInformation>().ReverseMap();
            CreateMap<Users, UserCreateRequest>().ReverseMap();
            CreateMap<UserDetailDto, Users>().ReverseMap();
            CreateMap<ExportRequest, PbiReportExportRequest>().ReverseMap();
        }
    }
}
