FROM mcr.microsoft.com/dotnet/aspnet:6.0 AS base
ARG NUGET_SRC
ARG NUGET_NS
ARG NUGET_USER
ARG NUGET_SECRET
 
WORKDIR /app
EXPOSE 80
EXPOSE 443
RUN apt update -y && apt install libgdiplus -y
ENV DOCKER_ENVIRONMENT=develop


FROM mcr.microsoft.com/dotnet/sdk:6.0 AS build
ARG NUGET_SRC
ARG NUGET_NS
ARG NUGET_USER
ARG NUGET_SECRET

WORKDIR /src
COPY ["PowerBI.Api/PowerBIPortal.Api.csproj", "PowerBI.Api/"]
RUN dotnet nuget add source https://nuget.pkg.github.com/Synergy-Marine-Group/index.json -n synergy-github -u Synergy-Marine-Group -p 3268140854e2f5de7368ece488135c28b953a9a7 --store-password-in-clear-text && dotnet restore "PowerBI.Api/PowerBIPortal.Api.csproj"
#RUN dotnet nuget add source NUGET_SRC -n NUGET_NS -u NUGET_USER -p NUGET_SECRET --store-password-in-clear-text && dotnet restore "PowerBI.Api/PowerBIPortal.Api.csproj"

COPY . .
WORKDIR "/src/PowerBI.Api"
RUN dotnet build "PowerBIPortal.Api.csproj" -c Release -o /app/build

FROM build AS publish
RUN dotnet publish "PowerBIPortal.Api.csproj" -c Release -o /app/publish

FROM base AS final
WORKDIR /app
COPY --from=publish /app/publish .
ENTRYPOINT ["dotnet", "PowerBIPortal.Api.dll"]
